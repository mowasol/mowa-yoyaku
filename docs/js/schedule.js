// 予約枠の計算ロジック（画面とサーバー(Worker)の両方で共通利用）
// 日付は "YYYY-MM-DD"、時刻は "HH:MM"、すべて日本時間で扱う。

export const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

export const GRADES = ["年長", "小1", "小2", "小3", "小4", "小5", "小6", "中1", "中2", "中3", "高校生", "その他"];

// 土日のコマ（①9:00〜10:30 ②11:00〜12:30 ③14:00〜15:30 ④16:00〜17:00）
function WEEKEND_SLOTS() {
  return [
    { start: "09:00", end: "10:30" },
    { start: "11:00", end: "12:30" },
    { start: "14:00", end: "15:30" },
    { start: "16:00", end: "17:00" },
  ];
}

export const DEFAULT_SETTINGS = {
  schoolName: "mowaプログラミング教室",
  schemaVersion: 2,
  // コース（内容はお子さまごとに個別。times は「ひと月に予約できる上限回数」）
  plans: [
    { id: "w1", name: "週1回コース", times: 4, desc: "毎週かよう方。ひと月4回まで" },
    { id: "bw", name: "隔週コース", times: 2, desc: "2週に1回かよう方。ひと月2回まで" },
  ],
  lessonMinutes: 60,   // （旧方式の予備）コマの時刻が決まっていない曜日で使う1コマの長さ
  capacity: 6,         // 1コマの定員（日ごとに「営業日」で変えられる）
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
  // 教室への通知：smart＝当日・翌日分だけすぐ＋ほかは毎朝まとめ／each＝すべてすぐ／digest＝毎朝まとめだけ／off＝送らない
  notifyMode: "smart",
};

export const pad = (n) => String(n).padStart(2, "0");
export const toMin = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
export const toHHMM = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

export function parseDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

export function daysInMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthDates(month) {
  const n = daysInMonth(month);
  return Array.from({ length: n }, (_, i) => `${month}-${pad(i + 1)}`);
}

export function addMonths(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}

export function addDays(dateStr, delta) {
  const { y, m, d } = parseDate(dateStr);
  const t = new Date(Date.UTC(y, m - 1, d + delta));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// 日本時間の「今」
export function nowJST(nowMs = Date.now()) {
  const t = new Date(nowMs + 9 * 3600 * 1000);
  const date = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
  return { date, month: date.slice(0, 7), minutes: t.getUTCHours() * 60 + t.getUTCMinutes(), ms: nowMs };
}

// 日本時間の日時 → UTCミリ秒
export function jstToMs(dateStr, hhmm) {
  const { y, m, d } = parseDate(dateStr);
  return Date.UTC(y, m - 1, d) + toMin(hhmm) * 60000 - 9 * 3600 * 1000;
}

// その日が「その月の第何回目のその曜日」か
export const nthWeekday = (dateStr) => Math.ceil(parseDate(dateStr).d / 7);

// その日の営業状況。overrides: { "YYYY-MM-DD": { open: bool, note } }
export function dayInfo(dateStr, settings, overrides = {}) {
  const { dow } = parseDate(dateStr);
  const rule = settings.weekly[dow] || { open: false };
  const ov = overrides[dateStr];
  let open = !!rule.open;
  let reason = open ? "" : "定休日";
  const max = Number(settings.maxPerWeekdayPerMonth) || 0;
  if (open && max > 0 && nthWeekday(dateStr) > max) { open = false; reason = `第${nthWeekday(dateStr)}${WEEKDAYS[dow]}曜はお休み`; }
  if (ov) { open = !!ov.open; reason = ov.note || (open ? "" : "お休み"); }
  // その日の定員（先生が少ない日などは「営業日」で個別に減らせる）
  const capacity = ov && Number(ov.capacity) > 0 ? Number(ov.capacity) : Number(settings.capacity);
  return { date: dateStr, dow, open, reason, capacity, slots: open ? slotTimes(rule, settings) : [] };
}

// その曜日のコマ一覧 [{start, end}]（時刻を個別に決めた slots を優先。無ければ営業時間から作る）
export function slotsOf(rule, settings) {
  if (!rule) return [];
  if (Array.isArray(rule.slots)) return rule.slots.filter((s) => s && s.start && s.end).slice().sort((a, b) => a.start.localeCompare(b.start));
  const len = Number(settings.lessonMinutes) || 60;
  return legacySlotTimes(rule, settings).map((t) => ({ start: t, end: toHHMM(toMin(t) + len) }));
}

// コマの開始時刻の一覧
export function slotTimes(rule, settings) {
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
export function isBookable(dateStr, hhmm, settings, nowMs = Date.now()) {
  const start = jstToMs(dateStr, hhmm);
  if (start - nowMs < (Number(settings.bookingCloseHoursBefore) || 0) * 3600000) return false;
  const limit = addDays(nowJST(nowMs).date, Number(settings.bookingOpenDaysAhead) || 60);
  return dateStr <= limit;
}

export function canCancel(dateStr, hhmm, settings, nowMs = Date.now()) {
  return jstToMs(dateStr, hhmm) - nowMs >= (Number(settings.cancelHoursBefore) || 0) * 3600000;
}

// コマの終了時刻。日付が分かればその曜日のコマ表から引く（コマごとに長さが違うため）
export function endTime(hhmm, settings, dateStr) {
  if (dateStr) {
    const hit = slotsOf(settings.weekly[parseDate(dateStr).dow], settings).find((s) => s.start === hhmm);
    if (hit) return hit.end;
  }
  return toHHMM(toMin(hhmm) + (Number(settings.lessonMinutes) || 60));
}

export function formatDateJa(dateStr) {
  const { m, d, dow } = parseDate(dateStr);
  return `${m}月${d}日(${WEEKDAYS[dow]})`;
}

// 設定値の検証。問題があればエラーメッセージを返す
export function validateSettings(s) {
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!Array.isArray(s.plans) || !s.plans.length) return "コースが設定されていません";
  for (const p of s.plans) if (!p.id || !p.name || !(p.times >= 1 && p.times <= 8)) return "コースの設定が正しくありません";
  if (!(s.capacity >= 1 && s.capacity <= 50)) return "定員は1〜50人にしてください";
  if (s.notifyMode && !["smart", "each", "digest", "off"].includes(s.notifyMode)) return "通知方法を選んでください";
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
