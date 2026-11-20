// 予約APIの中身（ルール判定）。保存先(store)を差し替えて、
// 本番は Google Apps Script（スプレッドシート）、お試しモードはブラウザ内で同じ動きをする。
// Apps Script 用には tools/build_gas.py で gas/Shared.gs に変換する。
import {
  DEFAULT_SETTINGS, GRADES, dayInfo, monthDates, isBookable, canCancel,
  nowJST, addMonths, validateSettings, endTime, formatDateJa,
} from "./schedule.js";

export class ApiError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
const bad = (msg, code = "bad_request") => new ApiError(400, msg, code);

export function mergeSettings(saved) {
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

export function createApi(store, opts = {}) {
  const now = () => (opts.now ? opts.now() : Date.now());

  async function availability(month) {
    if (!MONTH_RE.test(month)) throw bad("月の指定が正しくありません");
    const settings = await store.getSettings();
    const dates = monthDates(month);
    const overrides = await store.getOverrides(dates[0], dates[dates.length - 1]);
    const counts = await store.countActive(dates[0], dates[dates.length - 1]);
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
  async function assertSlotValid(settings, date, time) {
    if (!DATE_RE.test(date) || !TIME_RE.test(time)) throw bad("日時の指定が正しくありません");
    const overrides = await store.getOverrides(date, date);
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

  async function createReservation(body, ctx) {
    const settings = await store.getSettings();
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
      await assertSlotValid(settings, l.date, l.time);
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
    await store.createReservation(res, sorted.map((l) => ({ date: l.date, time: l.time })), settings.capacity);
    const saved = await store.getReservation(res.token);
    const out = publicReservation(saved.res, saved.lessons, settings);
    await ctx?.notify?.("created", { token: res.token, reservation: out, settings });
    return { token: res.token, reservation: out };
  }

  async function getByToken(token) {
    if (!/^[0-9a-f]{48}$/.test(token || "")) throw new ApiError(404, "予約が見つかりません", "not_found");
    const found = await store.getReservation(token);
    if (!found) throw new ApiError(404, "予約が見つかりません", "not_found");
    return found;
  }

  async function cancelLesson(token, body, ctx) {
    const settings = await store.getSettings();
    const { res, lessons } = await getByToken(token);
    const l = lessons.find((x) => x.id === Number(body.lessonId));
    if (!l || l.status !== "active") throw bad("キャンセルできる予約がありません");
    if (!canCancel(l.date, l.time, settings, now())) throw bad(`開始${settings.cancelHoursBefore}時間前を過ぎたため、Webではキャンセルできません。教室へご連絡ください`);
    await store.cancelLesson(l.id, res.id);
    const saved = await store.getReservation(token);
    const out = publicReservation(saved.res, saved.lessons, settings);
    await ctx?.notify?.("cancelled", { token, reservation: out, lesson: l, settings });
    return { reservation: out };
  }

  // 日時の変更（lessonId あり）または、キャンセル後の追加（lessonId なし）
  async function changeLesson(token, body, ctx) {
    const settings = await store.getSettings();
    const { res, lessons } = await getByToken(token);
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
    await assertSlotValid(settings, body.date, body.time);
    await store.replaceLesson(old ? old.id : null, res.id, { date: body.date, time: body.time }, settings.capacity);
    const saved = await store.getReservation(token);
    const out = publicReservation(saved.res, saved.lessons, settings);
    await ctx?.notify?.("changed", { token, reservation: out, from: old, to: body, settings });
    return { reservation: out };
  }

  // ---- 管理者用 ----
  async function adminLessons(month) {
    if (!MONTH_RE.test(month)) throw bad("月の指定が正しくありません");
    const settings = await store.getSettings();
    const dates = monthDates(month);
    const rows = await store.listLessons(dates[0], dates[dates.length - 1]);
    const overrides = await store.getOverrides(dates[0], dates[dates.length - 1]);
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

  async function adminCsv(month) {
    const data = await adminLessons(month);
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["日付", "開始", "終了", "状態", "コース", "お子さま", "学年", "保護者", "メール", "電話", "ご要望"];
    const lines = data.lessons.map((l) => [l.date, l.time, l.end, l.status === "active" ? "予約" : "キャンセル", l.plan, l.childName, l.grade, l.parentName, l.email, l.phone, l.note].map(esc).join(","));
    return "﻿" + [head.map(esc).join(","), ...lines].join("\r\n");
  }

  async function handle(method, path, query = {}, body = {}, ctx = {}) {
    const seg = path.replace(/^\/api\//, "").split("/").filter(Boolean);
    const isAdmin = seg[0] === "admin";
    if (isAdmin && !ctx.admin) throw new ApiError(403, "管理者としてログインしてください", "forbidden");

    if (method === "GET" && path === "/api/config") {
      const s = await store.getSettings();
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
        const s = await store.getSettings();
        const { res, lessons } = await getByToken(seg[1]);
        return { reservation: publicReservation(res, lessons, s) };
      }
      if (method === "POST" && seg[2] === "cancel") return cancelLesson(seg[1], body, ctx);
      if (method === "POST" && seg[2] === "change") return changeLesson(seg[1], body, ctx);
    }

    if (isAdmin) {
      if (method === "GET" && seg[1] === "me") return { email: ctx.adminEmail || "" };
      if (method === "GET" && seg[1] === "settings") return { settings: await store.getSettings() };
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
        await store.saveSettings(s);
        return { settings: s };
      }
      if (method === "GET" && seg[1] === "lessons") return adminLessons(query.month || nowJST(now()).month);
      if (method === "GET" && seg[1] === "export.csv") return { __csv: await adminCsv(query.month || nowJST(now()).month) };
      if (method === "POST" && seg[1] === "lessons" && seg[3] === "cancel") {
        await store.adminCancelLesson(Number(seg[2]));
        return { ok: true };
      }
      if (seg[1] === "overrides" && DATE_RE.test(seg[2] || "")) {
        if (method === "PUT") {
          await store.setOverride(seg[2], { open: !!body.open, note: str(body.note, 40, "メモ", false) });
          return { ok: true };
        }
        if (method === "DELETE") { await store.deleteOverride(seg[2]); return { ok: true }; }
      }
    }
    throw new ApiError(404, "見つかりません", "not_found");
  }

  return { handle, availability, nextMonth: (m) => addMonths(m, 1) };
}
