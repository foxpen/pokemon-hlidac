// POST — uložení nastavení notifikací.
import { authed, json } from './_lib/auth.js';
import { setJson, getSettings, DEFAULT_SETTINGS } from './_lib/store.js';

export default authed(async (req) => {
  const body = await req.json().catch(() => ({}));
  const cur = await getSettings();
  const next = { ...cur };
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in body) next[k] = body[k];
  if (!['all', 'announce', 'off'].includes(next.newsNotify)) next.newsNotify = 'announce';
  next.keywords = (Array.isArray(next.keywords) ? next.keywords : String(next.keywords || '').split(','))
    .map((k) => String(k).trim()).filter(Boolean).slice(0, 30);
  next.disabledShops = Array.isArray(next.disabledShops) ? next.disabledShops : [];
  await setJson('settings', next);
  return json({ ok: true, settings: next });
});
