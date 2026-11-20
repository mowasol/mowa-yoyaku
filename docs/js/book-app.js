// 予約画面（保護者向け）React + framer-motion
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import { call, isDemo, resetDemo } from "./api.js";
import { addMonths, addDays, formatDateJa, nowJST } from "./schedule.js";
import {
  html, React, motion, AnimatePresence, ease, tap, hoverLift, fadeUp, monthLabel, storage, copyText,
  Header, Footer, DemoBar, ErrorBox, Button, hoursSummary, trim0, slotMark, Calendar, Legend, Slots,
} from "./ui.js";

const { useState, useEffect, useRef } = React;
const PROFILE_KEY = "mowa-yoyaku-profile";
const CFG_KEY = "mowa-yoyaku-config";
const FIELDS = ["childName", "grade", "parentName", "email", "phone", "note"];
const STEPS = ["コース", "日時", "お子さま", "確認"];

// 空き状況は、ページを開いた時点で今月・来月分を先に読み込んでおく（カレンダーをすぐ出すため）
const availCache = {};
const getAvail = (month) => (availCache[month] ||= call("GET", `/api/availability?month=${month}`).catch((e) => { delete availCache[month]; throw e; }));

function App() {
  const [cfg, setCfg] = useState(null);
  const [loadErr, setLoadErr] = useState("");
  const [step, setStep] = useState(1);
  const [dirStep, setDirStep] = useState(1);
  const [plan, setPlan] = useState(null);
  const [chosen, setChosen] = useState([]);
  const [form, setForm] = useState({ childName: "", grade: "", parentName: "", email: "", phone: "", note: "", website: "" });
  const [done, setDone] = useState(null);
  const top = useRef(null);

  useEffect(() => {
    // 空き状況（今月から3か月分）は設定の読み込みを待たずに同時に読み始める
    const m = nowJST().month;
    [m, addMonths(m, 1), addMonths(m, 2)].forEach((x) => getAvail(x).catch(() => {}));
    // 前回開いたときの設定があれば、まずそれで画面を出す（あとで最新に入れかえる）
    const cached = storage(CFG_KEY);
    if (cached) setCfg({ ...cached, today: nowJST().date });
    call("GET", "/api/config").then((c) => { setCfg(c); storage(CFG_KEY, c); })
      .catch((e) => { if (!cached) setLoadErr(e.message); });
  }, []);

  const go = (n) => { setDirStep(n > step ? 1 : -1); setStep(n); top.current?.scrollIntoView({ behavior: "smooth", block: "start" }); };

  if (loadErr) return html`<${Shell}><div className="panel"><${ErrorBox} msg=${loadErr} /></div></${Shell}>`;
  if (!cfg) return html`<${Shell}><p className="loading">読み込んでいます…</p></${Shell}>`;

  return html`<${Shell} cfg=${cfg}>
    <${Intro} cfg=${cfg} />
    ${!done && html`<${Stepper} step=${step} innerRef=${top} />`}
    <${AnimatePresence} mode="wait" custom=${dirStep}>
      ${done ? html`<${Done} key="done" done=${done} />`
      : step === 1 ? html`<${StepPlan} key="s1" cfg=${cfg} plan=${plan} dir=${dirStep} onPick=${(p) => { setPlan(p); setChosen((c) => c.slice(0, p.times)); }} onNext=${() => go(2)} />`
      : step === 2 ? html`<${StepDate} key="s2" cfg=${cfg} plan=${plan} chosen=${chosen} setChosen=${setChosen} dir=${dirStep} onBack=${() => go(1)} onNext=${() => go(3)} />`
      : step === 3 ? html`<${StepInfo} key="s3" cfg=${cfg} form=${form} setForm=${setForm} dir=${dirStep} onBack=${() => go(2)} onNext=${() => go(4)} />`
      : html`<${StepConfirm} key="s4" cfg=${cfg} plan=${plan} chosen=${chosen} form=${form} dir=${dirStep} onBack=${() => go(3)} onDone=${(d) => { setDone(d); window.scrollTo({ top: 0, behavior: "smooth" }); }} />`}
    </${AnimatePresence}>
  </${Shell}>`;
}

function Shell({ children }) {
  return html`<${MotionConfig} reducedMotion="user">
    ${isDemo() && html`<${DemoBar} text="お試しモード：この予約は保存されません（このブラウザの中だけで動いています）" onReset=${() => { resetDemo(); location.reload(); }} />`}
    <${Header} sub="レッスン予約" right=${html`<${motion.a} className="head-link" href="reservation.html" whileHover=${hoverLift} whileTap=${tap}>予約の確認・変更</${motion.a}>`} />
    <main className="wrap">${children}</main>
    <${Footer} />
  </${MotionConfig}>`;
}

function Intro({ cfg }) {
  const notes = [cfg.notice, cfg.maxPerWeekdayPerMonth ? `同じ曜日のレッスンは月${cfg.maxPerWeekdayPerMonth}回までです。第5週にあたる日はお休みになります。` : ""].filter(Boolean);
  return html`<section className="intro">
    <${motion.h1} initial=${{ opacity: 0, y: 16 }} animate=${{ opacity: 1, y: 0 }} transition=${{ duration: 0.45, ease }}>
      レッスンの日時を<span className="mark"><${motion.span} className="mark-bg" initial=${{ scaleX: 0 }} animate=${{ scaleX: 1 }} transition=${{ delay: 0.35, duration: 0.5, ease }} />えらんで予約</span>
    </${motion.h1}>
    <${motion.p} ...${fadeUp} transition=${{ delay: 0.1 }}>コースは${cfg.plans.map((p) => `${p.name}（ひと月${p.times}回まで）`).join("と")}の${cfg.plans.length}つです。レッスンの内容は、お子さま一人ひとりに合わせて決めます。</${motion.p}>
    <div className="hours">${hoursSummary(cfg).map((h, i) => html`<${motion.div} key=${h.label} className="hours-card" initial=${{ opacity: 0, y: 10 }} animate=${{ opacity: 1, y: 0 }} transition=${{ delay: 0.15 + i * 0.06, duration: 0.35, ease }}>
      <div className="hours-label">${h.label}<span>${h.slots.length}コマ</span></div>
      <ul className="hours-slots">${h.slots.map((s, j) => html`<li key=${s.start}><span className="mk">${slotMark(j, h.slots.length)}</span>${trim0(s.start)}〜${trim0(s.end)}</li>`)}</ul>
    </${motion.div}>`)}</div>
    ${cfg.consultNote && html`<${motion.p} className="consult" ...${fadeUp} transition=${{ delay: 0.3 }}>
      ${cfg.consultNote}${cfg.contactEmail && html`<span className="consult-mail">ご相談先：<a href=${`mailto:${cfg.contactEmail}`}>${cfg.contactEmail}</a></span>`}
    </${motion.p}>`}
    ${notes.length > 0 && html`<div className="notice">${notes.map((n, i) => html`<div key=${i}>${n}</div>`)}</div>`}
  </section>`;
}

function Stepper({ step, innerRef }) {
  return html`<ol className="steps" ref=${innerRef} aria-label="予約の手順">${STEPS.map((s, i) => {
    const n = i + 1, on = n === step, dn = n < step;
    return html`<li key=${s} className=${on ? "on" : dn ? "done" : ""} aria-current=${on ? "step" : undefined}>
      <span className="dot">${on && html`<${motion.span} layoutId="stepDot" className="dot-on" transition=${{ type: "spring", stiffness: 500, damping: 35 }} />`}<span className="dot-n">${dn ? "✓" : n}</span></span>${s}</li>`;
  })}</ol>`;
}

const panelMotion = (dir) => ({
  initial: { opacity: 0, x: dir * 32 }, animate: { opacity: 1, x: 0, transition: { duration: 0.3, ease } },
  exit: { opacity: 0, x: dir * -32, transition: { duration: 0.18, ease } },
});

function Panel({ dir, title, lead, children, className = "" }) {
  return html`<${motion.section} className=${`panel ${className}`} ...${panelMotion(dir)}>
    ${title && html`<h2>${title}</h2>`}${lead && html`<p className="lead">${lead}</p>`}${children}
  </${motion.section}>`;
}

// ---- 1 コース ----
function StepPlan({ cfg, plan, onPick, onNext, dir }) {
  return html`<${Panel} dir=${dir} title="コースをえらぶ" lead="ひと月に何回通うかを選んでください。">
    <div className="plans">${cfg.plans.map((p, i) => html`<${motion.button} key=${p.id} type="button" className="plan" aria-pressed=${plan?.id === p.id}
      onClick=${() => onPick(p)} whileHover=${hoverLift} whileTap=${tap}
      initial=${{ opacity: 0, y: 14 }} animate=${{ opacity: 1, y: 0, transition: { delay: 0.05 + i * 0.07, duration: 0.35, ease } }}>
      <span className="times"><small>ひと月</small>${p.times}<small>回まで</small></span>
      <span className="pname">${p.name}</span>
      <span className="pdesc">${p.desc || `ひと月${p.times}回まで`}</span>
      <${AnimatePresence}>${plan?.id === p.id && html`<${motion.span} className="check" initial=${{ scale: 0 }} animate=${{ scale: 1 }} exit=${{ scale: 0 }} transition=${{ type: "spring", stiffness: 500, damping: 20 }} aria-hidden="true">✓</${motion.span}>`}</${AnimatePresence}>
    </${motion.button}>`)}</div>
    <div className="actions"><span></span><${Button} disabled=${!plan} onClick=${onNext}>日時をえらぶ</${Button}></div>
  </${Panel}>`;
}

// ---- 2 日時 ----
function StepDate({ cfg, plan, chosen, setChosen, onBack, onNext, dir }) {
  const [month, setMonth] = useState(chosen[0]?.date.slice(0, 7) || cfg.today.slice(0, 7));
  const [mdir, setMdir] = useState(0);
  const [avail, setAvail] = useState({});
  const [selected, setSelected] = useState(null);
  const [err, setErr] = useState("");
  const last = addDays(cfg.today, cfg.bookingOpenDaysAhead).slice(0, 7);

  useEffect(() => {
    if (avail[month]) return;
    getAvail(month).then((a) => setAvail((s) => ({ ...s, [month]: a }))).catch((e) => setErr(e.message));
  }, [month]);

  const changeMonth = (d) => { const m = addMonths(month, d); if (m < cfg.today.slice(0, 7) || m > last) return; setMdir(d); setMonth(m); setSelected(null); };
  const a = avail[month];
  const day = a && selected && a.days.find((d) => d.date === selected);

  const toggle = (time) => {
    setErr("");
    const i = chosen.findIndex((c) => c.date === day.date && c.time === time);
    if (i >= 0) return setChosen(chosen.filter((_, j) => j !== i));
    let next = chosen;
    if (next.length && next[0].date.slice(0, 7) !== day.date.slice(0, 7)) { next = []; setErr("別の月の日時は一緒に予約できないため、選び直しました。"); }
    next = next.filter((c) => c.date !== day.date);
    if (next.length >= plan.times) {
      if (plan.times === 1) next = [];
      else return setErr(`${plan.name}は、ひと月${plan.times}回までです。入れ替えるときは、先に「はずす」を押してください。`);
    }
    const slot = day.slots.find((s) => s.time === time);
    setChosen([...next, { date: day.date, time, end: slot.end }].sort((x, y) => (x.date + x.time).localeCompare(y.date + y.time)));
  };
  const left = plan.times - chosen.length;
  const n = chosen.length;

  return html`<${Panel} dir=${dir} title="日時をえらぶ" lead=${`${plan.name}は、ひと月${plan.times}回まで予約できます。同じ月の中で、1回ずつでも、まとめてでも選べます（あとから追加もできます）。`}>
    <div className="cal-head">
      <${motion.button} className="icon-btn" type="button" aria-label="前の月" disabled=${month <= cfg.today.slice(0, 7)} onClick=${() => changeMonth(-1)} whileTap=${tap}>‹</${motion.button}>
      <h3 aria-live="polite">${monthLabel(month)}</h3>
      <${motion.button} className="icon-btn" type="button" aria-label="次の月" disabled=${month >= last} onClick=${() => changeMonth(1)} whileTap=${tap}>›</${motion.button}>
    </div>
    ${a ? html`<${Calendar} avail=${a} today=${cfg.today} selected=${selected} dir=${mdir} picked=${new Set(chosen.map((c) => c.date))} onPick=${setSelected} />`
        : html`<p className="loading">空き状況を読み込んでいます…</p>`}
    <${Legend} />
    <${AnimatePresence} mode="wait">${day && html`<${motion.div} key=${day.date} className="times-box" ...${fadeUp}>
      <h4>${formatDateJa(day.date)} の時間</h4>
      <${Slots} day=${day} isChosen=${(t) => chosen.some((c) => c.date === day.date && c.time === t)} onToggle=${toggle} />
    </${motion.div}>`}</${AnimatePresence}>
    <div className="tray">
      <div className="tray-title"><span>えらんだ日時</span><span>${chosen.length} 回（ひと月${plan.times}回まで）</span></div>
      <ul><${AnimatePresence} initial=${false}>${chosen.map((c) => html`<${motion.li} key=${c.date + c.time} layout
        initial=${{ opacity: 0, height: 0 }} animate=${{ opacity: 1, height: "auto" }} exit=${{ opacity: 0, height: 0 }} transition=${{ duration: 0.22, ease }}>
        <span>${formatDateJa(c.date)} ${c.time}〜${c.end}</span>
        <button type="button" onClick=${() => setChosen(chosen.filter((x) => x !== c))}>はずす</button></${motion.li}>`)}</${AnimatePresence}></ul>
      ${chosen.length === 0 && html`<p className="empty">カレンダーの日付をタップして、時間をえらんでください。</p>`}
    </div>
    <${ErrorBox} msg=${err} />
    <div className="actions">
      <${Button} kind="ghost" onClick=${onBack}>戻る</${Button}>
      <${Button} disabled=${n === 0} onClick=${onNext}>${n === 0 ? "日時をえらんでください" : `${n}回分で次へ`}</${Button}>
    </div>
  </${Panel}>`;
}

// ---- 3 お子さま情報 ----
function StepInfo({ cfg, form, setForm, onBack, onNext, dir }) {
  const [err, setErr] = useState("");
  const [remember, setRemember] = useState(true);
  const [saved] = useState(() => storage(PROFILE_KEY));
  const [reused, setReused] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const next = () => {
    const msg = !form.childName.trim() ? "お子さまのお名前を入力してください"
      : !form.grade ? "学年を選んでください"
      : !form.parentName.trim() ? "保護者のお名前を入力してください"
      : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()) ? "メールアドレスを確認してください" : "";
    setErr(msg);
    if (msg) return;
    if (remember) storage(PROFILE_KEY, { childName: form.childName, grade: form.grade, parentName: form.parentName, email: form.email, phone: form.phone });
    else storage(PROFILE_KEY, null);
    onNext();
  };

  return html`<${Panel} dir=${dir} title="お子さまと保護者の情報" lead="予約の確認メールをお送りします。">
    ${saved && !reused && html`<${motion.div} className="reuse" ...${fadeUp}><span>前回の入力内容があります。</span>
      <${Button} kind="ghost small" onClick=${() => { setForm({ ...form, ...saved, note: form.note }); setReused(true); }}>前回の内容を使う</${Button}></${motion.div}>`}
    <form className="form" noValidate onSubmit=${(e) => { e.preventDefault(); next(); }}>
      <div className="row2">
        <${Field} id="childName" label="お子さまのお名前" req><input id="childName" maxLength="40" autoComplete="off" placeholder="例：もわ たろう" value=${form.childName} onChange=${set("childName")} /></${Field}>
        <${Field} id="grade" label="学年" req><select id="grade" value=${form.grade} onChange=${set("grade")}><option value="">選んでください</option>${cfg.grades.map((g) => html`<option key=${g}>${g}</option>`)}</select></${Field}>
      </div>
      <${Field} id="parentName" label="保護者のお名前" req><input id="parentName" maxLength="40" autoComplete="name" placeholder="例：もわ はなこ" value=${form.parentName} onChange=${set("parentName")} /></${Field}>
      <div className="row2">
        <${Field} id="email" label="メールアドレス" req hint="予約の確認・変更用のリンクが届きます"><input id="email" type="email" inputMode="email" autoComplete="email" maxLength="120" placeholder="例：mowa@example.jp" value=${form.email} onChange=${set("email")} /></${Field}>
        <${Field} id="phone" label="電話番号" hint="当日の急な連絡用"><input id="phone" type="tel" inputMode="tel" autoComplete="tel" maxLength="20" placeholder="例：090-1234-5678" value=${form.phone} onChange=${set("phone")} /></${Field}>
      </div>
      <${Field} id="note" label="ご要望・やってみたいこと"><textarea id="note" maxLength="500" placeholder="例：ゲームを作ってみたい／前回の続きから" value=${form.note} onChange=${set("note")}></textarea></${Field}>
      <div className="hp" aria-hidden="true"><label>Webサイト<input tabIndex="-1" autoComplete="off" value=${form.website} onChange=${set("website")} /></label></div>
      <label className="check"><input type="checkbox" checked=${remember} onChange=${(e) => setRemember(e.target.checked)} /><span>次回のために、この端末に入力内容を保存する</span></label>
    </form>
    <${ErrorBox} msg=${err} />
    <div className="actions"><${Button} kind="ghost" onClick=${onBack}>戻る</${Button}><${Button} onClick=${next}>確認へ</${Button}></div>
  </${Panel}>`;
}

function Field({ id, label, req, hint, children }) {
  return html`<div className="field"><label htmlFor=${id}>${label}${req ? html`<span className="req">必須</span>` : html`<span className="opt">任意</span>`}</label>${children}${hint && html`<span className="hint">${hint}</span>`}</div>`;
}

// ---- 4 確認 ----
function StepConfirm({ cfg, plan, chosen, form, onBack, onDone, dir }) {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const rows = [
    ["コース", plan.name],
    ["日時", chosen.map((c) => html`<div key=${c.date}>${formatDateJa(c.date)} ${c.time}〜${c.end}</div>`)],
    ["お子さま", `${form.childName}（${form.grade}）`],
    ["保護者", form.parentName], ["メール", form.email], ["電話", form.phone || "—"], ["ご要望", form.note || "—"],
  ];
  const submit = async () => {
    setBusy(true); setErr("");
    try {
      const out = await call("POST", "/api/reservations", { plan: plan.id, lessons: chosen.map(({ date, time }) => ({ date, time })), ...form, agree: true });
      onDone(out);
    } catch (e) { setErr(e.message); setBusy(false); if (e.code === "full") Object.keys(availCache).forEach((k) => delete availCache[k]); }
  };
  return html`<${Panel} dir=${dir} title="内容の確認" lead="この内容で予約します。">
    <dl className="summary">${rows.map(([k, v]) => html`<${React.Fragment} key=${k}><dt>${k}</dt><dd>${v}</dd></${React.Fragment}>`)}</dl>
    <label className="check agree"><input type="checkbox" checked=${agree} onChange=${(e) => setAgree(e.target.checked)} /><span><a href="privacy.html" target="_blank" rel="noopener">個人情報の取り扱い</a>に同意します</span></label>
    <${ErrorBox} msg=${err} />
    <div className="actions"><${Button} kind="ghost" onClick=${onBack} disabled=${busy}>戻る</${Button}>
      <${Button} disabled=${!agree || busy} onClick=${submit}>${busy ? html`<span className="spinner" aria-hidden="true"></span>送信しています…` : "予約する"}</${Button}></div>
  </${Panel}>`;
}

// ---- 完了 ----
function Done({ done }) {
  const { token, reservation: rv } = done;
  const link = `${location.href.replace(/[#?].*$/, "").replace(/[^/]*$/, "")}reservation.html#${token}`;
  const [copied, setCopied] = useState("");
  return html`<${motion.section} className="panel done" initial=${{ opacity: 0, scale: 0.96 }} animate=${{ opacity: 1, scale: 1, transition: { duration: 0.35, ease } }}>
    <${motion.span} className="cat-wrap" initial=${{ y: 0 }} animate=${{ y: [0, -16, 0, -6, 0], rotate: [0, -5, 0, 2, 0] }} transition=${{ duration: 1.1, ease: "easeOut", delay: 0.15 }}>
      <img className="cat-big" src="assets/mowa-neko.jpg" alt="" />
    </${motion.span}>
    <h2>予約できました</h2>
    <p>${rv.childName}さんの${rv.planName}。確認メールを ${rv.email} にお送りしました。</p>
    <ul className="lesson-list">${rv.lessons.map((l, i) => html`<${motion.li} key=${l.id} initial=${{ opacity: 0, x: -10 }} animate=${{ opacity: 1, x: 0, transition: { delay: 0.3 + i * 0.08 } }}>
      <span className="when">${formatDateJa(l.date)} ${l.time}〜${l.end}</span><span className="tag on">予約済み</span></${motion.li}>`)}</ul>
    <p className="lead">確認・変更・キャンセルは、メールのリンクか下のリンクからできます。</p>
    <div className="linkbox"><input readOnly value=${link} aria-label="予約の確認リンク" onFocus=${(e) => e.target.select()} />
      <${Button} kind="small" onClick=${async () => setCopied((await copyText(link)) ? "コピーしました" : "長押しでコピーしてください")}>${copied || "コピー"}</${Button}></div>
    <div className="actions"><a className="btn ghost" href="./">トップに戻る</a><a className="btn" href=${link}>予約を確認する</a></div>
  </${motion.section}>`;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
