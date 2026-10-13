import { checkPassword, sessionCookie, json } from './_lib/auth.js';

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const { password } = await req.json().catch(() => ({}));
  if (!checkPassword(password)) return json({ error: 'Špatné heslo' }, 401);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie() });
};
