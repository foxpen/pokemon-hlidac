// GET — moje sbírka s aktuálními cenami a historií; ?set=<id> vrátí karty a produkty edice pro výběr.
// POST {action: add|update|remove|profile, ...} — úpravy sbírky a profilu.
import { endpoint, json } from './_lib/http-response.js';
import { getJson, setJson } from './_lib/store.js';
import { loadSetDetail, usdCzk, eurCzk } from './_lib/pokedata.js';
import { GRADES, itemId, findRef, refUsd, getPortfolio } from './_lib/portfolio.js';

const MAX_QTY = 9999;
const qtyOf = (v) => Math.max(0, Math.min(MAX_QTY, Math.round(Number(v) || 0)));
const money = (v) => (v === '' || v == null || !(Number(v) >= 0) ? null : Math.round(Number(v) * 100) / 100);

async function view(port) {
  const ids = [...new Set(port.items.map((i) => i.setId))];
  const sets = new Map(await Promise.all(ids.map(async (id) => {
    const [d, h] = await Promise.all([getJson(`set/${id}`), getJson(`pricehist/${id}`, {})]);
    return [id, { d, h }];
  })));
  const items = port.items.map((it) => {
    const { d, h } = sets.get(it.setId);
    return { ...it, usd: refUsd(d, it), cur: d?.cur || 'USD', pricedAt: d?.fetchedAt || null, hist: h[it.id] || [] };
  });
  return { items, profile: port.profile, usdCzk: await usdCzk(), eurCzk: await eurCzk() };
}

export default endpoint(async (req) => {
  if (req.method === 'GET') {
    const setId = Number(new URL(req.url).searchParams.get('set'));
    if (setId) {
      const d = await loadSetDetail(setId);
      if (!d?.cards) return json({ error: 'Edici se nepodařilo načíst' }, 404);
      return json({
        id: d.id, game: d.game || 'pokemon', cur: d.cur || 'USD', name: d.name, language: d.language, logo: d.logo, releaseDate: d.releaseDate, fetchedAt: d.fetchedAt,
        cards: d.cards, products: d.products, usdCzk: await usdCzk(), rate: d.cur === 'EUR' ? await eurCzk() : await usdCzk(),
      });
    }
    return json(await view(await getPortfolio()));
  }

  const body = await req.json().catch(() => ({}));
  const port = await getPortfolio();
  const { action } = body;

  if (action === 'add') {
    const kind = body.kind === 'product' ? 'product' : 'card';
    const grade = kind === 'card' ? (GRADES.includes(body.grade) ? body.grade : 'raw') : null;
    const setId = Number(body.setId), refId = Number(body.refId);
    const d = await loadSetDetail(setId);
    const ref = findRef(d, kind, refId);
    if (!ref) return json({ error: kind === 'card' ? 'Karta v edici nenalezena' : 'Produkt v edici nenalezen' }, 404);
    const id = itemId(kind, refId, grade);
    const qty = qtyOf(body.qty ?? 1) || 1;
    const cur = port.items.find((i) => i.id === id);
    if (cur) cur.qty = qtyOf(cur.qty + qty);
    else {
      port.items.push({
        id, kind, setId, refId, grade, name: ref.name, num: ref.num || null, img: ref.img || null,
        setName: d.name, language: d.language, ...(d.game ? { game: d.game } : {}), qty, buyPrice: money(body.buyPrice),
        addedAt: new Date().toISOString(), addedUsd: refUsd(d, { kind, refId, grade }),
      });
    }
  } else if (action === 'update' || action === 'remove') {
    const it = port.items.find((i) => i.id === body.id);
    if (!it) return json({ error: 'Položka ve sbírce nenalezena' }, 404);
    if (action === 'update') {
      if ('qty' in body) it.qty = qtyOf(body.qty);
      if ('buyPrice' in body) it.buyPrice = money(body.buyPrice);
      // jiný stav karty = jiná cena, takže i jiná položka (případně se sloučí s existující)
      if (it.kind === 'card' && GRADES.includes(body.grade) && body.grade !== it.grade) {
        const id = itemId('card', it.refId, body.grade);
        const same = port.items.find((i) => i.id === id);
        if (same) { same.qty = qtyOf(same.qty + it.qty); it.qty = 0; }
        else {
          const d = await getJson(`set/${it.setId}`);
          Object.assign(it, { id, grade: body.grade, addedAt: new Date().toISOString(), addedUsd: refUsd(d, { ...it, grade: body.grade }) });
        }
      }
    }
    if (action === 'remove' || it.qty <= 0) port.items = port.items.filter((i) => i !== it);
  } else if (action === 'profile') {
    if ('name' in body) port.profile.name = String(body.name || '').trim().slice(0, 40) || null;
    // profilovka = id spritu trenéra z public/img/trainers (null = výchozí ikona)
    if ('avatar' in body) port.profile.avatar = /^[a-z0-9-]{1,24}$/.test(body.avatar || '') ? body.avatar : null;
  } else {
    return json({ error: 'Neznámá akce' }, 400);
  }

  await setJson('portfolio', port);
  return json(await view(port));
});
