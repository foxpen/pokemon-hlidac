// Jednoduché přihlášení heslem: APP_PASSWORD + podepsaná cookie (HMAC, 30 dní).
import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'ph_session';
const MAX_AGE = 30 * 24 * 3600;

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET chybí nebo je kratší než 32 znaků');
  return s;
}

const sign = (payload) => createHmac('sha256', secret()).update(payload).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkPassword(pw) {
  const expected = process.env.APP_PASSWORD;
  return !!expected && typeof pw === 'string' && safeEqual(pw, expected);
}

export function sessionCookie() {
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  return `${COOKIE}=${exp}.${sign(exp)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`;
}

export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export function isAuthed(req) {
  const raw = (req.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return false;
  const [exp, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return safeEqual(sig, sign(exp));
}

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

// Obal pro endpointy dashboardu: 401 bez cookie, chyby jako JSON.
export function authed(handler) {
  return async (req, ctx) => {
    if (!isAuthed(req)) return json({ error: 'Nepřihlášen' }, 401);
    try {
      return await handler(req, ctx);
    } catch (e) {
      console.error(e);
      return json({ error: e.message || String(e) }, 500);
    }
  };
}
