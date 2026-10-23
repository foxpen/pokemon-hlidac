// Účty a přihlášení. Uživatelé jsou v Blobs (users/<jméno>), heslo jen jako scrypt otisk se solí.
// Přihlášení = podepsaná cookie (HMAC) se jménem, verzí hesla a expirací. Verze se mění s každým
// nastavením hesla, takže změna nebo reset hesla odhlásí všechna ostatní zařízení. Klíč k podpisu: SESSION_SECRET z env,
// jinak se při prvním použití vygeneruje a uloží do Blobs (auth/secret), takže se nic nastavovat nemusí.
import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getJson, setJson, del, listJson } from './store.js';

const scryptAsync = promisify(scrypt);
const COOKIE = 'ph_session';
const MAX_AGE = 30 * 24 * 3600;
const MAX_FAILS = 5, LOCK_MIN = 5;

let cachedKey = null;
async function secret() {
  if (process.env.SESSION_SECRET?.length >= 32) return process.env.SESSION_SECRET;
  if (cachedKey) return cachedKey;
  let s = await getJson('auth/secret');
  if (!s?.key) {
    s = { key: randomBytes(32).toString('hex') };
    await setJson('auth/secret', s);
  }
  return (cachedKey = s.key);
}

const sign = async (payload) => createHmac('sha256', await secret()).update(payload).digest('base64url');

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---- účty ----
export const normName = (n) => String(n || '').trim().toLowerCase();
export const validName = (n) => /^[a-z0-9._-]{3,32}$/.test(n);
export const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 200;

async function hashPassword(pw) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${(await scryptAsync(pw, salt, 64)).toString('hex')}`;
}

export async function checkPassword(pw, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash || typeof pw !== 'string') return false;
  return safeEqual((await scryptAsync(pw, Buffer.from(salt, 'hex'), 64)).toString('hex'), hash);
}

export const getUser = async (name) => (validName(name) ? getJson(`users/${name}`) : null);
export const listUsers = async () =>
  (await listJson('users/')).map((u) => ({ name: u.name, createdAt: u.createdAt })).sort((a, b) => a.name.localeCompare(b.name));

export async function saveUser(name, password, existing = null) {
  const user = {
    name, createdAt: existing?.createdAt || new Date().toISOString(),
    hash: await hashPassword(password), ver: randomBytes(8).toString('hex'),
  };
  await setJson(`users/${name}`, user);
  return user;
}
export const removeUser = (name) => del(`users/${name}`);

// ---- cookie ----
export async function sessionCookie(user, remember) {
  const payload = Buffer.from(JSON.stringify({ u: user.name, v: user.ver, exp: Math.floor(Date.now() / 1000) + MAX_AGE })).toString('base64url');
  // bez „Zapamatovat si mě“ je cookie jen do zavření prohlížeče
  return `${COOKIE}=${payload}.${await sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax${remember ? `; Max-Age=${MAX_AGE}` : ''}`;
}
export const clearCookie = `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export async function sessionUser(req) {
  const raw = (req.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig || !safeEqual(sig, await sign(payload))) return null;
  let data;
  try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (!data?.u || !(data.exp > Date.now() / 1000)) return null;
  const user = await getUser(data.u);
  // smazaný účet nebo změněné heslo = konec přihlášení
  return user && user.ver && safeEqual(user.ver, data.v || '') ? user.name : null;
}

// ---- ochrana proti hádání hesla: po 5 chybách zámek pro to jméno na 5 minut ----
export async function lockedMinutes(name) {
  const f = await getJson(`auth/fail/${name}`);
  return f?.until && Date.now() < f.until ? Math.ceil((f.until - Date.now()) / 60e3) : 0;
}
export async function noteFail(name) {
  const f = await getJson(`auth/fail/${name}`, { n: 0 });
  const n = (f.until ? 0 : f.n) + 1; // po vypršení zámku se počítá znovu
  await setJson(`auth/fail/${name}`, n >= MAX_FAILS ? { n: 0, until: Date.now() + LOCK_MIN * 60e3 } : { n });
}
export const clearFails = (name) => del(`auth/fail/${name}`);

// ---- pozvánky: nový účet (kromě prvního) jde založit jen s jednorázovým kódem, platným 7 dní ----
// Kód PIKA-XXXX-XXXX z 31 znaků bez zaměnitelných (0/O, 1/I/L) = 31^8 možností.
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVITE_DAYS = 7;
const pick4 = () => Array.from({ length: 4 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');

// Toleruje malá písmena, mezery a chybějící pomlčky / předponu; vrací kanonický tvar, nebo null.
export function normCode(input) {
  const raw = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^PIKA/, '');
  return raw.length === 8 && [...raw].every((c) => CODE_CHARS.includes(c)) ? `PIKA-${raw.slice(0, 4)}-${raw.slice(4)}` : null;
}

export async function createInvite(by) {
  const invite = { code: `PIKA-${pick4()}-${pick4()}`, createdBy: by, createdAt: new Date().toISOString(), expiresAt: Date.now() + INVITE_DAYS * 864e5 };
  await setJson(`invites/${invite.code}`, invite);
  return invite;
}

export async function getInvite(code) {
  const c = normCode(code);
  const inv = c ? await getJson(`invites/${c}`) : null;
  return inv && inv.expiresAt > Date.now() ? inv : null;
}

export async function listInvites() {
  const all = await listJson('invites/');
  await Promise.all(all.filter((i) => i.expiresAt <= Date.now()).map((i) => del(`invites/${i.code}`))); // prošlé uklidit
  return all.filter((i) => i.expiresAt > Date.now()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const removeInvite = (code) => { const c = normCode(code); return c ? del(`invites/${c}`) : null; };
