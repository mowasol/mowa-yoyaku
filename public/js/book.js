// 予約画面（保護者向け）
import { call, isDemo, resetDemo } from "./api.js";
import { addMonths, addDays, formatDateJa } from "./schedule.js";
import { $, esc, monthLabel, hoursSummary, renderCalendar, renderSlots, showErr, storage, copyText } from "./ui.js";

const PROFILE_KEY = "mowa-yoyaku-profile";
const st = { cfg: null, plan: null, month: null, avail: {}, selected: null, chosen: [], step: 1, tsToken: "", tsWidget: null };

init();

async function init() {
  if (await isDemo()) {
    $("#demoBar").hidden = false;
    $("#demoReset").addEventListener("click", () => { resetDemo(); location.reload(); });
  }
  try { st.cfg = await call("GET", "/api/config"); }
  catch (e) { $("#plans").innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  const cfg = st.cfg;
  $("#schoolName").textContent = cfg.schoolName;
  $("#hours").innerHTML = hoursSummary(cfg).map((h) => `<div><dt>${esc(h.label)}</dt><dd>${esc(h.value)}</dd><dt>${esc(h.sub)}</dt></div>`).join("");
  const notes = [];
  if (cfg.maxPerWeekdayPerMonth) notes.push(`同じ曜日のレッスンは月${cfg.maxPerWeekdayPerMonth}回までです。第5週にあたる日はお休みになります。`);
  if (cfg.notice) notes.unshift(cfg.notice);
  if (notes.length) { $("#notice").hidden = false; $("#notice").innerHTML = notes.map(esc).join("<br>"); }

  $("#plans").innerHTML = cfg.plans.map((p) => `
    <button type="button" class="plan" data-plan="${esc(p.id)}" aria-pressed="false">
      <span class="times">${p.times}<small>回 / 月</small></span>
      <span class="pname">${esc(p.name)}</span>
      <span class="pdesc">${p.times === 1 ? "自分のペースで、じっくり1回" : `月に${p.times}回。前回の続きをすぐ進められます`}</span>
    </button>`).join("");
  document.querySelectorAll(".plan").forEach((b) => b.addEventListener("click", () => {
    st.plan = cfg.plans.find((p) => p.id === b.dataset.plan);
    document.querySelectorAll(".plan").forEach((x) => x.setAttribute("aria-pressed", x === b));
    if (st.chosen.length > st.plan.times) st.chosen = st.chosen.slice(0, st.plan.times);
    $("#to2").disabled = false;
  }));

  $("#grade").insertAdjacentHTML("beforeend", cfg.grades.map((g) => `<option>${esc(g)}</option>`).join(""));
  const saved = storage(PROFILE_KEY);
  if (saved) { $("#reuse").hidden = false; $("#reuseBtn").addEventListener("click", () => { fillForm(saved); $("#reuse").hidden = true; }); }

  st.month = cfg.today.slice(0, 7);
  $("#to2").addEventListener("click", () => go(2));
  $("#to3").addEventListener("click", () => go(3));
  $("#to4").addEventListener("click", () => { if (checkForm()) go(4); });
  document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => go(Number(b.dataset.back))));
  $("#prevM").addEventListener("click", () => changeMonth(-1));
  $("#nextM").addEventListener("click", () => changeMonth(1));
  $("#agree").addEventListener("change", updateSubmit);
  $("#submit").addEventListener("click", submit);
  $("#copyLink").addEventListener("click", () => copyText($("#doneLink").value, $("#doneLink")).then((ok) => { $("#copyLink").textContent = ok ? "コピーしました" : "選択しました"; }));
  updateSteps();
}

function go(n) {
  st.step = n;
  for (const i of [1, 2, 3, 4]) $(`#step${i}`).hidden = i !== n;
  $("#stepDone").hidden = true;
  updateSteps();
  if (n === 2) { $("#step2lead").textContent = `${st.plan.name}：同じ月の中で${st.plan.times}回分の日時を選んでください。`; loadMonth(); renderTray(); }
  if (n === 4) renderSummary();
  $("#steps").scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateSteps() {
  document.querySelectorAll("#steps li").forEach((li, i) => {
    li.classList.toggle("on", i + 1 === st.step);
    li.classList.toggle("done", i + 1 < st.step);
  });
}

// ---- 日時 ----
const lastMonth = () => addDays(st.cfg.today, st.cfg.bookingOpenDaysAhead).slice(0, 7);

async function changeMonth(d) {
  const m = addMonths(st.month, d);
  if (m < st.cfg.today.slice(0, 7) || m > lastMonth()) return;
  st.month = m; st.selected = null;
  await loadMonth();
}

async function loadMonth(force = false) {
  $("#monthLabel").textContent = monthLabel(st.month);
  $("#prevM").disabled = st.month <= st.cfg.today.slice(0, 7);
  $("#nextM").disabled = st.month >= lastMonth();
  if (!st.avail[st.month] || force) {
    $("#cal").innerHTML = `<p class="loading">空き状況を読み込んでいます…</p>`;
    try { st.avail[st.month] = await call("GET", `/api/availability?month=${st.month}`); }
    catch (e) { $("#cal").innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  }
  drawCal();
}

function drawCal() {
  const avail = st.avail[st.month];
  renderCalendar($("#cal"), avail, {
    today: st.cfg.today, selected: st.selected, picked: new Set(st.chosen.map((c) => c.date)),
    onPick: (date) => { st.selected = date; drawCal(); },
  });
  const day = st.selected && avail.days.find((d) => d.date === st.selected);
  $("#timesBox").hidden = !day;
  if (day) {
    $("#timesTitle").textContent = `${formatDateJa(day.date)} の時間`;
    renderSlots($("#slots"), day, {
      isChosen: (t) => st.chosen.some((c) => c.date === day.date && c.time === t),
      onToggle: (t) => toggle(day, t),
    });
  }
}

function toggle(day, time) {
  showErr($("#err2"), "");
  const i = st.chosen.findIndex((c) => c.date === day.date && c.time === time);
  if (i >= 0) { st.chosen.splice(i, 1); }
  else {
    if (st.chosen.length && st.chosen[0].date.slice(0, 7) !== day.date.slice(0, 7)) {
      st.chosen = [];
      showErr($("#err2"), "別の月の日時は一緒に予約できないため、選び直しました。");
    }
    st.chosen = st.chosen.filter((c) => c.date !== day.date); // 1日1回まで（同じ日は入れ替え）
    if (st.chosen.length >= st.plan.times) {
      if (st.plan.times === 1) st.chosen = [];
      else { showErr($("#err2"), `${st.plan.name}は${st.plan.times}回までです。入れ替えるときは、先に「はずす」を押してください。`); return; }
    }
    const slot = day.slots.find((s) => s.time === time);
    st.chosen.push({ date: day.date, time, end: slot.end });
    st.chosen.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }
  drawCal(); renderTray();
}

function renderTray() {
  const n = st.plan.times;
  $("#trayCount").textContent = `${st.chosen.length} / ${n} 回`;
  $("#tray").innerHTML = st.chosen.map((c, i) => `<li><span>${formatDateJa(c.date)} ${c.time}〜${c.end}</span><button type="button" data-i="${i}">はずす</button></li>`).join("");
  $("#trayEmpty").hidden = st.chosen.length > 0;
  $("#tray").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { st.chosen.splice(Number(b.dataset.i), 1); drawCal(); renderTray(); }));
  $("#to3").disabled = st.chosen.length !== n;
  $("#to3").textContent = st.chosen.length === n ? "次へ" : `あと${n - st.chosen.length}回分えらぶ`;
}

// ---- 入力 ----
const FIELDS = ["childName", "grade", "parentName", "email", "phone", "note"];
function formData() { return Object.fromEntries(FIELDS.map((f) => [f, $(`#${f}`).value.trim()])); }
function fillForm(p) { for (const f of FIELDS) if (p[f] && f !== "note") $(`#${f}`).value = p[f]; }

function checkForm() {
  const d = formData();
  const msg = !d.childName ? "お子さまのお名前を入力してください"
    : !d.grade ? "学年を選んでください"
    : !d.parentName ? "保護者のお名前を入力してください"
    : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email) ? "メールアドレスを確認してください"
    : "";
  showErr($("#err3"), msg);
  if (msg) return false;
  if ($("#remember").checked) storage(PROFILE_KEY, { childName: d.childName, grade: d.grade, parentName: d.parentName, email: d.email, phone: d.phone });
  else storage(PROFILE_KEY, null);
  return true;
}

// ---- 確認・送信 ----
function renderSummary() {
  const d = formData();
  const rows = [
    ["コース", st.plan.name],
    ["日時", st.chosen.map((c) => `${formatDateJa(c.date)} ${c.time}〜${c.end}`).join("<br>")],
    ["お子さま", `${esc(d.childName)}（${esc(d.grade)}）`],
    ["保護者", esc(d.parentName)],
    ["メール", esc(d.email)],
    ["電話", esc(d.phone) || "—"],
    ["ご要望", esc(d.note).replace(/\n/g, "<br>") || "—"],
  ];
  $("#summary").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  showErr($("#err4"), "");
  setupTurnstile();
  updateSubmit();
}

function setupTurnstile() {
  const key = st.cfg.turnstileSiteKey;
  if (!key || st.tsWidget !== null) return;
  st.tsWidget = "loading";
  window.onTsLoad = () => {
    st.tsWidget = window.turnstile.render("#turnstile", {
      sitekey: key, language: "ja",
      callback: (t) => { st.tsToken = t; updateSubmit(); },
      "expired-callback": () => { st.tsToken = ""; updateSubmit(); },
    });
  };
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTsLoad";
  s.async = true;
  document.head.appendChild(s);
}

function updateSubmit() {
  $("#submit").disabled = !$("#agree").checked || (st.cfg.turnstileSiteKey && !st.tsToken);
}

async function submit() {
  const btn = $("#submit");
  btn.disabled = true; btn.textContent = "送信しています…";
  showErr($("#err4"), "");
  try {
    const out = await call("POST", "/api/reservations", {
      plan: st.plan.id, lessons: st.chosen.map(({ date, time }) => ({ date, time })),
      ...formData(), agree: true, turnstileToken: st.tsToken,
    });
    done(out);
  } catch (e) {
    showErr($("#err4"), e.message);
    if (e.code === "full") { st.avail = {}; }
    if (window.turnstile && st.tsWidget && st.tsWidget !== "loading") { window.turnstile.reset(st.tsWidget); st.tsToken = ""; }
  } finally {
    btn.textContent = "予約する"; updateSubmit();
  }
}

function done({ token, reservation: rv }) {
  for (const i of [1, 2, 3, 4]) $(`#step${i}`).hidden = true;
  $("#steps").hidden = true;
  $("#stepDone").hidden = false;
  const link = `${location.origin}/reservation.html#${token}`;
  $("#doneText").textContent = `${rv.childName}さんの${rv.planName}、確認メールを ${rv.email} にお送りしました。`;
  $("#doneLessons").innerHTML = rv.lessons.map((l) => `<li><span class="when">${formatDateJa(l.date)} ${l.time}〜${l.end}</span><span class="tag on">予約済み</span></li>`).join("");
  $("#doneLink").value = link;
  $("#doneManage").href = link;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
