// 共通の画面部品（React + framer-motion）。ビルド不要で動くよう htm でJSXの代わりに書く。
import React from "react";
import htm from "htm";
import { motion, AnimatePresence } from "framer-motion";
import { WEEKDAYS, parseDate, slotsOf } from "./schedule.js";

export const html = htm.bind(React.createElement);
export { React, motion, AnimatePresence };

// ---- 動きの基準（UI UX Pro Max：ホバー150-200ms、表示300-400ms、段差30ms、遷移200-300ms）----
export const ease = [0.22, 1, 0.36, 1];
export const tap = { scale: 0.96 };
export const hoverLift = { y: -3, transition: { duration: 0.18, ease } };
export const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.35, ease } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2, ease } },
};
export const stagger = (i) => ({ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease, delay: i * 0.03 } } });

export const esc = (s) => String(s ?? "");
export function monthLabel(month) { const [y, m] = month.split("-"); return `${y}年 ${Number(m)}月`; }

export function storage(key, value) {
  try {
    if (value === undefined) return JSON.parse(localStorage.getItem(key));
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value));
  } catch { return null; }
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// ---- ヘッダー・フッター ----
export function Header({ sub, right }) {
  return html`<header className="site-head"><div className="wrap">
    <a className="brand" href="./">
      <${motion.span} className="brand-logo" whileHover=${{ rotate: -6, scale: 1.05 }} transition=${{ type: "spring", stiffness: 400, damping: 15 }}>
        <img src="assets/mowa-neko.jpg" alt="mowaねこ" width="50" height="35" />
      </${motion.span}>
      <span className="brand-name"><span>mowaプログラミング教室</span><small>${sub}</small></span>
    </a>
    ${right}
  </div></header>`;
}

export function Footer() {
  return html`<footer className="site-foot"><div className="wrap"><span>© mowaソリューションズ株式会社</span><a href="privacy.html">個人情報の取り扱い</a></div></footer>`;
}

export function DemoBar({ text, onReset }) {
  return html`<div className="demo-bar">${text}${onReset && html`<button type="button" onClick=${onReset}>見本に戻す</button>`}</div>`;
}

export function ErrorBox({ msg }) {
  return html`<${AnimatePresence}>${msg && html`<${motion.div} key=${msg} className="err" role="alert" initial=${{ opacity: 0, y: -6 }} animate=${{ opacity: 1, y: 0 }} exit=${{ opacity: 0 }}>${msg}</${motion.div}>`}</${AnimatePresence}>`;
}

export function Button({ kind = "", className = "", ...p }) {
  return html`<${motion.button} type="button" className=${`btn ${kind} ${className}`} whileTap=${p.disabled ? undefined : tap} ...${p} />`;
}

// ---- 営業時間のまとめ ----
// 同じコマ割りの曜日をまとめる → [{ label: "平日（月〜金）", slots: [{start,end}] }]
export function hoursSummary(cfg) {
  const groups = new Map();
  for (let d = 0; d < 7; d++) {
    const r = cfg.weekly[d];
    if (!r?.open) continue;
    const slots = slotsOf(r, cfg);
    if (!slots.length) continue;
    const key = slots.map((s) => s.start + "-" + s.end).join(",");
    if (!groups.has(key)) groups.set(key, { days: [], slots });
    groups.get(key).days.push(d);
  }
  const label = (days) => {
    const s = days.join(",");
    if (s === "1,2,3,4,5") return "平日（月〜金）";
    if (s === "0,6") return "土日";
    if (s === "0,1,2,3,4,5,6") return "毎日";
    return days.map((d) => WEEKDAYS[d]).join("・");
  };
  return [...groups.values()].sort((a, b) => (a.days.includes(0) ? 1 : 0) - (b.days.includes(0) ? 1 : 0))
    .map((g) => ({ label: label(g.days), slots: g.slots }));
}

export const trim0 = (t) => String(t).replace(/^0/, "");
const MARKS = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"];
export const slotMark = (i, n) => (n > 1 ? MARKS[i] || `${i + 1}.` : "");

// ---- 予約用カレンダー ----
export function dayState(day, today) {
  if (day.date < today) return { cls: "past", mk: "" };
  if (!day.open) return { cls: "off", mk: "休" };
  const ok = day.slots.filter((s) => s.bookable);
  if (!ok.length) return day.slots.some((s) => s.remaining > 0) ? { cls: "past", mk: "受付外" } : { cls: "full", mk: "×満席" };
  const rest = ok.reduce((a, s) => a + s.remaining, 0);
  return rest <= 2 ? { cls: "few", mk: "△" } : { cls: "ok", mk: "○" };
}

export function Calendar({ avail, today, selected, picked = new Set(), onPick, dir = 0 }) {
  const first = parseDate(avail.days[0].date).dow;
  return html`<${AnimatePresence} mode="wait" initial=${false} custom=${dir}>
    <${motion.div} key=${avail.month} className="cal" role="grid" aria-label="カレンダー"
      initial=${{ opacity: 0, x: dir * 28 }} animate=${{ opacity: 1, x: 0, transition: { duration: 0.28, ease } }} exit=${{ opacity: 0, x: dir * -28, transition: { duration: 0.18 } }}>
      ${WEEKDAYS.map((w, i) => html`<div key=${"w" + i} className=${`dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}`}>${w}</div>`)}
      ${Array.from({ length: first }, (_, i) => html`<div key=${"b" + i} className="day blank" aria-hidden="true"></div>`)}
      ${avail.days.map((day) => {
        const st = dayState(day, today);
        const d = parseDate(day.date).d;
        const isPicked = picked.has(day.date);
        const clickable = st.cls === "ok" || st.cls === "few" || isPicked;
        const cls = `day ${st.cls} ${isPicked ? "picked" : ""}`;
        if (!clickable) return html`<div key=${day.date} className=${cls} title=${day.open ? "" : day.reason}><span className="num">${d}</span><span className="mk">${st.mk}</span></div>`;
        return html`<${motion.button} key=${day.date} type="button" className=${cls} aria-pressed=${selected === day.date}
          aria-label=${`${d}日 ${isPicked ? "予約に選択中" : st.mk}`} onClick=${() => onPick(day.date)}
          whileHover=${{ y: -2 }} whileTap=${tap} layout="position">
          <span className="num">${d}</span><span className="mk">${isPicked ? "予約" : st.mk}</span>
        </${motion.button}>`;
      })}
    </${motion.div}>
  </${AnimatePresence}>`;
}

export function Legend() {
  return html`<div className="legend"><span><b className="ok">○</b> 空きあり</span><span><b className="few">△</b> 残りわずか</span><span><b className="full">×</b> 満席</span><span>休 お休み</span></div>`;
}

export function Slots({ day, isChosen, onToggle }) {
  return html`<div className="slots">${day.slots.map((s, i) => {
    const chosen = isChosen(s.time);
    const dis = !chosen && !s.bookable;
    const r = chosen ? "えらび中" : s.remaining === 0 ? "満席" : !s.bookable ? "受付外" : `残り${s.remaining}`;
    return html`<${motion.button} key=${day.date + s.time} type="button" className=${`slot ${s.remaining <= 1 && s.bookable ? "few" : ""}`}
      aria-pressed=${chosen} disabled=${dis} onClick=${() => onToggle(s.time)} ...${stagger(i)} whileTap=${dis ? undefined : tap}>
      <span className="t">${s.time}〜${s.end}</span><span className="r">${r}</span>
    </${motion.button}>`;
  })}</div>`;
}
