/**
 * mowaプログラミング教室 予約システム — Google Apps Script（スプレッドシートに付属）
 *
 * ・予約ページ（GitHub Pages）からの予約を受け付け、このスプレッドシートに保存する
 * ・確認メールを Gmail で送り、教室の Google カレンダーに予定を入れる
 * ・管理画面（このスクリプトの管理者用URL）を表示する
 *
 * 初回だけ：メニュー「予約システム」→「初期設定」を実行（シートと毎朝の処理を作る）
 * スクリプトのプロパティ（プロジェクトの設定 > スクリプト プロパティ）：
 *   SITE_URL           予約ページのURL（例：https://yoyaku.mowasol.com）
 *   CALENDAR_ID        予定を入れるGoogleカレンダーのID（空ならカレンダー連携しない）
 *   ADMIN_NOTIFY_EMAIL 新規予約の通知先（例：school@mowasol.com。空なら通知しない）
 *   REPLY_TO           保護者が返信したときの宛先（空なら school@mowasol.com）
 */

const SHEETS = {
  settings: { name: "設定", head: ["項目", "内容(JSON)"] },
  overrides: { name: "休業日", head: ["日付", "営業(1/0)", "メモ", "その日の定員"] },
  reservations: { name: "予約", head: ["id", "token", "コース", "月", "お子さま", "学年", "保護者", "メール", "電話", "ご要望", "受付日時", "匿名化"] },
  lessons: { name: "レッスン", head: ["id", "予約id", "日付", "時刻", "状態", "前日通知", "カレンダー予定ID"] },
  digest: { name: "通知まとめ", head: ["日時", "種類", "内容", "送信済み"] },
};
const RES_COLS = ["id", "token", "plan", "month", "child_name", "grade", "parent_name", "email", "phone", "note", "created_at", "anonymized"];
const LES_COLS = ["id", "reservation_id", "date", "time", "status", "reminded", "event_id"];
const OV_COLS = ["date", "open", "note", "capacity"];

// Apps Script には crypto が無いので、乱数は Utilities のUUIDとハッシュから作る
var crypto = {
  getRandomValues(buf) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now());
    for (let i = 0; i < buf.length; i++) buf[i] = (bytes[i % bytes.length] + 256) % 256 ^ (Math.random() * 256) & 255;
    return buf;
  },
};

const props = () => PropertiesService.getScriptProperties();
const siteUrl = () => String(props().getProperty("SITE_URL") || "").replace(/\/$/, "");
// 確認メールの返信先は教室の共用アドレス（スタッフ全員に届く）
const replyTo = () => props().getProperty("REPLY_TO") || "school@mowasol.com";

// ---------- メニュー・初期設定 ----------
function onOpen() {
  SpreadsheetApp.getUi().createMenu("予約システム").addItem("初期設定", "setup").addItem("Googleカレンダーと同期し直す", "resyncCalendar").addToUi();
}

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  for (const k of Object.keys(SHEETS)) {
    const def = SHEETS[k];
    let sh = ss.getSheetByName(def.name);
    if (!sh) sh = ss.insertSheet(def.name);
    sh.getRange(1, 1, 1, def.head.length).setValues([def.head]).setFontWeight("bold").setBackground("#e6f8dc");
    sh.setFrozenRows(1);
    sh.getRange("A:Z").setNumberFormat("@"); // 日付や時刻が勝手に変換されないよう、すべて文字列で扱う
  }
  const st = ss.getSheetByName(SHEETS.settings.name);
  if (!st.getRange("A2").getValue()) st.getRange("A2:B2").setValues([["settings", JSON.stringify(mergeSettings(null))]]);
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === "dailyJob").forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("dailyJob").timeBased().atHour(9).everyDays(1).inTimezone("Asia/Tokyo").create();
  // 最初の空シート（シート1）が残っていたら消す
  const blank = ss.getSheets().find((s) => !Object.values(SHEETS).some((d) => d.name === s.getName()) && s.getLastRow() === 0);
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);
  try { SpreadsheetApp.getUi().alert("初期設定が終わりました。次に「デプロイ」から公開してください。"); }
  catch (e) { console.log("初期設定が終わりました"); } // エディタから実行したときは画面に出せない
}

// ---------- シートの読み書き ----------
function sheet(k) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEETS[k].name);
  if (!sh) { // 後から追加したシートは、初めて使うときに作る
    sh = ss.insertSheet(SHEETS[k].name);
    sh.getRange(1, 1, 1, SHEETS[k].head.length).setValues([SHEETS[k].head]).setFontWeight("bold").setBackground("#e6f8dc");
    sh.setFrozenRows(1);
    sh.getRange("A:Z").setNumberFormat("@");
  }
  return sh;
}
// 1回の処理の中では、同じシートを何度も読まないよう覚えておく（書き込んだら忘れる）
let MEMO = {};
function rows(k, cols) {
  const key = k + ":" + cols.length;
  if (MEMO[key]) return MEMO[key].map((o) => ({ ...o }));
  const out = readRows(k, cols);
  MEMO[key] = out;
  return out.map((o) => ({ ...o }));
}
function forget(k) { Object.keys(MEMO).forEach((x) => { if (x.indexOf(k + ":") === 0) delete MEMO[x]; }); }
function readRows(k, cols) {
  const sh = sheet(k);
  const n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, 1, n, cols.length).getValues().map((r, i) => {
    const o = { _row: i + 2 };
    cols.forEach((c, j) => { o[c] = cellStr(r[j], c); });
    return o;
  });
}

// シートが「2026-12-05」「16:00」などを日付として保存してしまった場合も、元の文字に戻して読む
function cellStr(v, col) {
  if (v === "" || v === null || v === undefined) return "";
  if (Object.prototype.toString.call(v) === "[object Date]") {
    const tz = "Asia/Tokyo";
    if (col === "time") return Utilities.formatDate(v, tz, "HH:mm");
    if (col === "month") return Utilities.formatDate(v, tz, "yyyy-MM");
    if (col === "created_at") return v.toISOString();
    return Utilities.formatDate(v, tz, "yyyy-MM-dd");
  }
  return String(v);
}

// 行を足すときは、先にセルを「書式なしテキスト」にしてから書く（日付への自動変換を防ぐ）
function appendText(k, values) {
  forget(k);
  const sh = sheet(k);
  const range = sh.getRange(sh.getLastRow() + 1, 1, 1, values.length);
  range.setNumberFormat("@");
  range.setValues([values.map((v) => String(v ?? ""))]);
}
function lessonRows() { return rows("lessons", LES_COLS).map((l) => ({ ...l, id: Number(l.id), reminded: l.reminded === "1" })); }
function setCell(k, row, col, value) { forget(k); sheet(k).getRange(row, col).setNumberFormat("@").setValue(String(value)); }
function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  MEMO = {}; // ロック中は必ず最新を読む
  // 書き込みを確定させてからロックを外す（外したあとに次の人が古い内容を読まないように）
  try { return fn(); } finally { SpreadsheetApp.flush(); lock.releaseLock(); }
}
const full = () => new ApiError(409, "タッチの差で満席になったコマがあります。別の日時を選び直してください", "full");

const store = {
  getSettings() {
    // 設定は変更が少ないので5分間だけ一時保存（保存したらすぐ入れかえる）
    const cache = CacheService.getScriptCache();
    let v = cache.get("settings");
    if (!v) { v = String(sheet("settings").getRange("B2").getValue() || ""); if (v) cache.put("settings", v, 300); }
    return mergeSettings(v ? JSON.parse(v) : null);
  },
  saveSettings(s) {
    const v = JSON.stringify(s);
    sheet("settings").getRange("A2:B2").setValues([["settings", v]]);
    CacheService.getScriptCache().put("settings", v, 300);
  },
  getOverrides(from, to) {
    const out = {};
    rows("overrides", OV_COLS).forEach((r) => { if (r.date >= from && r.date <= to) out[r.date] = { open: r.open === "1", note: r.note, capacity: r.capacity ? Number(r.capacity) : "" }; });
    return out;
  },
  setOverride(date, v) {
    const r = rows("overrides", OV_COLS).find((x) => x.date === date);
    const vals = [[date, v.open ? "1" : "0", v.note || "", v.capacity === "" || v.capacity == null ? "" : String(v.capacity)]];
    forget("overrides");
    if (r) sheet("overrides").getRange(r._row, 1, 1, 4).setNumberFormat("@").setValues(vals); else appendText("overrides", vals[0]);
  },
  deleteOverride(date) {
    const r = rows("overrides", OV_COLS).find((x) => x.date === date);
    forget("overrides");
    if (r) sheet("overrides").deleteRow(r._row);
  },
  countActive(from, to) {
    const out = {};
    lessonRows().forEach((l) => { if (l.status === "active" && l.date >= from && l.date <= to) out[l.date + " " + l.time] = (out[l.date + " " + l.time] || 0) + 1; });
    return out;
  },
  createReservation(r, lessons, capacity) {
    withLock(() => {
      const all = lessonRows();
      const count = (d, t) => all.filter((l) => l.status === "active" && l.date === d && l.time === t).length;
      if (lessons.some((l) => count(l.date, l.time) >= (l.cap || capacity))) throw full();
      appendText("reservations", RES_COLS.map((c) => (c === "anonymized" ? "0" : r[c] || "")));
      let id = all.reduce((m, l) => Math.max(m, l.id), 0);
      for (const l of lessons) {
        id += 1;
        appendText("lessons", [String(id), r.id, l.date, l.time, "active", "0", ""]);
      }
    });
    calendarSyncReservation(r.id);
  },
  getReservation(token) {
    const res = rows("reservations", RES_COLS).find((x) => x.token === token && x.anonymized !== "1");
    if (!res) return null;
    const lessons = lessonRows().filter((l) => l.reservation_id === res.id).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    return { res, lessons };
  },
  cancelLesson(id, rid) {
    const l = lessonRows().find((x) => x.id === id && x.reservation_id === rid);
    if (l) { setCell("lessons", l._row, 5, "cancelled"); calendarSyncReservation(rid); }
  },
  replaceLesson(oldId, rid, l, capacity) {
    withLock(() => {
      const all = lessonRows();
      const old = oldId ? all.find((x) => x.id === oldId && x.reservation_id === rid) : null;
      const n = all.filter((x) => x.status === "active" && x.date === l.date && x.time === l.time && x !== old).length;
      if (n >= (l.cap || capacity)) throw full();
      if (old) setCell("lessons", old._row, 5, "cancelled");
      const id = all.reduce((m, x) => Math.max(m, x.id), 0) + 1;
      appendText("lessons", [String(id), rid, l.date, l.time, "active", "0", ""]);
    });
    calendarSyncReservation(rid);
  },
  listLessons(from, to) {
    const res = {};
    rows("reservations", RES_COLS).forEach((r) => { res[r.id] = r; });
    return lessonRows().filter((l) => l.date >= from && l.date <= to).map((l) => {
      const r = res[l.reservation_id] || {};
      return { ...l, plan: r.plan, child_name: r.child_name, grade: r.grade, parent_name: r.parent_name, email: r.email, phone: r.phone, note: r.note };
    }).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.id - b.id);
  },
  adminCancelLesson(id) {
    // 万一同じ番号が重なっていても、予約中のものを優先して取り消す
    const all = lessonRows();
    const l = all.find((x) => x.id === id && x.status === "active") || all.find((x) => x.id === id);
    if (l) { setCell("lessons", l._row, 5, "cancelled"); calendarSyncReservation(l.reservation_id); }
  },
};

// ---------- Googleカレンダー ----------
function calendar() {
  const id = props().getProperty("CALENDAR_ID");
  return id ? CalendarApp.getCalendarById(id) : null;
}
function jstDate(date, time) { return new Date(jstToMs(date, time)); }

// 予約1件分：予約中の回は予定を作り、キャンセルした回は予定を消す
function calendarSyncReservation(rid) {
  const cal = calendar();
  if (!cal) return;
  try {
    const settings = store.getSettings();
    const r = rows("reservations", RES_COLS).find((x) => x.id === rid);
    lessonRows().filter((l) => l.reservation_id === rid).forEach((l) => {
      if (l.status === "active" && !l.event_id && r) {
        const plan = settings.plans.find((p) => p.id === r.plan);
        const ev = cal.createEvent(`${r.child_name}（${r.grade}）`, jstDate(l.date, l.time), jstDate(l.date, endTime(l.time, settings, l.date)),
          { description: `${plan ? plan.name : r.plan}\n保護者：${r.parent_name}\n電話：${r.phone}\nご要望：${r.note}` });
        setCell("lessons", l._row, 7, ev.getId());
      } else if (l.status !== "active" && l.event_id) {
        const ev = cal.getEventById(l.event_id);
        if (ev) ev.deleteEvent();
        setCell("lessons", l._row, 7, "");
      }
    });
  } catch (e) { console.error("calendar sync failed", e); }
}
function resyncCalendar() {
  const ids = [...new Set(lessonRows().map((l) => l.reservation_id))];
  ids.forEach(calendarSyncReservation);
}

// ---------- メール ----------
function lessonLines(rv) {
  return rv.lessons.filter((l) => l.status === "active").map((l) => `・${formatDateJa(l.date)} ${l.time}〜${l.end}`).join("\n") || "（現在、予約中の回はありません）";
}
function notify(kind, d) {
  const rv = d.reservation, settings = d.settings, school = settings.schoolName;
  const link = `${siteUrl()}/reservation.html#${d.token}`;
  const title = { created: "ご予約を受け付けました", cancelled: "キャンセルを受け付けました", changed: "日時の変更を受け付けました" }[kind];
  const body = `${rv.parentName} 様\n\n${school}です。${title}。\n\n■ コース：${rv.planName}\n■ お子さま：${rv.childName}（${rv.grade}）\n■ 予約中の日時\n${lessonLines(rv)}\n\n予約の確認・変更・キャンセルはこちら（開始${settings.cancelHoursBefore}時間前まで）：\n${link}\n\nこのリンクはご家庭専用です。他の方に共有しないでください。\n\n${school}`;
  try {
    MailApp.sendEmail({ to: rv.email, subject: `【${school}】${title}`, body, name: school, replyTo: replyTo() });
  } catch (e) { console.error("mail failed", e); }
  try { notifyAdmin(kind, d); } catch (e) { console.error("admin notify failed", e); }
}

// ---------- 教室への通知（件数が多くても困らないように振り分ける） ----------
const KIND_JA = { created: "新規", cancelled: "キャンセル", changed: "変更" };

// その操作で関わる日付（当日・翌日のものがあれば「急ぎ」）
function touchedDates(kind, d) {
  const dates = [];
  if (kind === "created") d.reservation.lessons.filter((l) => l.status === "active").forEach((l) => dates.push(l.date));
  if (kind === "cancelled" && d.lesson) dates.push(d.lesson.date);
  if (kind === "changed") { if (d.from) dates.push(d.from.date); if (d.to) dates.push(d.to.date); }
  return dates;
}

function notifyAdmin(kind, d) {
  const admin = props().getProperty("ADMIN_NOTIFY_EMAIL");
  if (!admin) return;
  const rv = d.reservation, settings = d.settings;
  const mode = settings.notifyMode || "smart";
  if (mode === "off") return;
  const tomorrow = addDays(nowJST().date, 1);
  const urgent = touchedDates(kind, d).some((x) => x <= tomorrow);
  const what = kind === "cancelled" && d.lesson ? `取消：${formatDateJa(d.lesson.date)} ${d.lesson.time}`
    : kind === "changed" && d.from ? `変更：${formatDateJa(d.from.date)} ${d.from.time} → ${formatDateJa(d.to.date)} ${d.to.time}`
    : `予約：${rv.lessons.filter((l) => l.status === "active").map((l) => `${formatDateJa(l.date)} ${l.time}`).join("、")}`;
  const line = `${rv.childName}（${rv.grade}・${rv.planName}）${what}`;
  if (mode === "each" || (mode === "smart" && urgent)) {
    MailApp.sendEmail({ to: admin, name: settings.schoolName,
      subject: `${urgent ? "【急ぎ】" : ""}[予約${KIND_JA[kind]}] ${rv.childName}（${rv.grade}）`,
      body: `${line}\n\n予約中の日時\n${lessonLines(rv)}\n保護者：${rv.parentName}\nメール：${rv.email}\n電話：${rv.phone}\nご要望：${rv.note}\n\n管理画面：${siteUrl()}/admin/` });
  } else {
    appendText("digest", [new Date().toISOString(), KIND_JA[kind], line, "0"]);
  }
}

// 毎朝、たまった通知を1通にまとめて送る
function sendDigest() {
  const admin = props().getProperty("ADMIN_NOTIFY_EMAIL");
  if (!admin) return;
  const settings = store.getSettings();
  const pending = rows("digest", ["at", "kind", "text", "sent"]).filter((r) => r.sent !== "1");
  if (!pending.length) return;
  const count = (k) => pending.filter((r) => r.kind === k).length;
  const body = `前回のお知らせから ${pending.length} 件の動きがありました（新規 ${count("新規")}・変更 ${count("変更")}・キャンセル ${count("キャンセル")}）。\n\n`
    + pending.map((r) => `・[${r.kind}] ${r.text}`).join("\n")
    + `\n\n※当日・翌日のレッスンに関わるものは、その都度お知らせしています。\n管理画面：${siteUrl()}/admin/`;
  MailApp.sendEmail({ to: admin, name: settings.schoolName, subject: `[予約まとめ] ${pending.length}件（${formatDateJa(nowJST().date)}）`, body });
  const sh = sheet("digest");
  pending.forEach((r) => sh.getRange(r._row, 4).setNumberFormat("@").setValue("1"));
  forget("digest");
}

// ---------- 予約ページからの受付（公開URL） ----------
function doPost(e) {
  MEMO = {};
  let out;
  try {
    const req = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (String(req.path || "").indexOf("/api/admin") === 0) throw new ApiError(403, "管理画面から操作してください", "forbidden");
    if (req.method === "POST" && req.path === "/api/reservations") rateLimit();
    const api = createApi(store, {});
    out = { result: api.handle(req.method, req.path, req.query || {}, req.body || {}, { admin: false, notify }) };
  } catch (err) { out = errorOut(err); }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// 予約が短時間に集中したら止める（いたずら対策）
function rateLimit() {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get("rl") || 0) + 1;
  cache.put("rl", String(n), 600);
  if (n > 40) throw new ApiError(429, "ただいま混み合っています。少し時間をおいてお試しください", "busy");
}

function errorOut(err) {
  if (err instanceof ApiError) return { error: err.message, status: err.status, code: err.code };
  console.error(err);
  return { error: "サーバーでエラーが起きました。時間をおいてもう一度お試しください", status: 500 };
}

// ---------- 管理画面（管理者用URL） ----------
function doGet() {
  // 1ファイル版（Bundle.gs）では ADMIN_HTML に管理画面のHTMLが入っている
  const t = typeof ADMIN_HTML !== "undefined" ? HtmlService.createTemplate(ADMIN_HTML) : HtmlService.createTemplateFromFile("Admin");
  t.siteUrl = siteUrl();
  return t.evaluate().setTitle("予約管理 | mowaプログラミング教室").addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function currentAdmin() {
  const email = String(Session.getActiveUser().getEmail() || "").toLowerCase();
  if (!email) return null;
  const owner = String(Session.getEffectiveUser().getEmail() || "").toLowerCase();
  const admins = (store.getSettings().admins || []).map((a) => a.toLowerCase());
  return email === owner || admins.indexOf(email) >= 0 ? email : null;
}

// 管理画面から google.script.run.api(...) で呼ばれる
function api(json) {
  MEMO = {};
  let out;
  try {
    const email = currentAdmin();
    if (!email) throw new ApiError(403, "この管理画面を開く権限がありません。教室の管理者に、設定の「管理者」へ追加してもらってください", "forbidden");
    const req = JSON.parse(json);
    const result = createApi(store, {}).handle(req.method, req.path, req.query || {}, req.body || {}, { admin: true, adminEmail: email, notify });
    if (req.path === "/api/admin/me") result.sheetUrl = SpreadsheetApp.getActiveSpreadsheet().getUrl();
    out = { result };
  } catch (err) { out = errorOut(err); }
  return JSON.stringify(out);
}

// ---------- 毎朝9時：前日のお知らせと、古い個人情報の削除 ----------
function dailyJob() {
  try { sendDigest(); } catch (e) { console.error("digest failed", e); }
  const settings = store.getSettings();
  const tomorrow = addDays(nowJST().date, 1);
  const res = {};
  rows("reservations", RES_COLS).forEach((r) => { res[r.id] = r; });
  lessonRows().filter((l) => l.date === tomorrow && l.status === "active" && !l.reminded).forEach((l) => {
    const r = res[l.reservation_id];
    if (!r || r.anonymized === "1" || !r.email) return;
    try {
      MailApp.sendEmail({ to: r.email, name: settings.schoolName, replyTo: replyTo(), subject: `【${settings.schoolName}】明日のレッスンのお知らせ`,
        body: `${r.parent_name} 様\n\n明日 ${formatDateJa(l.date)} ${l.time}〜${endTime(l.time, settings, l.date)} は、${r.child_name}さんのレッスンです。お待ちしています。\n\n予約の確認：${siteUrl()}/reservation.html#${r.token}\n\n${settings.schoolName}` });
      setCell("lessons", l._row, 6, "1");
    } catch (e) { console.error("reminder failed", e); }
  });
  // レッスンの月から1年過ぎた予約は、名前と連絡先を消す
  const cutoff = addDays(nowJST().date, -365).slice(0, 7);
  rows("reservations", RES_COLS).forEach((r) => {
    if (r.anonymized !== "1" && r.month < cutoff) {
      sheet("reservations").getRange(r._row, 5, 1, 8).setNumberFormat("@").setValues([["(削除済み)", r.grade, "(削除済み)", "", "", "", r.created_at, "1"]]);
    }
  });
}
