import { clearCookie, json } from './_lib/auth.js';

export default async () => json({ ok: true }, 200, { 'Set-Cookie': clearCookie });
