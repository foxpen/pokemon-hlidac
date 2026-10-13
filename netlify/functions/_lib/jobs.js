// Kontroly, které spouští cron (cron-stock / cron-scan) i tlačítko „Zkontrolovat teď“.
// Každá úloha dostane `deadline` (ms timestamp): naplánované funkce na Netlify mají limit 30 s,
// běžné 10 s — co se nestihne, dodělá další běh (položky se berou od nejdéle nekontrolovaných).
import { fetchText, pool } from './http.js';
import { parseProduct } from './product.js';
import { SHOPS, shopForUrl, extractProductLinks, scanCernyRytir, fetchCernyRytir } from './shops.js';
import { fetchAllNews } from './news.js';
import { scanOfficial } from './official.js';
import { getJson, setJson, listJson, pushFeed, getSettings } from './store.js';
import { notify } from './notify.js';

const nowIso = () => new Date().toISOString();
const evId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export async function fetchProduct(url) {
  const shop = shopForUrl(url);
  if (shop?.api === 'cernyrytir') return { ...(await fetchCernyRytir(url)), shop };
  const { text, finalUrl } = await fetchText(url);
  return { ...parseProduct(text, finalUrl || url), shop };
}

// ---------- Watchlist ----------

function watchEvents(prev, cur, item, settings) {
  const evs = [];
  const base = {
    title: cur.name || item.name, url: item.url, shop: item.shopName, image: cur.image || item.image,
    price: cur.price, availability: cur.availability,
  };
  const wasAvailable = prev.availability === 'in_stock' || prev.availability === 'preorder';
  if (!wasAvailable && cur.availability === 'in_stock' && settings.notifyRestock) {
    evs.push({ ...base, type: 'restock' });
  } else if (!wasAvailable && cur.availability === 'preorder' && settings.notifyRestock) {
    evs.push({ ...base, type: 'preorder' });
  }
  if (settings.notifyPriceDrop && prev.price != null && cur.price != null && cur.price < prev.price * 0.99) {
    // s cílovou cenou hlásíme jen překročení cíle, jinak každé zlevnění o víc než 1 %
    const target = item.targetPrice;
    if (!target || (cur.price <= target && prev.price > target)) {
      evs.push({ ...base, type: 'price_drop', oldPrice: prev.price });
    }
  }
  return evs;
}

export async function checkWatchItem(item, settings) {
  const prev = { price: item.price, availability: item.availability };
  const first = !item.lastChecked;
  try {
    const p = await fetchProduct(item.url);
    const changed = p.price !== item.price || p.availability !== item.availability;
    const events = first ? [] : watchEvents(prev, p, item, settings);
    Object.assign(item, {
      name: item.customName || p.name || item.name,
      image: p.image || item.image,
      price: p.price,
      availability: p.availability,
      stockNote: p.stockNote || null,
      releaseDate: p.releaseDate || item.releaseDate || null,
      lastChecked: nowIso(),
      error: p.isProduct ? null : 'Stránka nevypadá jako produkt (chybí cena / schema.org) — zkontroluj URL',
    });
    if (changed || first) {
      item.lastChange = nowIso();
      item.history = [...(item.history || []), { t: nowIso(), price: p.price, availability: p.availability }].slice(-60);
    }
    return events;
  } catch (e) {
    item.lastChecked = nowIso();
    item.error = e.message;
    return [];
  }
}

export async function runStock({ deadline }) {
  const settings = await getSettings();
  const items = (await listJson('watch/')).sort((a, b) => (a.lastChecked || '').localeCompare(b.lastChecked || ''));
  const events = [];
  let checked = 0;
  await pool(items, 4, async (item) => {
    if (Date.now() > deadline) return;
    const evs = await checkWatchItem(item, settings);
    await setJson(`watch/${item.id}`, item);
    events.push(...evs);
    checked++;
  });
  const stamped = events.map((e) => ({ id: evId(), time: nowIso(), ...e }));
  await pushFeed('stock', stamped);
  const n = await notify(stamped);
  await setJson('run/stock', { at: nowIso(), checked, total: items.length, events: stamped.length, notifyErrors: n.errors });
  return { checked, total: items.length, events: stamped.length, notifyErrors: n.errors };
}

// ---------- Nové produkty v obchodech + katalog CZ trhu ----------

const NEW_PER_RUN = 5;     // kolik nových odkazů na obchod ověřit detailem za jeden běh
const REFRESH_PER_RUN = 6; // kolik známých produktů na obchod přečíst znovu (aktuálnost katalogu)

const AVAILABLE = new Set(['in_stock', 'preorder']);

// Změny dostupnosti v katalogu → podklad pro „Co letí“ na přehledu.
// Události jsou `silent`: jdou do přehledu, ale neposílají notifikaci (ty jsou jen pro hlídané).
function trackAvail(prev, next, shop, events) {
  if (!prev?.availability || prev.availability === 'unknown' || next.availability === 'unknown') return;
  if (prev.availability === next.availability) return;
  const now = nowIso();
  next.prevAvailability = prev.availability;
  next.availChangedAt = now;
  const base = { title: next.name, url: next.url, shop: shop.name, price: next.price, availability: next.availability, image: next.image, silent: true };
  if (AVAILABLE.has(prev.availability) && next.availability === 'out_of_stock') {
    next.soldOutAt = now;
    events.push({ ...base, type: 'sold_out' });
  } else if (!AVAILABLE.has(prev.availability) && AVAILABLE.has(next.availability)) {
    next.restockedAt = now;
    events.push({ ...base, type: next.availability === 'preorder' ? 'preorder' : 'restock' });
  }
}

function matchesKeywords(name, settings) {
  if (!settings.keywords?.length) return true;
  const n = (name || '').toLowerCase();
  return settings.keywords.some((k) => n.includes(k.toLowerCase()));
}

async function scanShop(shop, settings, deadline) {
  const key = `shop/${shop.id}`;
  const st = await getJson(key, { seen: {}, queue: [], baselined: false });
  const events = [];
  const now = nowIso();

  if (shop.api === 'cernyrytir') {
    const list = await scanCernyRytir(60);
    for (const p of list) {
      const old = st.seen[p.url];
      if (!old && st.baselined) events.push({ type: 'new_product', title: p.name, url: p.url, shop: shop.name, price: p.price, availability: p.availability, image: p.image, releaseDate: p.releaseDate });
      const next = { ...old, ...p, firstSeen: old?.firstSeen || now, checkedAt: now };
      trackAvail(old, next, shop, events);
      st.seen[p.url] = next;
    }
  } else {
    const links = new Map();
    for (const url of shop.scan) {
      const { text } = await fetchText(url);
      for (const l of extractProductLinks(text, url, shop)) if (!links.has(l.url)) links.set(l.url, l.title);
    }
    if (!links.size) throw new Error('kategorie nevrátila žádné produkty (změnil se web?)');
    for (const [url, title] of links) {
      if (st.seen[url] || st.queue.some((q) => q.url === url)) continue;
      if (st.baselined) st.queue.push({ url, title });
      else st.seen[url] = { url, name: title, firstSeen: now, checkedAt: null };
    }
    // nové odkazy → detail → pokud je to produkt, hlásíme
    const batch = st.queue.splice(0, NEW_PER_RUN);
    await pool(batch, 3, async ({ url, title }) => {
      if (Date.now() > deadline) { st.queue.push({ url, title }); return; }
      try {
        const { text, finalUrl } = await fetchText(url);
        const p = parseProduct(text, finalUrl || url);
        st.seen[url] = { url, ...p, name: p.name || title, firstSeen: now, checkedAt: now };
        if (p.isProduct) events.push({ type: 'new_product', title: p.name || title, url, shop: shop.name, price: p.price, availability: p.availability, image: p.image });
      } catch (e) {
        st.seen[url] = { url, name: title, firstSeen: now, checkedAt: now, isProduct: false, error: e.message };
      }
    });
    // obnova nejstarších známých produktů, ať je přehled trhu aktuální
    const candidates = Object.values(st.seen).filter((s) => s.isProduct !== false);
    // dokud jsou v katalogu nepřečtené produkty (po prvním skenu), bereme jich víc — deadline to uhlídá
    const unread = candidates.filter((s) => !s.checkedAt).length;
    const stale = candidates
      .sort((a, b) => (a.checkedAt || '').localeCompare(b.checkedAt || ''))
      .slice(0, unread ? 12 : REFRESH_PER_RUN);
    await pool(stale, 3, async (s) => {
      if (Date.now() > deadline) return;
      try {
        const { text, finalUrl } = await fetchText(s.url);
        const p = parseProduct(text, finalUrl || s.url);
        const prev = { availability: s.availability };
        Object.assign(s, p, { name: p.name || s.name, checkedAt: nowIso(), error: null });
        trackAvail(prev, s, shop, events);
      } catch (e) {
        Object.assign(s, { checkedAt: nowIso(), error: e.message });
      }
    });
  }
  st.baselined = true;
  st.lastScan = now;
  st.error = null;
  await setJson(key, st);
  return events;
}

async function scanNews(settings) {
  const st = await getJson('news', { items: [], baselined: false });
  const { items: fresh, errors } = await fetchAllNews();
  const known = new Set(st.items.map((i) => i.id));
  const knownTitles = new Set(st.items.map((i) => i.title.toLowerCase()));
  const added = [];
  for (const i of fresh) {
    // stejný článek chodí z Google News i přímo ze zdroje → dedup i podle titulku
    if (known.has(i.id) || knownTitles.has(i.title.toLowerCase())) continue;
    known.add(i.id); knownTitles.add(i.title.toLowerCase());
    added.push({ ...i, firstSeen: nowIso() });
  }
  st.items = [...added, ...st.items]
    .filter((i) => i.published)
    .sort((a, b) => (b.published || b.firstSeen).localeCompare(a.published || a.firstSeen))
    .slice(0, 200);
  st.errors = errors;
  const events = !st.baselined || settings.newsNotify === 'off' ? [] : added
    .filter((i) => settings.newsNotify === 'all' || i.announce)
    .map((i) => ({ type: 'news', title: i.title, url: i.url, shop: i.source, image: i.image }));
  st.baselined = true;
  st.lastScan = nowIso();
  await setJson('news', st);
  return events;
}

export async function runScan({ deadline, only } = {}) {
  const settings = await getSettings();
  const shops = SHOPS.filter((s) => (s.scan || s.api) && !settings.disabledShops.includes(s.id) && (!only || s.id === only));
  const status = {};
  const results = await pool(shops, 5, (s) => scanShop(s, settings, deadline));
  const events = [];
  for (const [i, r] of results.entries()) {
    const s = shops[i];
    if (r.ok) { events.push(...r.value); status[s.id] = { ok: true, new: r.value.length }; }
    else {
      status[s.id] = { ok: false, error: r.error.message };
      const st = await getJson(`shop/${s.id}`, { seen: {}, queue: [], baselined: false });
      await setJson(`shop/${s.id}`, { ...st, error: r.error.message, lastScan: nowIso() });
    }
  }
  if (!only) {
    try { events.push(...(await scanNews(settings))); status.news = { ok: true }; }
    catch (e) { status.news = { ok: false, error: e.message }; }
    try {
      const ann = await scanOfficial({ deadline });
      // oficiální ohlášení se hlásí jako novinka, pokud novinky nejsou vypnuté
      events.push(...ann.map((e) => (settings.newsNotify === 'off' ? { ...e, silent: true } : e)));
      status.official = { ok: true };
    } catch (e) { status.official = { ok: false, error: e.message }; }
  }
  // do přehledu jde všechno, filtr (klíčová slova, vypnuté typy) se týká jen notifikací
  const stamped = events.map((e) => ({ id: evId(), time: nowIso(), ...e }));
  await pushFeed('scan', stamped);
  const n = await notify(stamped.filter((e) => !e.silent &&
    (e.type !== 'new_product' || (settings.notifyNewProducts && matchesKeywords(e.title, settings)))));
  await setJson('run/scan', { at: nowIso(), status, events: stamped.length, notifyErrors: n.errors });
  return { status, events: stamped.length, notifyErrors: n.errors };
}
