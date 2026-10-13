// POST {action: add|remove} — ručně zadané termíny vydání (oficiální ohlášení, CZ distribuce…).
import { authed, json } from './_lib/auth.js';
import { getJson, setJson } from './_lib/store.js';

export default authed(async (req) => {
  const body = await req.json().catch(() => ({}));
  const list = await getJson('releases', []);

  if (body.action === 'add') {
    if (!body.name || !/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) return json({ error: 'Vyplň název a datum' }, 400);
    list.push({
      id: Date.now().toString(36),
      name: String(body.name).slice(0, 200),
      date: body.date,
      region: body.region || 'EN',
      note: body.note ? String(body.note).slice(0, 500) : null,
      url: body.url || null,
    });
    list.sort((a, b) => a.date.localeCompare(b.date));
    await setJson('releases', list);
    return json({ ok: true, releases: list });
  }

  if (body.action === 'remove') {
    const next = list.filter((r) => r.id !== body.id);
    await setJson('releases', next);
    return json({ ok: true, releases: next });
  }

  return json({ error: 'Neznámá akce' }, 400);
});
