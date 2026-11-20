// 管理画面
import { call, isDemo } from "./api.js";
import { WEEKDAYS, parseDate, addMonths, nowJST, formatDateJa, dayInfo, slotTimes, endTime } from "./schedule.js";
import { $, esc, monthLabel, showErr } from "./ui.js";

const st = { month: nowJST().month, tab: "cal", data: null, settings: null, editDate: null, calDate: null };
const demo = await isDemo();

init();

async function init() {
  if (demo) $("#demoBar").hidden = false;
  try {
    const me = await call("GET", "/api/admin/me");
    if (me.email) $("#who").textContent = me.email;
    st.settings = (await call("GET", "/api/admin/settings")).settings;
  } catch (e) { showErr($("#fatal"), e.message); return; }

  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tab)));
  document.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => { st.month = addMonths(st.month, Number(b.dataset.m)); load(); }));
  $("#toToday").addEventListener("click", () => { st.month = nowJST().month; st.calDate = null; load(); });
  $("#showCancelled").addEventListener("change", renderList);
  $("#csv").addEventListener("click", downloadCsv);
  $("#deOpen").addEventListener("click", () => saveOverride(true));
  $("#deClose").addEventListener("click", () => saveOverride(false));
  $("#deReset").addEventListener("click", resetOverride);
  $("#settingsForm").addEventListener("submit", saveSettings);
  fillSettings();
  load();
}

function setTab(tab) {
  st.tab = tab;
  document.querySelectorAll("[data-tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === tab));
  for (const t of ["cal", "list", "days", "settings"]) $(`#tab-${t}`).hidden = t !== tab;
  if (tab !== "settings") load();
}

async function load() {
  document.querySelectorAll(".m-label").forEach((h) => { h.textContent = monthLabel(st.month); });
  try { st.data = await call("GET", `/api/admin/lessons?month=${st.month}`); }
  catch (e) { showErr($("#fatal"), e.message); return; }
  if (!st.calDate || !st.calDate.startsWith(st.month)) st.calDate = nowJST().date.startsWith(st.month) ? nowJST().date : null;
  renderCal(); renderList(); renderDays();
}

// ---- 予約一覧 ----
function renderList() {
  const { data } = st;
  const showC = $("#showCancelled").checked;
  const active = data.lessons.filter((l) => l.status === "active");
  const kids = new Set(active.map((l) => l.reservationId));
  const totalSlots = data.days.reduce((a, d) => a + d.slots.length, 0) * data.capacity;
  const cancelled = data.lessons.length - active.length;
  $("#stats").innerHTML = [
    ["予約コマ数", active.length, "件"],
    ["予約した家庭", kids.size, "件"],
    ["埋まり具合", totalSlots ? Math.round((active.length / totalSlots) * 100) : 0, "%"],
    ["キャンセル", cancelled, "件"],
  ].map(([k, v, u]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}<small>${u}</small></div></div>`).join("");

  const html = data.days.filter((d) => d.open || data.lessons.some((l) => l.date === d.date)).map((d) => dayCard(d, showC)).join("");
  $("#dayList").innerHTML = html || `<p class="loading">この月の営業日はありません。</p>`;
  $("#dayList").querySelectorAll(".x").forEach((b) => b.addEventListener("click", () => cancelLesson(b)));
}

// 1日分の時間割カード（予約一覧とカレンダーの詳細で共通）
function dayCard(d, showC) {
  const { data } = st;
  const today = nowJST().date;
  const ls = data.lessons.filter((l) => l.date === d.date && (showC || l.status === "active"));
  const nActive = data.lessons.filter((l) => l.date === d.date && l.status === "active").length;
  const times = [...new Set([...d.slots, ...ls.map((l) => l.time)])].sort();
  return `<article class="aday ${d.date === today ? "today" : ""}">
    <div class="aday-head"><h3>${formatDateJa(d.date)}${d.date === today ? "（今日）" : ""}</h3><span class="meta">${d.open ? `${nActive}人 / ${d.slots.length}コマ` : `お休み（${esc(d.reason)}）`}</span></div>
    ${times.length ? times.map((t) => {
      const p = ls.filter((l) => l.time === t);
      const n = p.filter((l) => l.status === "active").length;
      return `<div class="aslot"><div class="time">${t}〜${endTime(t, st.settings)}<span class="cap ${n >= data.capacity ? "full" : ""}">${n} / ${data.capacity}人${n >= data.capacity ? " 満席" : ""}</span>
        <div class="meter">${Array.from({ length: data.capacity }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</div></div>
        <div class="people">${p.length ? p.map(person).join("") : `<span class="empty-slot">予約なし</span>`}</div></div>`;
    }).join("") : `<div class="aslot"><span class="empty-slot">レッスンはありません</span></div>`}
  </article>`;
}

// ---- カレンダー（月表示） ----
function renderCal() {
  const { data } = st;
  const today = nowJST().date;
  const first = parseDate(data.days[0].date).dow;
  let html = WEEKDAYS.map((w, i) => `<div class="dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</div>`).join("");
  html += Array.from({ length: first }, () => `<div class="bday blank"></div>`).join("");
  for (const d of data.days) {
    const ls = data.lessons.filter((l) => l.date === d.date && l.status === "active");
    const cap = d.slots.length * data.capacity;
    const shown = ls.slice(0, 4);
    html += `<button type="button" class="bday ${d.open ? "" : "closed"} ${d.date === today ? "today" : ""}" data-date="${d.date}" aria-pressed="${st.calDate === d.date}">
      <span class="bhead"><span class="bnum">${parseDate(d.date).d}</span>${d.open ? `<span class="bcount ${cap && ls.length >= cap ? "full" : ""}">${ls.length}人</span>` : `<span class="bcount full">休</span>`}</span>
      ${d.open ? "" : `<span class="boff">${esc(d.reason)}</span>`}
      ${shown.map((l) => `<span class="chip"><b>${l.time}</b>${esc(l.childName)}</span>`).join("")}
      ${ls.length > shown.length ? `<span class="more">ほか${ls.length - shown.length}人</span>` : ""}
    </button>`;
  }
  $("#bcal").innerHTML = html;
  $("#bcal").querySelectorAll("button.bday").forEach((b) => b.addEventListener("click", () => {
    st.calDate = b.dataset.date; renderCal();
    $("#calDetail").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }));
  const sel = st.calDate && data.days.find((d) => d.date === st.calDate);
  $("#calDetail").innerHTML = sel ? dayCard(sel, true) : "";
  $("#calDetail").querySelectorAll(".x").forEach((b) => b.addEventListener("click", () => cancelLesson(b)));
}

function person(l) {
  return `<div class="person ${l.status === "cancelled" ? "cancelled" : ""}">
    <span class="nm">${esc(l.childName)}</span><span class="gr">${esc(l.grade)}</span><span class="pl">${esc(l.plan)}</span>
    <span class="ct">${esc(l.parentName)}・${esc(l.email)}${l.phone ? `・${esc(l.phone)}` : ""}</span>
    ${l.status === "active" ? `<button type="button" class="x" data-id="${l.id}">取消</button>` : ""}
    ${l.note ? `<span class="nt">${esc(l.note)}</span>` : ""}
  </div>`;
}

async function cancelLesson(btn) {
  // 誤操作防止：1回目で確認表示、2回目で実行
  if (!btn.classList.contains("sure")) {
    btn.classList.add("sure"); btn.textContent = "本当に取消";
    setTimeout(() => { btn.classList.remove("sure"); btn.textContent = "取消"; }, 4000);
    return;
  }
  btn.disabled = true;
  try { await call("POST", `/api/admin/lessons/${btn.dataset.id}/cancel`); await load(); }
  catch (e) { showErr($("#fatal"), e.message); }
}

async function downloadCsv() {
  if (!demo) { location.href = `/api/admin/export.csv?month=${st.month}`; return; }
  const out = await call("GET", `/api/admin/export.csv?month=${st.month}`);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([out.__csv], { type: "text/csv" }));
  a.download = `mowa-yoyaku-${st.month}.csv`;
  a.click();
}

// ---- 営業日 ----
function renderDays() {
  const { data } = st;
  const first = parseDate(data.days[0].date).dow;
  let html = WEEKDAYS.map((w, i) => `<div class="dow ${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</div>`).join("");
  html += Array.from({ length: first }, () => `<div class="day blank"></div>`).join("");
  for (const d of data.days) {
    const n = data.lessons.filter((l) => l.date === d.date && l.status === "active").length;
    const star = data.overrides[d.date] ? "star" : "";
    html += `<button type="button" class="day ${d.open ? "ok" : "off"} ${star}" data-date="${d.date}" aria-pressed="${st.editDate === d.date}">
      <span class="num">${parseDate(d.date).d}</span><span class="mk">${d.open ? (n ? `予約${n}` : "営業") : "休"}</span></button>`;
  }
  $("#dayCal").innerHTML = html;
  $("#dayCal").querySelectorAll("button.day").forEach((b) => b.addEventListener("click", () => editDay(b.dataset.date)));
  if (st.editDate && st.editDate.startsWith(st.month)) editDay(st.editDate); else $("#dayEdit").hidden = true;
}

function editDay(date) {
  st.editDate = date;
  $("#dayCal").querySelectorAll("button.day").forEach((b) => b.setAttribute("aria-pressed", b.dataset.date === date));
  const d = st.data.days.find((x) => x.date === date);
  const base = dayInfo(date, st.settings, {});
  const ov = st.data.overrides[date];
  const n = st.data.lessons.filter((l) => l.date === date && l.status === "active").length;
  $("#dayEdit").hidden = false;
  $("#deTitle").textContent = formatDateJa(date);
  $("#deState").textContent = `いまの状態：${d.open ? "営業" : "お休み"}${ov ? "（個別に変更済み）" : ""}。通常は「${base.open ? "営業" : base.reason}」の日です。`;
  $("#deNote").value = ov?.note || "";
  $("#deReset").hidden = !ov;
  $("#deWarn").textContent = n && d.open ? `※ この日はすでに${n}件の予約があります。お休みにしても予約は自動で取り消されません。予約一覧から取消し、ご家庭へ連絡してください。` : "";
}

async function saveOverride(open) {
  try { await call("PUT", `/api/admin/overrides/${st.editDate}`, { open, note: $("#deNote").value }); await load(); }
  catch (e) { showErr($("#fatal"), e.message); }
}
async function resetOverride() {
  try { await call("DELETE", `/api/admin/overrides/${st.editDate}`); await load(); }
  catch (e) { showErr($("#fatal"), e.message); }
}

// ---- 設定 ----
function fillSettings() {
  const s = st.settings;
  $("#weekTbl").innerHTML = `<thead><tr><th>曜日</th><th>営業</th><th>開始</th><th>終了</th><th>休憩 開始</th><th>休憩 終了</th><th>できるコマ</th></tr></thead><tbody>` +
    [1, 2, 3, 4, 5, 6, 0].map((i) => {
      const r = s.weekly[i];
      return `<tr data-d="${i}" class="${r.open ? "" : "closed"}"><td class="dw">${WEEKDAYS[i]}</td>
        <td><input type="checkbox" data-k="open" ${r.open ? "checked" : ""} aria-label="${WEEKDAYS[i]}曜日 営業"></td>
        <td><input type="time" data-k="start" value="${r.start || ""}" step="300"></td>
        <td><input type="time" data-k="end" value="${r.end || ""}" step="300"></td>
        <td><input type="time" data-k="breakStart" value="${r.breakStart || ""}" step="300"></td>
        <td><input type="time" data-k="breakEnd" value="${r.breakEnd || ""}" step="300"></td>
        <td class="slotsN"></td></tr>`;
    }).join("") + "</tbody>";
  $("#lessonMinutes").value = s.lessonMinutes;
  $("#capacity").value = s.capacity;
  $("#maxPer").value = String(s.maxPerWeekdayPerMonth ? 4 : 0);
  $("#openDays").value = s.bookingOpenDaysAhead;
  $("#closeHours").value = s.bookingCloseHoursBefore;
  $("#cancelHours").value = s.cancelHoursBefore;
  $("#schoolNameIn").value = s.schoolName;
  $("#noticeIn").value = s.notice || "";
  $("#planFields").innerHTML = s.plans.map((p, i) => `<div class="field"><label for="plan${i}">コース名（月${p.times}回）</label><input id="plan${i}" maxlength="20" value="${esc(p.name)}"></div>`).join("");
  $("#settingsForm").addEventListener("input", previewSlots);
  st.admins = [...(s.admins || [])];
  renderAdmins();
  $("#adminAdd").addEventListener("click", () => {
    const v = $("#adminNew").value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return showErr($("#setErr"), "メールアドレスの形式を確認してください");
    showErr($("#setErr"), "");
    if (!st.admins.includes(v)) st.admins.push(v);
    $("#adminNew").value = ""; renderAdmins(); previewSlots();
  });
  previewSlots();
}

function renderAdmins() {
  $("#adminList").innerHTML = st.admins.length
    ? st.admins.map((a, i) => `<li><span>${esc(a)}</span><button type="button" data-i="${i}">外す</button></li>`).join("")
    : `<li><span>まだ登録がありません（公開した人だけが入れます）</span></li>`;
  $("#adminList").querySelectorAll("button").forEach((b) => b.addEventListener("click", () => { st.admins.splice(Number(b.dataset.i), 1); renderAdmins(); previewSlots(); }));
}

function readSettings() {
  const s = structuredClone(st.settings);
  document.querySelectorAll("#weekTbl tbody tr").forEach((tr) => {
    const g = (k) => tr.querySelector(`[data-k="${k}"]`);
    const r = { open: g("open").checked, start: g("start").value, end: g("end").value };
    if (g("breakStart").value || g("breakEnd").value) { r.breakStart = g("breakStart").value; r.breakEnd = g("breakEnd").value; }
    s.weekly[tr.dataset.d] = r;
    tr.classList.toggle("closed", !r.open);
  });
  s.lessonMinutes = Number($("#lessonMinutes").value);
  s.capacity = Number($("#capacity").value);
  s.maxPerWeekdayPerMonth = Number($("#maxPer").value);
  s.bookingOpenDaysAhead = Number($("#openDays").value);
  s.bookingCloseHoursBefore = Number($("#closeHours").value);
  s.cancelHoursBefore = Number($("#cancelHours").value);
  s.schoolName = $("#schoolNameIn").value.trim() || st.settings.schoolName;
  s.notice = $("#noticeIn").value.trim();
  s.plans = s.plans.map((p, i) => ({ ...p, name: $(`#plan${i}`).value.trim() || p.name }));
  s.admins = [...(st.admins || [])];
  return s;
}

function previewSlots() {
  const s = readSettings();
  document.querySelectorAll("#weekTbl tbody tr").forEach((tr) => {
    const r = s.weekly[tr.dataset.d];
    const t = r.open && r.start && r.end ? slotTimes(r, s) : [];
    tr.querySelector(".slotsN").textContent = r.open ? (t.length ? `${t.length}コマ：${t.join(" ")}` : "コマなし") : "お休み";
  });
  $("#saved").hidden = true;
}

async function saveSettings(ev) {
  ev.preventDefault();
  showErr($("#setErr"), "");
  try {
    st.settings = (await call("PUT", "/api/admin/settings", { settings: readSettings() })).settings;
    $("#saved").hidden = false;
  } catch (e) { showErr($("#setErr"), e.message); }
}
