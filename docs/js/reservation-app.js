// 予約の確認・変更・キャンセル（保護者向け）React + framer-motion
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import { call, isDemo } from "./api.js";
import { formatDateJa } from "./schedule.js";
import { html, React, motion, AnimatePresence, ease, tap, hoverLift, fadeUp, monthLabel, Header, Footer, DemoBar, ErrorBox, Button, Calendar, Legend, Slots } from "./ui.js";

const { useState, useEffect } = React;
const TOKEN_RE = /^[0-9a-f]{48}$/;
// 「日時を変更」を押したときにすぐカレンダーを出せるよう、予約の月の空き状況を先に読んでおく
const availCache = {};
const getAvail = (month, fresh) => ((!fresh && availCache[month]) || (availCache[month] = call("GET", `/api/availability?month=${month}`).catch((e) => { delete availCache[month]; throw e; })));

function App() {
  const [token, setToken] = useState(location.hash.slice(1));
  const [cfg, setCfg] = useState(null);
  const [rv, setRv] = useState(null);
  const [err, setErr] = useState("");
  const [picker, setPicker] = useState(null);   // { lessonId|null }
  const [confirm, setConfirm] = useState(null); // lesson
  const [toast, setToast] = useState("");

  useEffect(() => {
    const on = () => setToken(location.hash.slice(1));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => {
    setRv(null); setErr("");
    if (!TOKEN_RE.test(token)) return;
    Promise.all([call("GET", "/api/config"), call("GET", `/api/reservations/${token}`)])
      .then(([c, r]) => { setCfg(c); setRv(r.reservation); getAvail(r.reservation.month).catch(() => {}); }).catch((e) => setErr(e.message));
  }, [token]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 2600); return () => clearTimeout(t); }, [toast]);

  const doCancel = async () => {
    try { setRv((await call("POST", `/api/reservations/${token}/cancel`, { lessonId: confirm.id })).reservation); setToast("キャンセルしました"); }
    catch (e) { setErr(e.message); }
    setConfirm(null);
  };

  let body;
  if (!TOKEN_RE.test(token) || (err && !rv)) body = html`<${NoToken} err=${err} />`;
  else if (!rv) body = html`<p className="loading">読み込んでいます…</p>`;
  else body = html`
    <${View} rv=${rv} onChange=${(id) => setPicker({ lessonId: id })} onAdd=${() => setPicker({ lessonId: null })} onCancel=${setConfirm} err=${err} />
    <${AnimatePresence}>${picker && html`<${Picker} key="picker" cfg=${cfg} rv=${rv} token=${token} lessonId=${picker.lessonId}
      onClose=${() => setPicker(null)} onSaved=${(r) => { setRv(r); setPicker(null); setToast(picker.lessonId ? "日時を変更しました" : "日時を追加しました"); }} />`}</${AnimatePresence}>
    <${AnimatePresence}>${confirm && html`<${ConfirmDialog} key="c" lesson=${confirm} onNo=${() => setConfirm(null)} onYes=${doCancel} />`}</${AnimatePresence}>`;

  return html`<${MotionConfig} reducedMotion="user">
    ${isDemo() && html`<${DemoBar} text="お試しモード：変更はこのブラウザの中だけに保存されます" />`}
    <${Header} sub="予約の確認・変更" right=${html`<${motion.a} className="head-link" href="./" whileHover=${hoverLift} whileTap=${tap}>新しく予約する</${motion.a}>`} />
    <main className="wrap">${body}</main>
    <${Footer} />
    <${AnimatePresence}>${toast && html`<${motion.div} className="toast" role="status" initial=${{ opacity: 0, y: 20 }} animate=${{ opacity: 1, y: 0 }} exit=${{ opacity: 0, y: 20 }}>${toast}</${motion.div}>`}</${AnimatePresence}>
  </${MotionConfig}>`;
}

function NoToken({ err }) {
  const [v, setV] = useState("");
  const [msg, setMsg] = useState(err);
  const open = () => { const m = v.match(/#([0-9a-f]{48})/); if (!m) return setMsg("リンクの形が正しくありません。メールのリンクをそのまま貼り付けてください"); location.hash = m[1]; };
  return html`<${motion.section} className="panel" ...${fadeUp}>
    <h2>予約の確認・変更</h2>
    <p className="lead">予約のときにお送りしたメールのリンクから開いてください。リンクをコピーしてある場合は、下に貼り付けてください。</p>
    <div className="linkbox"><input value=${v} onChange=${(e) => setV(e.target.value)} placeholder="https://…/reservation.html#…" aria-label="予約の確認リンク" /><${Button} kind="small" onClick=${open}>開く</${Button}></div>
    <${ErrorBox} msg=${msg} />
    <p className="lead">メールが見つからないときは、教室へご連絡ください。</p>
  </${motion.section}>`;
}

function View({ rv, onChange, onAdd, onCancel, err }) {
  const left = rv.planTimes - rv.lessons.filter((l) => l.status === "active").length;
  return html`<${motion.section} className="panel" ...${fadeUp}>
    <h2>${rv.childName}さんの予約</h2>
    <p className="lead">${rv.planName}（${rv.grade}）・${monthLabel(rv.month)}</p>
    <ul className="lesson-list">${rv.lessons.map((l, i) => html`<${motion.li} key=${l.id} layout className=${l.status === "cancelled" ? "cancelled" : ""}
      initial=${{ opacity: 0, y: 8 }} animate=${{ opacity: l.status === "cancelled" ? 0.55 : 1, y: 0, transition: { delay: i * 0.05, duration: 0.3, ease } }}>
      <span><span className="when">${formatDateJa(l.date)} ${l.time}〜${l.end}</span><br />
        <span className=${`tag ${l.status === "active" ? "on" : "off"}`}>${l.status === "active" ? "予約済み" : "キャンセル済み"}</span></span>
      ${l.canCancel && html`<span className="actions-inline"><${Button} kind="ghost small" onClick=${() => onChange(l.id)}>日時を変更</${Button}><${Button} kind="danger small" onClick=${() => onCancel(l)}>キャンセル</${Button}></span>`}
    </${motion.li}>`)}</ul>
    ${left > 0 && html`<div className="actions"><span className="lead">この月はあと${left}回予約できます（${rv.planName}はひと月${rv.planTimes}回まで）。</span><${Button} kind="small" onClick=${onAdd}>日時を追加する</${Button}></div>`}
    <p className="lead">変更・キャンセルは、各レッスンの開始${rv.cancelHoursBefore}時間前までこの画面でできます。それ以降は教室へご連絡ください。</p>
    <${ErrorBox} msg=${err} />
  </${motion.section}>`;
}

function Picker({ cfg, rv, token, lessonId, onClose, onSaved }) {
  const [avail, setAvail] = useState(null);
  const [selected, setSelected] = useState(null);
  const [pick, setPick] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const cur = lessonId && rv.lessons.find((l) => l.id === lessonId);
  const load = (fresh) => getAvail(rv.month, fresh).then(setAvail).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const busyDates = new Set(rv.lessons.filter((l) => l.status === "active" && l.id !== lessonId).map((l) => l.date));
  const a = avail && { ...avail, days: avail.days.map((d) => (busyDates.has(d.date) ? { ...d, open: false, reason: "予約済み" } : d)) };
  const day = a && selected && a.days.find((d) => d.date === selected);

  const save = async () => {
    setBusy(true); setErr("");
    try { const r = (await call("POST", `/api/reservations/${token}/change`, { lessonId, ...pick })).reservation; delete availCache[rv.month]; getAvail(rv.month).catch(() => {}); onSaved(r); }
    catch (e) { setErr(e.message); setBusy(false); if (e.code === "full") { setPick(null); load(true); } }
  };

  return html`<${motion.section} className="panel" initial=${{ opacity: 0, y: 24 }} animate=${{ opacity: 1, y: 0, transition: { duration: 0.32, ease } }} exit=${{ opacity: 0, y: 16, transition: { duration: 0.18 } }}
    ref=${(el) => el && !el.dataset.s && (el.dataset.s = 1, el.scrollIntoView({ behavior: "smooth", block: "start" }))}>
    <h2>${cur ? "新しい日時をえらぶ" : "追加する日時をえらぶ"}</h2>
    <p className="lead">${cur ? `いまの予約：${formatDateJa(cur.date)} ${cur.time}〜${cur.end}（同じ月の中で変更できます）` : "同じ月の中でえらんでください。"}</p>
    <div className="cal-head"><span></span><h3>${monthLabel(rv.month)}</h3><span></span></div>
    ${a ? html`<${Calendar} avail=${a} today=${cfg.today} selected=${selected} picked=${new Set(pick ? [pick.date] : [])} onPick=${setSelected} />` : html`<p className="loading">空き状況を読み込んでいます…</p>`}
    <${Legend} />
    <${AnimatePresence} mode="wait">${day && html`<${motion.div} key=${day.date} className="times-box" ...${fadeUp}>
      <h4>${formatDateJa(day.date)} の時間</h4>
      <${Slots} day=${day} isChosen=${(t) => pick?.date === day.date && pick?.time === t} onToggle=${(t) => setPick(pick?.date === day.date && pick?.time === t ? null : { date: day.date, time: t })} />
    </${motion.div}>`}</${AnimatePresence}>
    <${ErrorBox} msg=${err} />
    <div className="actions"><${Button} kind="ghost" onClick=${onClose}>やめる</${Button}><${Button} disabled=${!pick || busy} onClick=${save}>${busy ? "保存しています…" : "この日時にする"}</${Button}></div>
  </${motion.section}>`;
}

function ConfirmDialog({ lesson, onNo, onYes }) {
  const [busy, setBusy] = useState(false);
  return html`<${motion.div} className="scrim" initial=${{ opacity: 0 }} animate=${{ opacity: 1 }} exit=${{ opacity: 0 }} onClick=${(e) => e.target === e.currentTarget && onNo()}>
    <${motion.div} className="panel dialog" role="alertdialog" aria-modal="true" aria-labelledby="cTitle"
      initial=${{ scale: 0.94, y: 12 }} animate=${{ scale: 1, y: 0, transition: { type: "spring", stiffness: 420, damping: 30 } }} exit=${{ scale: 0.96, opacity: 0 }}>
      <h2 id="cTitle">キャンセルしますか？</h2>
      <p>${formatDateJa(lesson.date)} ${lesson.time}〜${lesson.end} のレッスンをキャンセルします。</p>
      <div className="actions"><${Button} kind="ghost" onClick=${onNo} autoFocus>やめる</${Button}><${Button} kind="danger" disabled=${busy} onClick=${() => { setBusy(true); onYes(); }}>キャンセルする</${Button}></div>
    </${motion.div}>
  </${motion.div}>`;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
