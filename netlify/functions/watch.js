// POST {action: add|remove|update, ...} — správa hlídaných produktů.
import { createHash } from 'node:crypto';
import { authed, json } from './_lib/auth.js';
import { getJson, setJson, del, getSettings } from './_lib/store.js';
import { shopForUrl } from './_lib/shops.js';
import { checkWatchItem } from './_lib/jobs.js';

const idFor = (url) => createHash('sha1').update(url).digest('hex').slice(0, 16);

export default authed(async (req) => {
  const body = await req.json().catch(() => ({}));
  const { action } = body;

  if (action === 'add') {
    let url;
    try { url = new URL(String(body.url).trim()); } catch { return json({ error: 'Neplatná URL' }, 400); }
    url.hash = '';
    const clean = url.toString();
    const id = idFor(clean);
    if (await getJson(`watch/${id}`)) return json({ error: 'Tenhle produkt už hlídáš' }, 409);
    const shop = shopForUrl(clean);
    if (shop.blocked) return json({ error: `${shop.name} blokuje automatický přístup, hlídat ho neumím` }, 422);
    const item = {
      id, url: clean, shopId: shop.id, shopName: shop.name,
      name: body.name || null, customName: body.name || null,
      targetPrice: body.targetPrice ? Number(body.targetPrice) : null,
      addedAt: new Date().toISOString(), history: [],
    };
    await checkWatchItem(item, await getSettings()); // hned načte název, cenu a sklad
    await setJson(`watch/${id}`, item);
    return json({ ok: true, item });
  }

  const item = body.id ? await getJson(`watch/${body.id}`) : null;
  if (!item) return json({ error: 'Položka nenalezena' }, 404);

  if (action === 'remove') {
    await del(`watch/${item.id}`);
    return json({ ok: true });
  }

  if (action === 'update') {
    if ('targetPrice' in body) item.targetPrice = body.targetPrice ? Number(body.targetPrice) : null;
    if ('name' in body) { item.customName = body.name || null; item.name = body.name || item.name; }
    await setJson(`watch/${item.id}`, item);
    return json({ ok: true, item });
  }

  if (action === 'check') {
    await checkWatchItem(item, await getSettings());
    await setJson(`watch/${item.id}`, item);
    return json({ ok: true, item });
  }

  return json({ error: 'Neznámá akce' }, 400);
});
