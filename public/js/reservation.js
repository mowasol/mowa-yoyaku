// 予約の確認・変更・キャンセル（保護者向け）
import { call, isDemo } from "./api.js";
import { formatDateJa } from "./schedule.js";
import { $, esc, monthLabel, renderCalendar, renderSlots, showErr } from "./ui.js";

const st = { token: "", rv: null, cfg: null, avail: null, selected: null, pick: null, changing: null, cancelId: null };

init();
window.addEventListener("hashchange", () => location.reload());

async function init() {
  if (await isDemo()) $("#demoBar").hidden = false;
  st.token = location.hash.slice(1);
  $("#openLink").addEventListener("click", () => {
    const m = $("#pasteLink").value.match(/#([0-9a-f]{48})/);
    if (!m) return showErr($("#errLink"), "リンクの形が正しくありません。メールのリンクをそのまま貼り付けてください");
    location.hash = m[1];
  });
  if (!/^[0-9a-f]{48}$/.test(st.token)) { $("#noToken").hidden = false; return; }
  try {
    st.cfg = await call("GET", "/api/config");
    $("#schoolName").textContent = st.cfg.schoolName;
    st.rv = (await call("GET", `/api/reservations/${st.token}`)).reservation;
  } catch (e) {
    $("#noToken").hidden = false; showErr($("#errLink"), e.message); return;
  }
  $("#addBtn").addEventListener("click", () => openPicker(null));
  $("#pickCancel").addEventListener("click", closePicker);
  $("#pickOk").addEventListener("click", doChange);
  $("#confirmNo").addEventListener("click", () => { $("#confirmBox").hidden = true; });
  $("#confirmYes").addEventListener("click", doCancel);
  render();
}

function render() {
  const rv = st.rv;
  $("#view").hidden = false;
  $("#title").textContent = `${rv.childName}さんの予約`;
  $("#sub").textContent = `${rv.planName}（${rv.grade}）・${monthLabel(rv.month)}`;
  $("#lessons").innerHTML = rv.lessons.map((l) => `
    <li class="${l.status === "cancelled" ? "cancelled" : ""}">
      <span><span class="when">${formatDateJa(l.date)} ${l.time}〜${l.end}</span><br>
      <span class="tag ${l.status === "active" ? "on" : "off"}">${l.status === "active" ? "予約済み" : "キャンセル済み"}</span></span>
      ${l.canCancel ? `<span class="actions-inline"><button class="btn ghost small" type="button" data-change="${l.id}">日時を変更</button> <button class="btn danger small" type="button" data-cancel="${l.id}">キャンセル</button></span>` : ""}
    </li>`).join("");
  $("#lessons").querySelectorAll("[data-change]").forEach((b) => b.addEventListener("click", () => openPicker(Number(b.dataset.change))));
  $("#lessons").querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", () => askCancel(Number(b.dataset.cancel))));
  const active = rv.lessons.filter((l) => l.status === "active").length;
  const left = rv.planTimes - active;
  $("#addRow").hidden = left <= 0;
  $("#addText").textContent = `この月はあと${left}回予約できます。`;
  $("#rule").textContent = `変更・キャンセルは、各レッスンの開始${rv.cancelHoursBefore}時間前までこの画面でできます。それ以降は教室へご連絡ください。`;
}

function askCancel(id) {
  const l = st.rv.lessons.find((x) => x.id === id);
  st.cancelId = id;
  $("#confirmText").textContent = `${formatDateJa(l.date)} ${l.time}〜${l.end} のレッスンをキャンセルします。`;
  $("#confirmBox").hidden = false;
  $("#confirmBox").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function doCancel() {
  $("#confirmYes").disabled = true;
  try {
    st.rv = (await call("POST", `/api/reservations/${st.token}/cancel`, { lessonId: st.cancelId })).reservation;
    $("#confirmBox").hidden = true; render();
  } catch (e) { showErr($("#err"), e.message); $("#confirmBox").hidden = true; }
  finally { $("#confirmYes").disabled = false; }
}

async function openPicker(lessonId) {
  st.changing = lessonId; st.pick = null; st.selected = null;
  const l = lessonId && st.rv.lessons.find((x) => x.id === lessonId);
  $("#pickTitle").textContent = l ? "新しい日時をえらぶ" : "追加する日時をえらぶ";
  $("#pickLead").textContent = l ? `いまの予約：${formatDateJa(l.date)} ${l.time}〜${l.end}（同じ月の中で変更できます）` : "同じ月の中でえらんでください。";
  $("#picker").hidden = false; $("#pickOk").disabled = true; showErr($("#errPick"), "");
  $("#monthLabel").textContent = monthLabel(st.rv.month);
  $("#cal").innerHTML = `<p class="loading">空き状況を読み込んでいます…</p>`;
  $("#picker").scrollIntoView({ behavior: "smooth", block: "start" });
  try { st.avail = await call("GET", `/api/availability?month=${st.rv.month}`); }
  catch (e) { $("#cal").innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  draw();
}

function draw() {
  const busy = new Set(st.rv.lessons.filter((l) => l.status === "active" && l.id !== st.changing).map((l) => l.date));
  // 予約済みの他の日はえらべないように見せる
  const avail = { ...st.avail, days: st.avail.days.map((d) => busy.has(d.date) ? { ...d, open: false, reason: "予約済み" } : d) };
  renderCalendar($("#cal"), avail, { today: st.cfg.today, selected: st.selected, picked: new Set(st.pick ? [st.pick.date] : []), onPick: (date) => { st.selected = date; draw(); } });
  const day = st.selected && avail.days.find((d) => d.date === st.selected);
  $("#timesBox").hidden = !day;
  if (day) {
    $("#timesTitle").textContent = `${formatDateJa(day.date)} の時間`;
    renderSlots($("#slots"), day, {
      isChosen: (t) => st.pick?.date === day.date && st.pick?.time === t,
      onToggle: (t) => { st.pick = st.pick?.date === day.date && st.pick?.time === t ? null : { date: day.date, time: t }; $("#pickOk").disabled = !st.pick; draw(); },
    });
  }
}

function closePicker() { $("#picker").hidden = true; }

async function doChange() {
  $("#pickOk").disabled = true;
  try {
    st.rv = (await call("POST", `/api/reservations/${st.token}/change`, { lessonId: st.changing, ...st.pick })).reservation;
    closePicker(); render();
    $("#view").scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    showErr($("#errPick"), e.message);
    if (e.code === "full") { st.avail = await call("GET", `/api/availability?month=${st.rv.month}`); st.pick = null; draw(); }
    $("#pickOk").disabled = !st.pick;
  }
}
