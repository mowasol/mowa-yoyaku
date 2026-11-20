// 自動生成ファイル。直接編集しない（docs/js/schedule.js と core.js を直して tools/build_gas.py を実行）

// ===== schedule.js =====
// 予約枠の計算ロジック（画面とサーバー(Worker)の両方で共通利用）
// 日付は "YYYY-MM-DD"、時刻は "HH:MM"、すべて日本時間で扱う。

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

const GRADES = ["年長", "小1", "小2", "小3", "小4", "小5", "小6", "中1", "中2", "中3", "高校生", "その他"];

// 土日のコマ（①9:00〜10:30 ②11:00〜12:30 ③14:00〜15:30 ④16:00〜17:00）
function WEEKEND_SLOTS() {
  return [
    { start: "09:00", end: "10:30" },
    { start: "11:00", end: "12:30" },
    { start: "14:00", end: "15:30" },
    { start: "16:00", end: "17:00" },
  ];
}

const DEFAULT_SETTINGS = {
  schoolName: "mowaプログラミング教室",
  // コース（内容はお子さまごとに個別。回数だけが違う）
  plans: [
    { id: "m1", name: "月1回コース", times: 1 },
    { id: "m2", name: "月2回コース", times: 2 },
  ],
  lessonMinutes: 60,   // （旧方式の予備）コマの時刻が決まっていない曜日で使う1コマの長さ
  capacity: 4,         // 1コマの定員
  // 曜日ごとのコマ（0=日 ... 6=土）。slots に開始・終了を1コマずつ書く
  weekly: {
    0: { open: true, slots: WEEKEND_SLOTS() },
    1: { open: true, slots: [{ start: "17:30", end: "19:00" }] },
    2: { open: true, slots: [{ start: "17:30", end: "19:00" }] },
    3: { open: true, slots: [{ start: "17:30", end: "19:00" }] },
    4: { open: true, slots: [{ start: "17:30", end: "19:00" }] },
    5: { open: true, slots: [{ start: "17:30", end: "19:00" }] },
    6: { open: true, slots: WEEKEND_SLOTS() },
  },
  // 予約ページに出す「ほかの時間の相談」の案内（空なら非表示）
  consultNote: "上記以外の時間をご希望の場合は、お気軽にご相談ください。",
  contactEmail: "school@mowasol.com",
  // 同じ曜日は月4回まで。5回目（第5週）はお休み。0 にすると制限なし
  maxPerWeekdayPerMonth: 4,
  bookingOpenDaysAhead: 62,    // 何日先まで予約できるか
  bookingCloseHoursBefore: 24, // 何時間前まで予約できるか
  cancelHoursBefore: 24,       // 何時間前までキャンセル・変更できるか
  notice: "",                  // トップに出すお知らせ（空なら非表示）
  admins: [],                  // 管理画面に入れるGoogleアカウント（公開した本人は常に入れる）
};

const pad = (n) => String(n).padStart(2, "0");
const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const toHHMM = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

function parseDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

function daysInMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function monthDates(month) {
  const n = daysInMonth(month);
  return Array.from({ length: n }, (_, i) => `${month}-${pad(i + 1)}`);
}

function addMonths(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}

function addDays(dateStr, delta) {
  const { y, m, d } = parseDate(dateStr);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// 日本時間の「今」
function nowJST(nowMs = Date.now()) {
  const t = new Date(nowMs + 9 * 3600 * 1000);
  const date = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  return { date, month: date.slice(0, 7), minutes: t.getUTCHours() * 60 + t.getUTCMinutes(), ms: nowMs };
}

// 日本時間の日時 → UTCミリ秒
function jstToMs(dateStr, hhmm) {
  const { y, m, d } = parseDate(dateStr);
  return Date.UTC(y, m - 1, d) + toMin(hhmm) * 60000 - 9 * 3600 * 1000;
}

// その日が「その月の第何回目のその曜日」か
const nthWeekday = (dateStr) => Math.ceil(parseDate(dateStr).d / 7);

// その日の営業状況。overrides: { "YYYY-MM-DD": { open: bool, note } }
function dayInfo(dateStr, settings, overrides = {}) {
  const { dow } = parseDate(dateStr);
  const rule = settings.weekly[dow] || { open: false };
  const ov = overrides[dateStr];
  let open = !!rule.open;
  let reason = open ? "" : "定休日";
  const max = Number(settings.maxPerWeekdayPerMonth) || 0;
  if (open && max > 0 && nthWeekday(dateStr) > max) { open = false; reason = `第${nthWeekday(dateStr)}${WEEKDAYS[dow]}曜はお休み`; }
  if (ov) { open = !!ov.open; reason = ov.note || (open ? "" : "お休み"); }
  return { date: dateStr, dow, open, reason, slots: open ? slotTimes(rule, settings) : [] };
}

// その曜日のコマ一覧 [{start, end}]（時刻を個別に決めた slots を優先。無ければ営業時間から作る）
function slotsOf(rule, settings) {
  if (!rule) return [];
  if (Array.isArray(rule.slots)) return rule.slots.filter((s) => s && s.start && s.end).slice().sort((a, b) => a.start.localeCompare(b.start));
  const len = Number(settings.lessonMinutes) || 60;
  return legacySlotTimes(rule, settings).map((t) => ({ start: t, end: toHHMM(toMin(t) + len) }));
}

// コマの開始時刻の一覧
function slotTimes(rule, settings) {
  return slotsOf(rule, settings).map((s) => s.start);
}

// 旧方式：営業時間を「1コマの長さ」で区切る
function legacySlotTimes(rule, settings) {
  if (!rule || !rule.start || !rule.end) return [];
  const len = Number(settings.lessonMinutes) || 60;
  const s = toMin(rule.start), e = toMin(rule.end);
  const bs = rule.breakStart ? toMin(rule.breakStart) : null;
  const be = rule.breakEnd ? toMin(rule.breakEnd) : null;
  const out = [];
  let t = s;
  while (t + len <= e) {
    if (bs !== null && be !== null && t < be && t + len > bs) { t = be; continue; }
    out.push(toHHMM(t));
    t += len;
  }
  return out;
}

// 予約受付中か（締切・受付開始の判定）
function isBookable(dateStr, hhmm, settings, nowMs = Date.now()) {
  const start = jstToMs(dateStr, hhmm);
  if (start - nowMs < (Number(settings.bookingCloseHoursBefore) || 0) * 3600000) return false;
  const limit = addDays(nowJST(nowMs).date, Number(settings.bookingOpenDaysAhead) || 60);
  return dateStr <= limit;
}

function canCancel(dateStr, hhmm, settings, nowMs = Date.now()) {
  return jstToMs(dateStr, hhmm) - nowMs >= (Number(settings.cancelHoursBefore) || 0) * 3600000;
}

// コマの終了時刻。日付が分かればその曜日のコマ表から引く（コマごとに長さが違うため）
function endTime(hhmm, settings, dateStr) {
  if (dateStr) {
    const hit = slotsOf(settings.weekly[parseDate(dateStr).dow], settings).find((s) => s.start === hhmm);
    if (hit) return hit.end;
  }
  return toHHMM(toMin(hhmm) + (Number(settings.lessonMinutes) || 60));
}

function formatDateJa(dateStr) {
  const { m, d, dow } = parseDate(dateStr);
  return `${m}月${d}日(${WEEKDAYS[dow]})`;
}

// 設定値の検証。問題があればエラーメッセージを返す
function validateSettings(s) {
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!Array.isArray(s.plans) || !s.plans.length) return "コースが設定されていません";
  for (const p of s.plans) if (!p.id || !p.name || !(p.times >= 1 && p.times <= 8)) return "コースの設定が正しくありません";
  if (!(s.capacity >= 1 && s.capacity <= 50)) return "定員は1〜50人にしてください";
  if (!Array.isArray(s.admins) || s.admins.length > 30 || s.admins.some((a) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a))) return "管理者のメールアドレスを確認してください";
  for (let i = 0; i < 7; i++) {
    const r = s.weekly?.[i];
    if (!r) return `${WEEKDAYS[i]}曜日の設定がありません`;
    if (!r.open) continue;
    if (!Array.isArray(r.slots) || !r.slots.length) return `${WEEKDAYS[i]}曜日のコマを1つ以上入れてください（休みなら「営業」を外す）`;
    if (r.slots.length > 12) return `${WEEKDAYS[i]}曜日のコマは12個までです`;
    const sorted = r.slots.slice().sort((a, b) => String(a.start).localeCompare(String(b.start)));
    for (let k = 0; k < sorted.length; k++) {
      const c = sorted[k];
      if (!hhmm.test(c.start || "") || !hhmm.test(c.end || "") || toMin(c.start) >= toMin(c.end)) return `${WEEKDAYS[i]}曜日のコマの開始・終了時刻を確認してください`;
      if (k > 0 && toMin(c.start) < toMin(sorted[k - 1].end)) return `${WEEKDAYS[i]}曜日のコマの時間が重なっています`;
    }
  }
  return null;
}

// ===== core.js =====
// 予約APIの中身（ルール判定）。保存先(store)を差し替えて、
// 本番は Google Apps Script（スプレッドシート）、お試しモードはブラウザ内で同じ動きをする。
// Apps Script 用には tools/build_gas.py で gas/Shared.gs に変換する。

class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const bad = (msg, code = "bad_request") => new ApiError(400, msg, code);

function mergeSettings(saved) {
  const s = { ...DEFAULT_SETTINGS, ...(saved || {}) };
  s.weekly = { ...DEFAULT_SETTINGS.weekly, ...(saved?.weekly || {}) };
  // 旧方式（営業時間＋1コマの長さ）で保存された曜日は、新しい標準のコマ割りに置きかえる
  for (const d of Object.keys(s.weekly)) {
    const r = s.weekly[d];
    if (r && !Array.isArray(r.slots)) s.weekly[d] = structuredCloneSafe(DEFAULT_SETTINGS.weekly[d] || { open: false, slots: [] });
  }
  return s;
}

const structuredCloneSafe = (v) => JSON.parse(JSON.stringify(v));

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(v, max, label, required = true) {
  const s = typeof v === "string" ? v.trim() : "";
  if (required && !s) throw bad(`${label}を入力してください`);
  if (s.length > max) throw bad(`${label}は${max}文字以内で入力してください`);
  return s;
}

function randomToken() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function createApi(store, opts = {}) {
  const now = () => (opts.now ? opts.now() : Date.now());

  function availability(month) {
    if (!MONTH_RE.test(month)) throw bad("月の指定が正しくありません");
    const settings = store.getSettings();
    const dates = monthDates(month);
    const overrides = store.getOverrides(dates[0], dates[dates.length - 1]);
    const counts = store.countActive(dates[0], dates[dates.length - 1]);
    const t = now();
    const days = dates.map((date) => {
      const info = dayInfo(date, settings, overrides);
      return {
        date, open: info.open, reason: info.reason,
        slots: info.slots.map((time) => {
          const remaining = Math.max(0, settings.capacity - (counts[`${date} ${time}`] || 0));
          return { time, end: endTime(time, settings, date), remaining, bookable: remaining > 0 && isBookable(date, time, settings, t) };
        }),
      };
    });
    return { month, capacity: settings.capacity, days };
  }

  // 指定のコマが今予約できるか（定員以外）をサーバー側で再確認
  function assertSlotValid(settings, date, time) {
    if (!DATE_RE.test(date) || !TIME_RE.test(time)) throw bad("日時の指定が正しくありません");
    const overrides = store.getOverrides(date, date);
    const info = dayInfo(date, settings, overrides);
    if (!info.open || !info.slots.includes(time)) throw bad(`${formatDateJa(date)} ${time} は予約できない時間です`);
    if (!isBookable(date, time, settings, now())) throw bad(`${formatDateJa(date)} ${time} は受付期間外です`);
  }

  function publicReservation(res, lessons, settings) {
    const t = now();
    const plan = settings.plans.find((p) => p.id === res.plan);
    return {
      planName: plan ? plan.name : res.plan, planTimes: plan ? plan.times : 1,
      month: res.month, childName: res.child_name, grade: res.grade,
      parentName: res.parent_name, email: res.email, phone: res.phone, note: res.note,
      createdAt: res.created_at,
      lessons: lessons.map((l) => ({
        id: l.id, date: l.date, time: l.time, end: endTime(l.time, settings, l.date), status: l.status,
        canCancel: l.status === "active" && canCancel(l.date, l.time, settings, t),
      })),
      cancelHoursBefore: settings.cancelHoursBefore,
    };
  }

  function createReservation(body, ctx) {
    const settings = store.getSettings();
    const plan = settings.plans.find((p) => p.id === body.plan);
    if (!plan) throw bad("コースを選んでください");
    const lessons = Array.isArray(body.lessons) ? body.lessons : [];
    if (lessons.length !== plan.times) throw bad(`${plan.name}は${plan.times}回分の日時を選んでください`);
    const month = lessons[0]?.date?.slice(0, 7);
    const seen = new Set();
    for (const l of lessons) {
      if (l.date?.slice(0, 7) !== month) throw bad("同じ月の中で日時を選んでください");
      if (seen.has(l.date)) throw bad("1日に1回までです。別の日を選んでください");
      seen.add(l.date);
      assertSlotValid(settings, l.date, l.time);
    }
    const email = str(body.email, 120, "メールアドレス");
    if (!EMAIL_RE.test(email)) throw bad("メールアドレスの形式を確認してください");
    if (!GRADES.includes(body.grade)) throw bad("学年を選んでください");
    if (!body.agree) throw bad("個人情報の取り扱いへの同意が必要です");
    if (body.website) throw bad("送信できませんでした。ページを再読み込みしてお試しください"); // ボット用のわな欄
    const res = {
      id: randomToken().slice(0, 16), token: randomToken(), plan: plan.id, month,
      child_name: str(body.childName, 40, "お子さまのお名前"), grade: body.grade,
      parent_name: str(body.parentName, 40, "保護者のお名前"), email,
      phone: str(body.phone, 20, "電話番号", false), note: str(body.note, 500, "ご要望", false),
      created_at: new Date(now()).toISOString(),
    };
    const sorted = [...lessons].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    store.createReservation(res, sorted.map((l) => ({ date: l.date, time: l.time })), settings.capacity);
    const saved = store.getReservation(res.token);
    const out = publicReservation(saved.res, saved.lessons, settings);
    ctx?.notify?.("created", { token: res.token, reservation: out, settings });
    return { token: res.token, reservation: out };
  }

  function getByToken(token) {
    if (!/^[0-9a-f]{48}$/.test(token || "")) throw new ApiError(404, "予約が見つかりません", "not_found");
    const found = store.getReservation(token);
    if (!found) throw new ApiError(404, "予約が見つかりません", "not_found");
    return found;
  }

  function cancelLesson(token, body, ctx) {
    const settings = store.getSettings();
    const { res, lessons } = getByToken(token);
    const l = lessons.find((x) => x.id === Number(body.lessonId));
    if (!l || l.status !== "active") throw bad("キャンセルできる予約がありません");
    if (!canCancel(l.date, l.time, settings, now())) throw bad(`開始${settings.cancelHoursBefore}時間前を過ぎたため、Webではキャンセルできません。教室へご連絡ください`);
    store.cancelLesson(l.id, res.id);
    const saved = store.getReservation(token);
    const out = publicReservation(saved.res, saved.lessons, settings);
    ctx?.notify?.("cancelled", { token, reservation: out, lesson: l, settings });
    return { reservation: out };
  }

  // 日時の変更（lessonId あり）または、キャンセル後の追加（lessonId なし）
  function changeLesson(token, body, ctx) {
    const settings = store.getSettings();
    const { res, lessons } = getByToken(token);
    const plan = settings.plans.find((p) => p.id === res.plan);
    const active = lessons.filter((l) => l.status === "active");
    let old = null;
    if (body.lessonId) {
      old = active.find((x) => x.id === Number(body.lessonId));
      if (!old) throw bad("変更できる予約がありません");
      if (!canCancel(old.date, old.time, settings, now())) throw bad(`開始${settings.cancelHoursBefore}時間前を過ぎたため、Webでは変更できません。教室へご連絡ください`);
    } else if (active.length >= (plan?.times || 1)) {
      throw bad("この月の回数分はすでに予約済みです");
    }
    if (body.date?.slice(0, 7) !== res.month) throw bad("同じ月の中で日時を選んでください");
    if (active.some((l) => l.date === body.date && l !== old)) throw bad("1日に1回までです。別の日を選んでください");
    assertSlotValid(settings, body.date, body.time);
    store.replaceLesson(old ? old.id : null, res.id, { date: body.date, time: body.time }, settings.capacity);
    const saved = store.getReservation(token);
    const out = publicReservation(saved.res, saved.lessons, settings);
    ctx?.notify?.("changed", { token, reservation: out, from: old, to: body, settings });
    return { reservation: out };
  }

  // ---- 管理者用 ----
  function adminLessons(month) {
    if (!MONTH_RE.test(month)) throw bad("月の指定が正しくありません");
    const settings = store.getSettings();
    const dates = monthDates(month);
    const rows = store.listLessons(dates[0], dates[dates.length - 1]);
    const overrides = store.getOverrides(dates[0], dates[dates.length - 1]);
    const days = dates.map((d) => dayInfo(d, settings, overrides));
    return {
      month, capacity: settings.capacity, days,
      lessons: rows.map((r) => ({
        id: r.id, date: r.date, time: r.time, end: endTime(r.time, settings, r.date), status: r.status,
        plan: settings.plans.find((p) => p.id === r.plan)?.name || r.plan,
        childName: r.child_name, grade: r.grade, parentName: r.parent_name,
        email: r.email, phone: r.phone, note: r.note, reservationId: r.reservation_id,
      })),
      overrides,
    };
  }

  function adminCsv(month) {
    const data = adminLessons(month);
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["日付", "開始", "終了", "状態", "コース", "お子さま", "学年", "保護者", "メール", "電話", "ご要望"];
    const lines = data.lessons.map((l) => [l.date, l.time, l.end, l.status === "active" ? "予約" : "キャンセル", l.plan, l.childName, l.grade, l.parentName, l.email, l.phone, l.note].map(esc).join(","));
    return "﻿" + [head.map(esc).join(","), ...lines].join("\r\n");
  }

  function handle(method, path, query = {}, body = {}, ctx = {}) {
    const seg = path.replace(/^\/api\//, "").split("/").filter(Boolean);
    const isAdmin = seg[0] === "admin";
    if (isAdmin && !ctx.admin) throw new ApiError(403, "管理者としてログインしてください", "forbidden");

    if (method === "GET" && path === "/api/config") {
      const s = store.getSettings();
      const { date } = nowJST(now());
      return {
        schoolName: s.schoolName, plans: s.plans, lessonMinutes: s.lessonMinutes, capacity: s.capacity,
        weekly: s.weekly, maxPerWeekdayPerMonth: s.maxPerWeekdayPerMonth, notice: s.notice,
        consultNote: s.consultNote, contactEmail: s.contactEmail,
        bookingCloseHoursBefore: s.bookingCloseHoursBefore, cancelHoursBefore: s.cancelHoursBefore,
        bookingOpenDaysAhead: s.bookingOpenDaysAhead,
        today: date, turnstileSiteKey: opts.turnstileSiteKey || "", grades: GRADES,
      };
    }
    if (method === "GET" && path === "/api/availability") return availability(query.month || nowJST(now()).month);
    if (method === "POST" && path === "/api/reservations") return createReservation(body, ctx);
    if (seg[0] === "reservations" && seg[1]) {
      if (method === "GET" && seg.length === 2) {
        const s = store.getSettings();
        const { res, lessons } = getByToken(seg[1]);
        return { reservation: publicReservation(res, lessons, s) };
      }
      if (method === "POST" && seg[2] === "cancel") return cancelLesson(seg[1], body, ctx);
      if (method === "POST" && seg[2] === "change") return changeLesson(seg[1], body, ctx);
    }

    if (isAdmin) {
      if (method === "GET" && seg[1] === "me") return { email: ctx.adminEmail || "" };
      if (method === "GET" && seg[1] === "settings") return { settings: store.getSettings() };
      if (method === "PUT" && seg[1] === "settings") {
        const s = mergeSettings(body.settings);
        s.lessonMinutes = Number(s.lessonMinutes); s.capacity = Number(s.capacity);
        s.maxPerWeekdayPerMonth = Number(s.maxPerWeekdayPerMonth) || 0;
        s.bookingOpenDaysAhead = Number(s.bookingOpenDaysAhead); s.bookingCloseHoursBefore = Number(s.bookingCloseHoursBefore);
        s.cancelHoursBefore = Number(s.cancelHoursBefore);
        s.consultNote = String(s.consultNote || "").slice(0, 200);
        s.contactEmail = String(s.contactEmail || "").trim().slice(0, 120);
        for (const d of Object.keys(s.weekly)) {
          const r = s.weekly[d];
          s.weekly[d] = { open: !!r.open, slots: (r.slots || []).map((c) => ({ start: c.start, end: c.end })).sort((a, b) => String(a.start).localeCompare(String(b.start))) };
        }
        const err = validateSettings(s);
        if (err) throw bad(err);
        store.saveSettings(s);
        return { settings: s };
      }
      if (method === "GET" && seg[1] === "lessons") return adminLessons(query.month || nowJST(now()).month);
      if (method === "GET" && seg[1] === "export.csv") return { __csv: adminCsv(query.month || nowJST(now()).month) };
      if (method === "POST" && seg[1] === "lessons" && seg[3] === "cancel") {
        store.adminCancelLesson(Number(seg[2]));
        return { ok: true };
      }
      if (seg[1] === "overrides" && DATE_RE.test(seg[2] || "")) {
        if (method === "PUT") {
          store.setOverride(seg[2], { open: !!body.open, note: str(body.note, 40, "メモ", false) });
          return { ok: true };
        }
        if (method === "DELETE") { store.deleteOverride(seg[2]); return { ok: true }; }
      }
    }
    throw new ApiError(404, "見つかりません", "not_found");
  }

  return { handle, availability, nextMonth: (m) => addMonths(m, 1) };
}
