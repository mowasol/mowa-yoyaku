// mowaプログラミング 予約サイト — Cloudflare Worker（予約API）
// 画面(public/)は Workers の静的アセットとして配信し、/api/* だけここで処理する。
import { createApi, ApiError, mergeSettings } from "../public/js/core.js";
import { formatDateJa, nowJST, addDays, endTime } from "../public/js/schedule.js";

// ---------- D1 保存先 ----------
function d1Store(db) {
  return {
    async getSettings() {
      const row = await db.prepare("SELECT value FROM settings WHERE key='main'").first();
      return mergeSettings(row ? JSON.parse(row.value) : null);
    },
    async saveSettings(s) {
      await db.prepare("INSERT INTO settings (key,value) VALUES ('main',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
        .bind(JSON.stringify(s)).run();
    },
    async getOverrides(from, to) {
      const { results } = await db.prepare("SELECT date, open, note FROM overrides WHERE date BETWEEN ? AND ?").bind(from, to).all();
      return Object.fromEntries(results.map((r) => [r.date, { open: !!r.open, note: r.note }]));
    },
    async setOverride(date, { open, note }) {
      await db.prepare("INSERT INTO overrides (date,open,note) VALUES (?,?,?) ON CONFLICT(date) DO UPDATE SET open=excluded.open, note=excluded.note")
        .bind(date, open ? 1 : 0, note || "").run();
    },
    async deleteOverride(date) { await db.prepare("DELETE FROM overrides WHERE date=?").bind(date).run(); },
    async countActive(from, to) {
      const { results } = await db.prepare("SELECT date, time, COUNT(*) AS n FROM lessons WHERE status='active' AND date BETWEEN ? AND ? GROUP BY date, time").bind(from, to).all();
      return Object.fromEntries(results.map((r) => [`${r.date} ${r.time}`, r.n]));
    },
    async createReservation(r, lessons) {
      const stmts = [
        db.prepare("INSERT INTO reservations (id,token,plan,month,child_name,grade,parent_name,email,phone,note,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
          .bind(r.id, r.token, r.plan, r.month, r.child_name, r.grade, r.parent_name, r.email, r.phone, r.note, r.created_at),
        ...lessons.map((l) => db.prepare("INSERT INTO lessons (reservation_id,date,time,status) VALUES (?,?,?,'active')").bind(r.id, l.date, l.time)),
      ];
      await runBatch(db, stmts);
    },
    async getReservation(token) {
      const res = await db.prepare("SELECT * FROM reservations WHERE token=? AND anonymized=0").bind(token).first();
      if (!res) return null;
      const { results } = await db.prepare("SELECT id,date,time,status FROM lessons WHERE reservation_id=? ORDER BY date,time").bind(res.id).all();
      return { res, lessons: results };
    },
    async cancelLesson(id, reservationId) {
      await db.prepare("UPDATE lessons SET status='cancelled' WHERE id=? AND reservation_id=?").bind(id, reservationId).run();
    },
    async replaceLesson(oldId, reservationId, l) {
      const stmts = [];
      if (oldId) stmts.push(db.prepare("UPDATE lessons SET status='cancelled' WHERE id=? AND reservation_id=?").bind(oldId, reservationId));
      stmts.push(db.prepare("INSERT INTO lessons (reservation_id,date,time,status) VALUES (?,?,?,'active')").bind(reservationId, l.date, l.time));
      await runBatch(db, stmts);
    },
    async listLessons(from, to) {
      const { results } = await db.prepare(
        `SELECT l.id, l.date, l.time, l.status, l.reservation_id, r.plan, r.child_name, r.grade, r.parent_name, r.email, r.phone, r.note
         FROM lessons l JOIN reservations r ON r.id = l.reservation_id
         WHERE l.date BETWEEN ? AND ? ORDER BY l.date, l.time, l.id`).bind(from, to).all();
      return results;
    },
    async adminCancelLesson(id) { await db.prepare("UPDATE lessons SET status='cancelled' WHERE id=?").bind(id).run(); },
  };
}

// 複数の書き込みを1つのトランザクションで。定員オーバーはDBのトリガーが止める
async function runBatch(db, stmts) {
  try {
    await db.batch(stmts);
  } catch (e) {
    if (String(e?.message || e).includes("SLOT_FULL")) {
      throw new ApiError(409, "タッチの差で満席になったコマがあります。別の日時を選び直してください", "full");
    }
    throw e;
  }
}

// ---------- 管理者の確認（Cloudflare Access） ----------
let certCache = { at: 0, keys: [] };
const b64urlBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

async function verifyAccess(request, env) {
  if (env.DEV_ADMIN === "1") return { email: "dev@localhost" };   // ローカル開発用。本番では設定しない
  const jwt = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jwt || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const [h, p, sig] = jwt.split(".");
  if (!sig) return null;
  const header = JSON.parse(new TextDecoder().decode(b64urlBytes(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64urlBytes(p)));
  const team = env.ACCESS_TEAM_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (Date.now() - certCache.at > 3600_000 || !certCache.keys.some((k) => k.kid === header.kid)) {
    const r = await fetch(`https://${team}/cdn-cgi/access/certs`);
    certCache = { at: Date.now(), keys: (await r.json()).keys || [] };
  }
  const jwk = certCache.keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD) || payload.iss !== `https://${team}` || payload.exp * 1000 < Date.now()) return null;
  const allow = (env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.includes(String(payload.email).toLowerCase())) return null;
  return { email: payload.email };
}

// ---------- ボット対策（Turnstile） ----------
async function verifyTurnstile(token, request, env) {
  if (!env.TURNSTILE_SECRET) return true; // 未設定なら確認しない（開発時）
  if (!token) return false;
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET);
  form.append("response", token);
  form.append("remoteip", request.headers.get("CF-Connecting-IP") || "");
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  return (await r.json()).success === true;
}

// ---------- メール（Resend） ----------
async function sendMail(env, to, subject, text) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !to) return;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, text, reply_to: env.ADMIN_NOTIFY_EMAIL || undefined }),
  });
  if (!r.ok) console.error("mail failed", r.status, await r.text());
}

function lessonLines(rv) {
  return rv.lessons.filter((l) => l.status === "active").map((l) => `・${formatDateJa(l.date)} ${l.time}〜${l.end}`).join("\n") || "（現在、予約中の回はありません）";
}

function makeNotifier(env, siteUrl) {
  return async (kind, { token, reservation: rv, settings }) => {
    const link = `${siteUrl}/reservation.html#${token}`;
    const school = settings.schoolName;
    const title = { created: "ご予約を受け付けました", cancelled: "キャンセルを受け付けました", changed: "日時の変更を受け付けました" }[kind];
    const body = `${rv.parentName} 様\n\n${school}です。${title}。\n\n■ コース：${rv.planName}\n■ お子さま：${rv.childName}（${rv.grade}）\n■ 予約中の日時\n${lessonLines(rv)}\n\n予約の確認・変更・キャンセルはこちら（開始${settings.cancelHoursBefore}時間前まで）：\n${link}\n\nこのリンクはご家庭専用です。他の方に共有しないでください。\n\n${school}`;
    await sendMail(env, rv.email, `【${school}】${title}`, body);
    if (env.ADMIN_NOTIFY_EMAIL) {
      await sendMail(env, env.ADMIN_NOTIFY_EMAIL, `[予約${{ created: "新規", cancelled: "キャンセル", changed: "変更" }[kind]}] ${rv.childName}（${rv.grade}）`,
        `${rv.planName}\n${lessonLines(rv)}\n保護者：${rv.parentName}\nメール：${rv.email}\n電話：${rv.phone}\nご要望：${rv.note}\n\n管理画面：${siteUrl}/admin/`);
    }
  };
}

// ---------- 入口 ----------
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra },
});

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const siteUrl = (env.SITE_URL || url.origin).replace(/\/$/, "");
    const api = createApi(d1Store(env.DB), { turnstileSiteKey: env.TURNSTILE_SITE_KEY });
    try {
      // 別サイトからの書き込みを拒否
      if (request.method !== "GET") {
        const origin = request.headers.get("Origin");
        if (origin && origin !== url.origin && origin !== siteUrl) return json({ error: "不正なリクエストです" }, 403);
      }
      const isAdmin = url.pathname.startsWith("/api/admin/");
      const admin = isAdmin ? await verifyAccess(request, env) : null;
      if (isAdmin && !admin) return json({ error: "管理者としてログインしてください" }, 403);

      let body = {};
      if (request.method === "POST" || request.method === "PUT") {
        if (Number(request.headers.get("Content-Length") || 0) > 20000) return json({ error: "データが大きすぎます" }, 413);
        body = await request.json().catch(() => ({}));
      }
      if (request.method === "POST" && url.pathname === "/api/reservations") {
        if (!(await verifyTurnstile(body.turnstileToken, request, env))) return json({ error: "ロボットでないことの確認ができませんでした。もう一度お試しください" }, 400);
      }

      const notify = makeNotifier(env, siteUrl);
      const result = await api.handle(request.method, url.pathname, Object.fromEntries(url.searchParams), body, {
        admin: !!admin, adminEmail: admin?.email,
        notify: (kind, data) => { ctx.waitUntil(notify(kind, data).catch((e) => console.error(e))); },
      });
      if (result && result.__csv !== undefined) {
        return new Response(result.__csv, { headers: {
          "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="mowa-yoyaku-${url.searchParams.get("month") || "list"}.csv"`,
        } });
      }
      return json(result);
    } catch (e) {
      if (e instanceof ApiError) return json({ error: e.message, code: e.code }, e.status);
      console.error(e);
      return json({ error: "サーバーでエラーが起きました。時間をおいてもう一度お試しください" }, 500);
    }
  },

  // 毎日 9:00(日本時間) に実行：前日リマインドと、古い個人情報の削除
  async scheduled(event, env, ctx) {
    const db = env.DB;
    const store = d1Store(db);
    const settings = await store.getSettings();
    const siteUrl = (env.SITE_URL || "").replace(/\/$/, "");
    const tomorrow = addDays(nowJST().date, 1);

    const { results } = await db.prepare(
      `SELECT l.id, l.date, l.time, r.token, r.parent_name, r.child_name, r.email FROM lessons l
       JOIN reservations r ON r.id=l.reservation_id
       WHERE l.date=? AND l.status='active' AND l.reminded=0 AND r.anonymized=0`).bind(tomorrow).all();
    for (const l of results) {
      await sendMail(env, l.email, `【${settings.schoolName}】明日のレッスンのお知らせ`,
        `${l.parent_name} 様\n\n明日 ${formatDateJa(l.date)} ${l.time}〜${endTime(l.time, settings)} は、${l.child_name}さんのレッスンです。お待ちしています。\n\n予約の確認：${siteUrl}/reservation.html#${l.token}\n\n${settings.schoolName}`);
      await db.prepare("UPDATE lessons SET reminded=1 WHERE id=?").bind(l.id).run();
    }

    // 保存期間を過ぎた予約の個人情報を消す（日時と学年だけ残して集計に使える）
    const days = Number(env.RETENTION_DAYS || 365);
    const cutoff = addDays(nowJST().date, -days).slice(0, 7);
    await db.prepare(
      `UPDATE reservations SET child_name='(削除済み)', parent_name='(削除済み)', email='', phone='', note='', anonymized=1
       WHERE anonymized=0 AND month < ?`).bind(cutoff).run();
  },
};
