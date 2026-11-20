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
 *   ADMIN_NOTIFY_EMAIL 新規予約の通知先（空なら通知しない）
 */

const SHEETS = {
  settings: { name: "設定", head: ["項目", "内容(JSON)"] },
  overrides: { name: "休業日", head: ["日付", "営業(1/0)", "メモ"] },
  reservations: { name: "予約", head: ["id", "token", "コース", "月", "お子さま", "学年", "保護者", "メール", "電話", "ご要望", "受付日時", "匿名化"] },
  lessons: { name: "レッスン", head: ["id", "予約id", "日付", "時刻", "状態", "前日通知", "カレンダー予定ID"] },
};
const RES_COLS = ["id", "token", "plan", "month", "child_name", "grade", "parent_name", "email", "phone", "note", "created_at", "anonymized"];
const LES_COLS = ["id", "reservation_id", "date", "time", "status", "reminded", "event_id"];

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
  SpreadsheetApp.getUi().alert("初期設定が終わりました。次に「デプロイ」から公開してください。");
}

// ---------- シートの読み書き ----------
function sheet(k) { return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS[k].name); }
function rows(k, cols) {
  const sh = sheet(k);
  const n = sh.getLastRow() - 1;
  if (n <= 0) return [];
  return sh.getRange(2, 1, n, cols.length).getValues().map((r, i) => {
    const o = { _row: i + 2 };
    cols.forEach((c, j) => { o[c] = r[j] === "" ? "" : String(r[j]); });
    return o;
  });
}
function lessonRows() { return rows("lessons", LES_COLS).map((l) => ({ ...l, id: Number(l.id), reminded: l.reminded === "1" })); }
function setCell(k, row, col, value) { sheet(k).getRange(row, col).setValue(value); }
function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}
const full = () => new ApiError(409, "タッチの差で満席になったコマがあります。別の日時を選び直してください", "full");

const store = {
  getSettings() {
    const v = sheet("settings").getRange("B2").getValue();
    return mergeSettings(v ? JSON.parse(v) : null);
  },
  saveSettings(s) { sheet("settings").getRange("A2:B2").setValues([["settings", JSON.stringify(s)]]); },
  getOverrides(from, to) {
    const out = {};
    rows("overrides", ["date", "open", "note"]).forEach((r) => { if (r.date >= from && r.date <= to) out[r.date] = { open: r.open === "1", note: r.note }; });
    return out;
  },
  setOverride(date, v) {
    const r = rows("overrides", ["date", "open", "note"]).find((x) => x.date === date);
    const vals = [[date, v.open ? "1" : "0", v.note || ""]];
    if (r) sheet("overrides").getRange(r._row, 1, 1, 3).setValues(vals); else sheet("overrides").appendRow(vals[0]);
  },
  deleteOverride(date) {
    const r = rows("overrides", ["date", "open", "note"]).find((x) => x.date === date);
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
      if (lessons.some((l) => count(l.date, l.time) >= capacity)) throw full();
      sheet("reservations").appendRow(RES_COLS.map((c) => (c === "anonymized" ? "0" : r[c] || "")));
      let id = all.reduce((m, l) => Math.max(m, l.id), 0);
      for (const l of lessons) {
        id += 1;
        sheet("lessons").appendRow([String(id), r.id, l.date, l.time, "active", "0", ""]);
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
      if (n >= capacity) throw full();
      if (old) setCell("lessons", old._row, 5, "cancelled");
      const id = all.reduce((m, x) => Math.max(m, x.id), 0) + 1;
      sheet("lessons").appendRow([String(id), rid, l.date, l.time, "active", "0", ""]);
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
    const l = lessonRows().find((x) => x.id === id);
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
        const ev = cal.createEvent(`${r.child_name}（${r.grade}）`, jstDate(l.date, l.time), jstDate(l.date, endTime(l.time, settings)),
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
    MailApp.sendEmail({ to: rv.email, subject: `【${school}】${title}`, body, name: school });
    const admin = props().getProperty("ADMIN_NOTIFY_EMAIL");
    if (admin) MailApp.sendEmail({ to: admin, subject: `[予約${{ created: "新規", cancelled: "キャンセル", changed: "変更" }[kind]}] ${rv.childName}（${rv.grade}）`, body: `${rv.planName}\n${lessonLines(rv)}\n保護者：${rv.parentName}\nメール：${rv.email}\n電話：${rv.phone}\nご要望：${rv.note}`, name: school });
  } catch (e) { console.error("mail failed", e); }
}

// ---------- 予約ページからの受付（公開URL） ----------
function doPost(e) {
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
  const t = HtmlService.createTemplateFromFile("Admin");
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
  const settings = store.getSettings();
  const tomorrow = addDays(nowJST().date, 1);
  const res = {};
  rows("reservations", RES_COLS).forEach((r) => { res[r.id] = r; });
  lessonRows().filter((l) => l.date === tomorrow && l.status === "active" && !l.reminded).forEach((l) => {
    const r = res[l.reservation_id];
    if (!r || r.anonymized === "1" || !r.email) return;
    try {
      MailApp.sendEmail({ to: r.email, name: settings.schoolName, subject: `【${settings.schoolName}】明日のレッスンのお知らせ`,
        body: `${r.parent_name} 様\n\n明日 ${formatDateJa(l.date)} ${l.time}〜${endTime(l.time, settings)} は、${r.child_name}さんのレッスンです。お待ちしています。\n\n予約の確認：${siteUrl()}/reservation.html#${r.token}\n\n${settings.schoolName}` });
      setCell("lessons", l._row, 6, "1");
    } catch (e) { console.error("reminder failed", e); }
  });
  // レッスンの月から1年過ぎた予約は、名前と連絡先を消す
  const cutoff = addDays(nowJST().date, -365).slice(0, 7);
  rows("reservations", RES_COLS).forEach((r) => {
    if (r.anonymized !== "1" && r.month < cutoff) {
      sheet("reservations").getRange(r._row, 5, 1, 8).setValues([["(削除済み)", r.grade, "(削除済み)", "", "", "", r.created_at, "1"]]);
    }
  });
}
