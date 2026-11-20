// 予約画面と確認画面で共通の表示部品
import { WEEKDAYS, parseDate, slotTimes } from "./schedule.js";

export const $ = (s, el = document) => el.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function monthLabel(month) { const [y, m] = month.split("-"); return `${y}年 ${Number(m)}月`; }

// 営業時間のまとめ（例：平日 17:00〜19:00 / 土日 9:00〜17:30）
export function hoursSummary(cfg) {
  const groups = new Map();
  for (let d = 0; d < 7; d++) {
    const r = cfg.weekly[d];
    const key = r?.open ? `${trim0(r.start)}〜${trim0(r.end)}` : "お休み";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  const label = (days) => {
    const s = days.join(",");
    if (s === "1,2,3,4,5") return "平日（月〜金）";
    if (s === "0,6") return "土日";
    if (s === "0,1,2,3,4,5,6") return "毎日";
    return days.map((d) => WEEKDAYS[d]).join("・");
  };
  const order = (a, b) => (a[1].includes(0) && a[1].length <= 2 ? 1 : 0) - (b[1].includes(0) && b[1].length <= 2 ? 1 : 0);
  return [...groups.entries()].filter(([k]) => k !== "お休み").sort(order).map(([value, days]) => {
    const r = cfg.weekly[days[0]];
    const n = slotTimes(r, cfg).length;
    return { label: label(days), value, sub: r.breakStart ? `休憩 ${trim0(r.breakStart)}〜${trim0(r.breakEnd)}・1日${n}コマ` : `1日${n}コマ` };
  });
}
const trim0 = (t) => t.replace(/^0/, "");

export function dayState(day, today) {
  if (day.date < today) return { cls: "past", mk: "" };
  if (!day.open) return { cls: "off", mk: "休" };
  const ok = day.slots.filter((s) => s.bookable);
  if (!ok.length) {
    return day.slots.some((s) => s.remaining > 0) ? { cls: "past", mk: "受付外" } : { cls: "full", mk: "×満席" };
  }
  const rest = ok.reduce((a, s) => a + s.remaining, 0);
  return rest <= 2 ? { cls: "few", mk: "△" } : { cls: "ok", mk: "○" };
}

// カレンダー描画。onPick(date) で日付クリックを受け取る
export function renderCalendar(el, avail, { today, selected, picked = new Set(), onPick }) {
  const first = parseDate(avail.days[0].date).dow;
  let html = WEEKDAYS.map((w, i) => `<div class="dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</div>`).join("");
  html += Array.from({ length: first }, () => `<div class="day blank" aria-hidden="true"></div>`).join("");
  for (const day of avail.days) {
    const st = dayState(day, today);
    const d = parseDate(day.date).d;
    const clickable = st.cls === "ok" || st.cls === "few" || picked.has(day.date);
    const cls = ["day", st.cls, picked.has(day.date) ? "picked" : ""].join(" ");
    const title = day.open ? "" : ` title="${esc(day.reason)}"`;
    html += clickable
      ? `<button type="button" class="${cls}" data-date="${day.date}" aria-pressed="${selected === day.date}" aria-label="${d}日 ${st.mk}"><span class="num">${d}</span><span class="mk">${picked.has(day.date) ? "予約" : st.mk}</span></button>`
      : `<div class="${cls}"${title}><span class="num">${d}</span><span class="mk">${esc(st.mk)}</span></div>`;
  }
  el.innerHTML = html;
  el.querySelectorAll("button.day").forEach((b) => b.addEventListener("click", () => onPick(b.dataset.date)));
}

export function renderSlots(el, day, { isChosen, onToggle, disabledText }) {
  el.innerHTML = day.slots.map((s) => {
    const chosen = isChosen(s.time);
    const dis = !chosen && (!s.bookable);
    const r = chosen ? "えらび中" : s.remaining === 0 ? "満席" : !s.bookable ? (disabledText || "受付外") : `残り${s.remaining}`;
    return `<button type="button" class="slot ${s.remaining <= 1 && s.bookable ? "few" : ""}" data-time="${s.time}" aria-pressed="${chosen}" ${dis ? "disabled" : ""}>
      <span class="t">${s.time}〜${s.end}</span><span class="r">${r}</span></button>`;
  }).join("");
  el.querySelectorAll("button.slot").forEach((b) => b.addEventListener("click", () => onToggle(b.dataset.time)));
}

export function showErr(el, msg) { el.textContent = msg; el.hidden = !msg; if (msg) el.scrollIntoView({ block: "nearest", behavior: "smooth" }); }

export function storage(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value));
  } catch { return null; }
}

export async function copyText(text, input) {
  try { await navigator.clipboard.writeText(text); return true; } catch { input?.select(); return false; }
}
