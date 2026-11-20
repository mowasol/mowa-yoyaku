// 管理画面（スタッフ向け）React + framer-motion
// 本番は Apps Script の管理者用URLで開く（Googleログイン必須）。ローカルではお試しモード。
import { createRoot } from "react-dom/client";
import { MotionConfig } from "framer-motion";
import { call, isDemo } from "./api.js";
import { WEEKDAYS, parseDate, addMonths, nowJST, formatDateJa, dayInfo, endTime, toMin, toHHMM } from "./schedule.js";
const addMin = (t, m) => toHHMM(Math.min(toMin(t) + m, 23 * 60 + 55));
import { html, React, motion, AnimatePresence, ease, tap, fadeUp, monthLabel, ErrorBox, Button } from "./ui.js";

const { useState, useEffect, useCallback, useRef } = React;
const TABS = [["cal", "カレンダー"], ["list", "予約一覧"], ["days", "営業日"], ["settings", "設定"]];

function App() {
  const [tab, setTab] = useState("cal");
  const [me, setMe] = useState(null);
  const [settings, setSettings] = useState(null);
  const [month, setMonth] = useState(nowJST().month);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([call("GET", "/api/admin/me"), call("GET", "/api/admin/settings")])
      .then(([m, s]) => { setMe(m); setSettings(s.settings); }).catch((e) => setErr(e.message));
  }, []);
  // 月ごとのデータは覚えておき、前後の月も先に読んでおく（月の切り替えをすぐ表示するため）
  const cache = useRef({});
  const monthRef = useRef(month);
  monthRef.current = month;
  const fetchMonth = useCallback((m) => call("GET", `/api/admin/lessons?month=${m}`).then((d) => {
    cache.current[m] = d;
    if (monthRef.current === m) setData(d);
    return d;
  }), []);
  const load = useCallback(() => fetchMonth(month).catch((e) => setErr(e.message)), [month]);
  useEffect(() => {
    if (!settings) return;
    if (cache.current[month]) setData(cache.current[month]); // 覚えている分をすぐ出し、裏で最新に入れかえる
    fetchMonth(month).then(() => {
      [addMonths(month, -1), addMonths(month, 1)].forEach((m) => { if (!cache.current[m]) fetchMonth(m).catch(() => {}); });
    }).catch((e) => setErr(e.message));
  }, [month, settings]);
  // 画面を先に変えてから裏で保存する（待たずに次の操作ができる）
  const patch = useCallback((fn) => setData((d) => { const nd = fn(d); cache.current[nd.month] = nd; return nd; }), []);
  const shown = data && data.month === month ? data : null;

  const nav = html`<div className="month-nav">
    <${motion.button} className="icon-btn" type="button" aria-label="前の月" whileTap=${tap} onClick=${() => setMonth(addMonths(month, -1))}>‹</${motion.button}>
    <h2>${monthLabel(month)}</h2>
    <${motion.button} className="icon-btn" type="button" aria-label="次の月" whileTap=${tap} onClick=${() => setMonth(addMonths(month, 1))}>›</${motion.button}>
  </div>`;

  return html`<${MotionConfig} reducedMotion="user">
    ${isDemo() && html`<div className="demo-bar">お試しモード：見本のデータです。変更はこのブラウザの中だけに保存されます</div>`}
    <header className="site-head"><div className="wrap wide">
      <span className="brand"><span className="brand-logo"><img src="assets/mowa-neko.jpg" alt="mowaねこ" width="50" height="35" /></span>
        <span className="brand-name">予約管理<small>${me?.email || "mowaプログラミング教室"}</small></span></span>
      <nav className="tabs" role="tablist">${TABS.map(([k, label]) => html`<button key=${k} type="button" role="tab" aria-selected=${tab === k} onClick=${() => setTab(k)}>
        ${tab === k && html`<${motion.span} layoutId="tabPill" className="tab-pill" transition=${{ type: "spring", stiffness: 500, damping: 38 }} />`}<span className="tab-t">${label}</span></button>`)}
        ${me?.sheetUrl && html`<a className="tab-link" href=${me.sheetUrl} target="_blank" rel="noopener">スプレッドシート ↗</a>`}
      </nav>
    </div></header>
    <main className="wrap wide">
      <${ErrorBox} msg=${err} />
      ${!settings || !shown ? html`${settings && html`<div className="toolbar">${nav}</div>`}<p className="loading">読み込んでいます…</p>` : html`<${AnimatePresence} mode="wait">
        <${motion.div} key=${tab} ...${fadeUp}>
          ${tab === "cal" ? html`<${CalTab} data=${shown} settings=${settings} nav=${nav} reload=${load} patch=${patch} setErr=${setErr} onToday=${() => setMonth(nowJST().month)} />`
          : tab === "list" ? html`<${ListTab} data=${shown} settings=${settings} nav=${nav} reload=${load} patch=${patch} setErr=${setErr} month=${month} />`
          : tab === "days" ? html`<${DaysTab} data=${shown} settings=${settings} nav=${nav} reload=${load} patch=${patch} setErr=${setErr} />`
          : html`<${SettingsTab} settings=${settings} onSaved=${setSettings} />`}
        </${motion.div}>
      </${AnimatePresence}>`}
    </main>
  </${MotionConfig}>`;
}

// ---- 1日分の時間割 ----
function DayCard({ d, data, settings, showC, reload, patch, setErr }) {
  const today = nowJST().date;
  const ls = data.lessons.filter((l) => l.date === d.date && (showC || l.status === "active"));
  const nActive = data.lessons.filter((l) => l.date === d.date && l.status === "active").length;
  const times = [...new Set([...d.slots, ...ls.map((l) => l.time)])].sort();
  const cap = d.capacity || data.capacity;
  return html`<article className=${`aday ${d.date === today ? "today" : ""}`}>
    <div className="aday-head"><h3>${formatDateJa(d.date)}${d.date === today ? "（今日）" : ""}</h3>
      <span className="meta">${d.open ? `${nActive}人 / ${d.slots.length}コマ` : `お休み（${d.reason}）`}</span></div>
    ${times.length ? times.map((t) => {
      const p = ls.filter((l) => l.time === t);
      const n = p.filter((l) => l.status === "active").length;
      return html`<div className="aslot" key=${t}>
        <div className="time">${t}〜${endTime(t, settings, d.date)}<span className=${`cap ${n >= cap ? "full" : ""}`}>${n} / ${cap}人${n >= cap ? " 満席" : ""}</span>
          <div className="meter">${Array.from({ length: cap }, (_, i) => html`<${motion.i} key=${i} className=${i < n ? "on" : ""} initial=${{ scaleX: 0 }} animate=${{ scaleX: 1 }} transition=${{ delay: i * 0.04 }} />`)}</div></div>
        <div className="people">${p.length ? p.map((l) => html`<${Person} key=${l.id + l.status} l=${l} reload=${reload} patch=${patch} setErr=${setErr} />`) : html`<span className="empty-slot">予約なし</span>`}</div>
      </div>`;
    }) : html`<div className="aslot"><span className="empty-slot">レッスンはありません</span></div>`}
  </article>`;
}

function Person({ l, reload, patch, setErr }) {
  const [sure, setSure] = useState(false);
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 4000); return () => clearTimeout(t); }, [sure]);
  const cancel = async () => {
    if (!sure) return setSure(true);
    // すぐ「キャンセル済み」にして、裏で保存する
    patch((d) => ({ ...d, lessons: d.lessons.map((x) => (x.id === l.id && x.reservationId === l.reservationId ? { ...x, status: "cancelled" } : x)) }));
    try { await call("POST", `/api/admin/lessons/${l.id}/cancel`); } catch (e) { setErr(e.message); }
    reload();
  };
  return html`<div className=${`person ${l.status === "cancelled" ? "cancelled" : ""}`}>
    <span className="nm">${l.childName}</span><span className="gr">${l.grade}</span><span className="pl">${l.plan}</span>
    <span className="ct">${l.parentName}・${l.email}${l.phone ? `・${l.phone}` : ""}</span>
    ${l.status === "active" && html`<${motion.button} type="button" className=${`x ${sure ? "sure" : ""}`} onClick=${cancel} whileTap=${tap} layout>${sure ? "本当に取消" : "取消"}</${motion.button}>`}
    ${l.note && html`<span className="nt">${l.note}</span>`}
  </div>`;
}

// ---- カレンダー ----
function CalTab({ data, settings, nav, reload, patch, setErr, onToday }) {
  const today = nowJST().date;
  const [sel, setSel] = useState(today.startsWith(data.month) ? today : null);
  useEffect(() => { setSel(today.startsWith(data.month) ? today : null); }, [data.month]);
  const first = parseDate(data.days[0].date).dow;
  const selDay = sel && data.days.find((d) => d.date === sel);
  return html`<section>
    <div className="toolbar">${nav}<div className="tool-right"><${Button} kind="ghost small" onClick=${onToday}>今月</${Button}></div></div>
    <div className="bcal">
      ${WEEKDAYS.map((w, i) => html`<div key=${w} className=${`dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}`}>${w}</div>`)}
      ${Array.from({ length: first }, (_, i) => html`<div key=${"b" + i} className="bday blank"></div>`)}
      ${data.days.map((d, idx) => {
        const ls = data.lessons.filter((l) => l.date === d.date && l.status === "active");
        const cap = d.slots.length * (d.capacity || data.capacity);
        const shown = ls.slice(0, 4);
        return html`<${motion.button} key=${d.date} type="button" className=${`bday ${d.open ? "" : "closed"} ${d.date === today ? "today" : ""}`}
          aria-pressed=${sel === d.date} onClick=${() => setSel(d.date)} whileHover=${{ y: -2 }} whileTap=${tap}
          initial=${{ opacity: 0, y: 6 }} animate=${{ opacity: 1, y: 0, transition: { delay: idx * 0.008, duration: 0.25 } }}>
          <span className="bhead"><span className="bnum">${parseDate(d.date).d}</span>
            ${d.open ? html`<span className=${`bcount ${cap && ls.length >= cap ? "full" : ""}`}>${ls.length}人</span>` : html`<span className="bcount full">休</span>`}</span>
          ${!d.open && html`<span className="boff">${d.reason}</span>`}
          ${shown.map((l) => html`<span key=${l.id} className="chip"><b>${l.time}</b>${l.childName}</span>`)}
          ${ls.length > shown.length && html`<span className="more">ほか${ls.length - shown.length}人</span>`}
        </${motion.button}>`;
      })}
    </div>
    <div id="calDetail"><${AnimatePresence} mode="wait">${selDay && html`<${motion.div} key=${sel} ...${fadeUp}>
      <${DayCard} d=${selDay} data=${data} settings=${settings} showC=${true} reload=${reload} patch=${patch} setErr=${setErr} /></${motion.div}>`}</${AnimatePresence}></div>
  </section>`;
}

// ---- 予約一覧 ----
function ListTab({ data, settings, nav, reload, patch, setErr, month }) {
  const [showC, setShowC] = useState(false);
  const active = data.lessons.filter((l) => l.status === "active");
  const total = data.days.reduce((a, d) => a + d.slots.length, 0) * data.capacity;
  const stats = [["予約コマ数", active.length, "件"], ["予約した家庭", new Set(active.map((l) => l.reservationId)).size, "件"],
    ["埋まり具合", total ? Math.round((active.length / total) * 100) : 0, "%"], ["キャンセル", data.lessons.length - active.length, "件"]];
  const csv = async () => {
    const out = await call("GET", `/api/admin/export.csv?month=${month}`);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([out.__csv], { type: "text/csv" }));
    a.download = `mowa-yoyaku-${month}.csv`; a.click();
  };
  const days = data.days.filter((d) => d.open || data.lessons.some((l) => l.date === d.date));
  return html`<section>
    <div className="toolbar">${nav}<div className="tool-right">
      <label className="mini-check"><input type="checkbox" checked=${showC} onChange=${(e) => setShowC(e.target.checked)} /> キャンセルも表示</label>
      <${Button} kind="ghost small" onClick=${csv}>CSVで書き出す</${Button}></div></div>
    <div className="stats">${stats.map(([k, v, u], i) => html`<${motion.div} key=${k} className="stat" initial=${{ opacity: 0, y: 8 }} animate=${{ opacity: 1, y: 0, transition: { delay: i * 0.05 } }}>
      <div className="k">${k}</div><div className="v">${v}<small>${u}</small></div></${motion.div}>`)}</div>
    ${days.length ? days.map((d) => html`<${DayCard} key=${d.date} d=${d} data=${data} settings=${settings} showC=${showC} reload=${reload} patch=${patch} setErr=${setErr} />`) : html`<p className="loading">この月の営業日はありません。</p>`}
  </section>`;
}

// ---- 営業日 ----
function DaysTab({ data, settings, nav, reload, patch, setErr }) {
  const [edit, setEdit] = useState(null);
  const [note, setNote] = useState("");
  const [dcap, setDcap] = useState("");
  const first = parseDate(data.days[0].date).dow;
  const d = edit && data.days.find((x) => x.date === edit);
  const ov = edit && data.overrides[edit];
  const base = edit && dayInfo(edit, settings, {});
  const n = edit ? data.lessons.filter((l) => l.date === edit && l.status === "active").length : 0;
  const pick = (date) => { setEdit(date); setNote(data.overrides[date]?.note || ""); setDcap(data.overrides[date]?.capacity || ""); };
  // 営業日の変更は、カレンダーをすぐ書きかえてから裏で保存する
  const applyLocal = (date, ov) => patch((d) => {
    const overrides = { ...d.overrides };
    if (ov) overrides[date] = ov; else delete overrides[date];
    return { ...d, overrides, days: d.days.map((x) => (x.date === date ? dayInfo(date, settings, overrides) : x)) };
  });
  const save = async (open) => {
    const capacity = dcap === "" ? "" : Number(dcap);
    applyLocal(edit, { open, note, capacity });
    try { await call("PUT", `/api/admin/overrides/${edit}`, { open, note, capacity }); } catch (e) { setErr(e.message); }
    reload();
  };
  const reset = async () => {
    applyLocal(edit, null);
    try { await call("DELETE", `/api/admin/overrides/${edit}`); } catch (e) { setErr(e.message); }
    reload();
  };
  return html`<section>
    <div className="toolbar">${nav}</div>
    <p className="lead">日付を押すと、その日だけ「お休み」にしたり「営業」にしたりできます。第5週の自動休みを別の日に振り替えるときも、ここで切り替えてください。</p>
    <div className="cal admin-cal">
      ${WEEKDAYS.map((w, i) => html`<div key=${w} className=${`dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}`}>${w}</div>`)}
      ${Array.from({ length: first }, (_, i) => html`<div key=${"b" + i} className="day blank"></div>`)}
      ${data.days.map((x) => {
        const cnt = data.lessons.filter((l) => l.date === x.date && l.status === "active").length;
        return html`<${motion.button} key=${x.date} type="button" className=${`day ${x.open ? "ok" : "off"} ${data.overrides[x.date] ? "star" : ""}`} aria-pressed=${edit === x.date} onClick=${() => pick(x.date)} whileTap=${tap}>
          <span className="num">${parseDate(x.date).d}</span><span className="mk">${x.open ? (cnt ? `予約${cnt}` : "営業") : "休"}</span></${motion.button}>`;
      })}
    </div>
    <div className="legend"><span><b className="ok">営業</b> 通常どおり</span><span><b className="full">休</b> お休み</span><span>★ 個別に変更した日</span></div>
    <${AnimatePresence}>${d && html`<${motion.div} key=${edit} className="panel day-edit" ...${fadeUp}>
      <h3>${formatDateJa(edit)}</h3>
      <p className="lead">いまの状態：${d.open ? `営業（定員${d.capacity}人）` : "お休み"}${ov ? "（個別に変更済み）" : ""}。通常は「${base.open ? "営業" : base.reason}」の日です。</p>
      <div className="row3">
        <div className="field"><label htmlFor="deNote">お知らせメモ（予約ページに表示）</label><input id="deNote" maxLength="40" placeholder="例：臨時休業／振替営業" value=${note} onChange=${(e) => setNote(e.target.value)} /></div>
        <div className="field"><label htmlFor="deCap">この日の定員（空欄なら通常の${settings.capacity}人）</label><input id="deCap" type="number" min="1" max="50" placeholder=${String(settings.capacity)} value=${dcap} onChange=${(e) => setDcap(e.target.value)} /><span className="hint">先生が少ない日は減らせます。「営業にする」で保存</span></div>
      </div>
      <div className="actions">${ov ? html`<${Button} kind="ghost small" onClick=${reset}>通常に戻す</${Button}>` : html`<span></span>`}
        <span className="btn-row"><${Button} kind="danger small" onClick=${() => save(false)}>お休みにする</${Button}><${Button} kind="small" onClick=${() => save(true)}>営業にする</${Button}></span></div>
      ${n > 0 && d.open && html`<p className="lead">※ この日はすでに${n}件の予約があります。お休みにしても予約は自動で取り消されません。予約一覧から取消し、ご家庭へ連絡してください。</p>`}
    </${motion.div}>`}</${AnimatePresence}>
  </section>`;
}

// ---- 設定 ----
function SettingsTab({ settings, onSaved }) {
  const [s, setS] = useState(() => structuredClone(settings));
  const [adminNew, setAdminNew] = useState("");
  const [err, setErr] = useState("");
  const [saved, setSaved] = useState(false);
  const up = (patch) => { setS({ ...s, ...patch }); setSaved(false); };
  const upDay = (i, patch) => up({ weekly: { ...s.weekly, [i]: { ...s.weekly[i], ...patch } } });
  const num = (k) => (e) => up({ [k]: Number(e.target.value) });
  const save = async (e) => {
    e.preventDefault(); setErr("");
    const out = structuredClone(s);
    try { const r = await call("PUT", "/api/admin/settings", { settings: out }); onSaved(r.settings); setSaved(true); } catch (e2) { setErr(e2.message); }
  };
  const addAdmin = () => {
    const v = adminNew.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return setErr("メールアドレスの形式を確認してください");
    setErr(""); if (!s.admins.includes(v)) up({ admins: [...s.admins, v] }); setAdminNew("");
  };
  return html`<form className="panel form" noValidate onSubmit=${save}>
    <h2>曜日ごとのコマ</h2>
    <p className="lead">1コマずつ開始・終了の時刻を入れます。コマごとに長さが違ってもかまいません。予約済みの回がある時刻を消しても、その予約は残ります。</p>
    <div className="week-slots">${[1, 2, 3, 4, 5, 6, 0].map((i) => {
      const r = s.weekly[i];
      const slots = r.slots || [];
      const setSlots = (next) => upDay(i, { slots: next });
      const last = slots[slots.length - 1];
      const addSlot = () => setSlots([...slots, last ? { start: last.end, end: addMin(last.end, 90) } : { start: "17:30", end: "19:00" }]);
      return html`<div key=${i} className=${`wday ${r.open ? "" : "closed"}`}>
        <div className="wday-head">
          <span className="dw">${WEEKDAYS[i]}</span>
          <label className="mini-check"><input type="checkbox" checked=${r.open} onChange=${(e) => upDay(i, { open: e.target.checked })} /> 営業</label>
        </div>
        ${r.open ? html`<ul className="slot-edit"><${AnimatePresence} initial=${false}>${slots.map((c, j) => html`<${motion.li} key=${j} layout initial=${{ opacity: 0, height: 0 }} animate=${{ opacity: 1, height: "auto" }} exit=${{ opacity: 0, height: 0 }}>
            <span className="no">${j + 1}</span>
            <input type="time" step="300" value=${c.start} aria-label=${`${WEEKDAYS[i]}曜 ${j + 1}コマ目 開始`} onChange=${(e) => setSlots(slots.map((x, k) => (k === j ? { ...x, start: e.target.value } : x)))} />
            <span>〜</span>
            <input type="time" step="300" value=${c.end} aria-label=${`${WEEKDAYS[i]}曜 ${j + 1}コマ目 終了`} onChange=${(e) => setSlots(slots.map((x, k) => (k === j ? { ...x, end: e.target.value } : x)))} />
            <button type="button" className="del" aria-label=${`${j + 1}コマ目を消す`} onClick=${() => setSlots(slots.filter((_, k) => k !== j))}>×</button>
          </${motion.li}>`)}</${AnimatePresence}></ul>
          <button type="button" className="add-slot" onClick=${addSlot}>＋ コマを追加</button>` : html`<p className="lead">お休み</p>`}
      </div>`;
    })}</div>
    <div className="btn-row copy-row">
      <${Button} kind="ghost small" onClick=${() => up({ weekly: { ...s.weekly, ...Object.fromEntries([2, 3, 4, 5].map((d) => [d, structuredClone(s.weekly[1])])) } })}>月曜のコマを火〜金にコピー</${Button}>
      <${Button} kind="ghost small" onClick=${() => up({ weekly: { ...s.weekly, 0: structuredClone(s.weekly[6]) } })}>土曜のコマを日曜にコピー</${Button}>
    </div>
    <div className="field"><label htmlFor="cn">ほかの時間の相談についての案内（予約ページに表示）</label><input id="cn" maxLength="200" value=${s.consultNote || ""} onChange=${(e) => up({ consultNote: e.target.value })} /></div>
    <div className="field"><label htmlFor="ce">相談先のメールアドレス</label><input id="ce" type="email" maxLength="120" value=${s.contactEmail || ""} onChange=${(e) => up({ contactEmail: e.target.value })} /></div>
    <div className="row3">
      <div className="field"><label htmlFor="cp">1コマの定員（人）※日ごとの変更は「営業日」タブ</label><input id="cp" type="number" min="1" max="50" value=${s.capacity} onChange=${num("capacity")} /></div>
      <div className="field"><label htmlFor="mp">同じ曜日は月に何回まで</label><select id="mp" value=${s.maxPerWeekdayPerMonth ? 4 : 0} onChange=${num("maxPerWeekdayPerMonth")}><option value="4">4回（第5週はお休み）</option><option value="0">制限なし</option></select></div>
    </div>
    <h2>予約の受付</h2>
    <div className="row3">
      <div className="field"><label htmlFor="od">何日先まで予約できるか</label><input id="od" type="number" min="7" max="180" value=${s.bookingOpenDaysAhead} onChange=${num("bookingOpenDaysAhead")} /></div>
      <div className="field"><label htmlFor="ch">何時間前で締め切るか</label><input id="ch" type="number" min="0" max="168" value=${s.bookingCloseHoursBefore} onChange=${num("bookingCloseHoursBefore")} /></div>
      <div className="field"><label htmlFor="cc">変更・キャンセルの期限（時間前）</label><input id="cc" type="number" min="0" max="168" value=${s.cancelHoursBefore} onChange=${num("cancelHoursBefore")} /></div>
    </div>
    <h2>コースと表示</h2>
    <div className="row3">${s.plans.map((p, i) => html`<div className="field" key=${p.id}><label htmlFor=${"pl" + i}>コース名（月${p.times}回）</label>
      <input id=${"pl" + i} maxLength="20" value=${p.name} onChange=${(e) => up({ plans: s.plans.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></div>`)}</div>
    <div className="field"><label htmlFor="sn">教室名</label><input id="sn" maxLength="40" value=${s.schoolName} onChange=${(e) => up({ schoolName: e.target.value })} /></div>
    <div className="field"><label htmlFor="nt">お知らせ（予約ページの上に表示。空なら非表示）</label><textarea id="nt" maxLength="300" placeholder="例：12月29日〜1月3日は冬休みです" value=${s.notice || ""} onChange=${(e) => up({ notice: e.target.value })}></textarea></div>
    <h2>管理者</h2>
    <p className="lead">この管理画面を開けるGoogleアカウントです。ここに無い人は、ログインしても予約や名前を見られません。スタッフが辞めたら、ここから外してください。</p>
    <ul className="admins"><${AnimatePresence} initial=${false}>${s.admins.length ? s.admins.map((a) => html`<${motion.li} key=${a} layout initial=${{ opacity: 0, x: -8 }} animate=${{ opacity: 1, x: 0 }} exit=${{ opacity: 0, x: 8 }}>
      <span>${a}</span><button type="button" onClick=${() => up({ admins: s.admins.filter((x) => x !== a) })}>外す</button></${motion.li}>`)
      : html`<li key="none"><span>まだ登録がありません（公開した人だけが入れます）</span></li>`}</${AnimatePresence}></ul>
    <div className="add-row field"><input type="email" maxLength="120" placeholder="例：staff@mowasol.com" aria-label="追加するメールアドレス" value=${adminNew} onChange=${(e) => setAdminNew(e.target.value)} onKeyDown=${(e) => { if (e.key === "Enter") { e.preventDefault(); addAdmin(); } }} />
      <${Button} kind="ghost small" onClick=${addAdmin}>追加</${Button}></div>
    <${ErrorBox} msg=${err} />
    <div className="actions"><${AnimatePresence}>${saved ? html`<${motion.span} className="saved" initial=${{ opacity: 0, y: 4 }} animate=${{ opacity: 1, y: 0 }} exit=${{ opacity: 0 }}>保存しました</${motion.span}>` : html`<span></span>`}</${AnimatePresence}>
      <${motion.button} type="submit" className="btn" whileTap=${tap}>設定を保存</${motion.button}></div>
  </form>`;
}

createRoot(document.getElementById("root")).render(html`<${App} />`);
