// 画面からAPIを呼ぶ窓口。サーバーが無いとき（ローカルで開いたとき）は
// ブラウザ内の「お試しモード」に自動で切り替わる。
import { createApi, ApiError, mergeSettings } from "./core.js";
import { monthDates, dayInfo, nowJST, addMonths } from "./schedule.js";

let mode = null; // "server" | "demo"
let demoApi = null;

async function detect() {
  if (mode) return mode;
  try {
    const r = await fetch("/api/config", { headers: { Accept: "application/json" } });
    const ct = r.headers.get("Content-Type") || "";
    mode = r.ok && ct.includes("json") ? "server" : "demo";
  } catch { mode = "demo"; }
  if (mode === "demo") demoApi = createApi(demoStore(), {});
  return mode;
}

export async function isDemo() { return (await detect()) === "demo"; }

export async function call(method, path, body) {
  await detect();
  if (mode === "demo") {
    const u = new URL(path, location.origin);
    try {
      const out = await demoApi.handle(method, u.pathname, Object.fromEntries(u.searchParams), body || {}, { admin: true, adminEmail: "demo@mowa" });
      return JSON.parse(JSON.stringify(out));
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(500, String(e.message || e));
    }
  }
  const r = await fetch(path, {
    method, headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = r.headers.get("Content-Type") || "";
  if (ct.includes("text/csv")) return { __csv: await r.text() };
  const data = ct.includes("json") ? await r.json() : {};
  if (!r.ok) throw new ApiError(r.status, data.error || "通信に失敗しました。もう一度お試しください", data.code);
  return data;
}

// ---------- お試しモードの保存先（このブラウザの中だけ） ----------
const KEY = "mowa-yoyaku-demo-v1";
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s) return s; } catch {}
  return seed();
}
function save(db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {} }

// 見本の予約を少し入れておく（すべて架空のサンプル）
function seed() {
  const db = { settings: null, overrides: {}, reservations: [], lessons: [], seq: 1 };
  const settings = mergeSettings(null);
  const today = nowJST().date;
  const names = [["見本 たろう", "小3"], ["見本 はなこ", "小5"], ["見本 じろう", "小1"], ["見本 さくら", "中1"], ["見本 けん", "小4"], ["見本 ゆい", "小2"]];
  let k = 0;
  for (const month of [nowJST().month, addMonths(nowJST().month, 1)]) {
    for (const date of monthDates(month)) {
      if (date <= today) continue;
      const info = dayInfo(date, settings, {});
      info.slots.forEach((time, i) => {
        const n = (date.charCodeAt(9) + i * 3) % 7; // 決まった並びで埋まり具合を作る
        const fill = n === 0 ? settings.capacity : n < 3 ? n : 0;
        for (let j = 0; j < fill; j++) {
          const [child, grade] = names[k++ % names.length];
          const id = `demo${k}`;
          db.reservations.push({ id, token: (id + "0".repeat(48)).slice(0, 48), plan: k % 2 ? "m1" : "m2", month, child_name: child, grade,
            parent_name: "見本 保護者", email: "sample@example.com", phone: "", note: "", created_at: new Date().toISOString() });
          db.lessons.push({ id: db.seq++, reservation_id: id, date, time, status: "active" });
        }
      });
    }
  }
  save(db);
  return db;
}

function demoStore() {
  const countOf = (db, date, time) => db.lessons.filter((l) => l.date === date && l.time === time && l.status === "active").length;
  return {
    async getSettings() { return mergeSettings(load().settings); },
    async saveSettings(s) { const db = load(); db.settings = s; save(db); },
    async getOverrides(from, to) {
      const o = load().overrides; return Object.fromEntries(Object.entries(o).filter(([d]) => d >= from && d <= to));
    },
    async setOverride(date, v) { const db = load(); db.overrides[date] = v; save(db); },
    async deleteOverride(date) { const db = load(); delete db.overrides[date]; save(db); },
    async countActive(from, to) {
      const out = {};
      for (const l of load().lessons) if (l.status === "active" && l.date >= from && l.date <= to) out[`${l.date} ${l.time}`] = (out[`${l.date} ${l.time}`] || 0) + 1;
      return out;
    },
    async createReservation(r, lessons, capacity) {
      const db = load();
      for (const l of lessons) if (countOf(db, l.date, l.time) >= capacity) throw new ApiError(409, "タッチの差で満席になったコマがあります。別の日時を選び直してください", "full");
      db.reservations.push(r);
      for (const l of lessons) db.lessons.push({ id: db.seq++, reservation_id: r.id, date: l.date, time: l.time, status: "active" });
      save(db);
    },
    async getReservation(token) {
      const db = load();
      const res = db.reservations.find((r) => r.token === token);
      if (!res) return null;
      return { res, lessons: db.lessons.filter((l) => l.reservation_id === res.id).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)) };
    },
    async cancelLesson(id, rid) { const db = load(); const l = db.lessons.find((x) => x.id === id && x.reservation_id === rid); if (l) l.status = "cancelled"; save(db); },
    async replaceLesson(oldId, rid, l, capacity) {
      const db = load();
      const old = oldId ? db.lessons.find((x) => x.id === oldId) : null;
      const sameSlot = old && old.date === l.date && old.time === l.time;
      if (!sameSlot && countOf(db, l.date, l.time) >= capacity) throw new ApiError(409, "タッチの差で満席になりました。別の日時を選んでください", "full");
      if (old) old.status = "cancelled";
      db.lessons.push({ id: db.seq++, reservation_id: rid, date: l.date, time: l.time, status: "active" });
      save(db);
    },
    async listLessons(from, to) {
      const db = load();
      return db.lessons.filter((l) => l.date >= from && l.date <= to).map((l) => {
        const r = db.reservations.find((x) => x.id === l.reservation_id) || {};
        return { ...l, plan: r.plan, child_name: r.child_name, grade: r.grade, parent_name: r.parent_name, email: r.email, phone: r.phone, note: r.note };
      }).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time) || a.id - b.id);
    },
    async adminCancelLesson(id) { const db = load(); const l = db.lessons.find((x) => x.id === id); if (l) l.status = "cancelled"; save(db); },
  };
}

export function resetDemo() { try { localStorage.removeItem(KEY); } catch {} }
