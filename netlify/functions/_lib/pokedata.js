// Edice (sety) a ceny karet z PokeData (pokedata.io). Veřejné JSON endpointy jejich webu,
// robots.txt nic nezakazuje — přesto voláme šetrně: každý set max. jednou za ~24 h.
// pokemontcg.io nepoužíváme: pro sety Mega Evolution nemá ceny vůbec a Cardmarket tam stojí od 11/2025.
import { fetchJson, fetchText, pool } from './http.js';
import { getJson, setJson } from './store.js';
import { getPortfolio, recordPrices } from './portfolio.js';

const BASE = 'https://www.pokedata.io/api';
const HEADERS = { Referer: 'https://www.pokedata.io/' };

// PokeData `stats[].source`: 0 = cena raw karty (to ukazuje jejich web), 9 = PSA 9, 10 = PSA 10,
// 11 a 12 = dílčí tržní zdroje. Bereme 0, ohodnocené jen jako doplněk.
const RAW = 0, PSA9 = 9, PSA10 = 10;

const YEARS_BACK = 8;
const SKIP_SET = /promo|mcdonald|trick or trade|half deck|starter|trainer kit/i;
const LANGS = ['ENGLISH', 'JAPANESE'];
const SETS_PER_RUN = 6; // PokeData vrací 429 zhruba po 120 požadavcích za minutu
const MAX_AGE_H = 24;

const stat = (c, src) => c.stats?.find((s) => s.source === src)?.avg ?? null;

// denní kurz ČNB (Kč za 1 USD / 1 EUR), cache na 12 h
async function cnbRate(code, fallback) {
  const key = `fx/${code.toLowerCase()}`;
  const cached = await getJson(key);
  if (cached && Date.now() - new Date(cached.at) < 12 * 3600e3) return cached.rate;
  try {
    const { text } = await fetchText('https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt');
    // řádek „USA|dolar|1|USD|20,895“: kurz je poslední sloupec
    const line = text.split('\n').find((l) => l.includes(`|${code}|`));
    const rate = line ? parseFloat(line.trim().split('|').pop().replace(',', '.')) : null;
    if (rate) { await setJson(key, { rate, at: new Date().toISOString() }); return rate; }
  } catch {}
  return cached?.rate || fallback;
}
export const usdCzk = () => cnbRate('USD', 22);
export const eurCzk = () => cnbRate('EUR', 25);

async function fetchSetList() {
  const all = await fetchJson(`${BASE}/sets`, { headers: HEADERS, timeoutMs: 20000 });
  const minYear = new Date().getFullYear() - YEARS_BACK;
  return all
    .filter((s) => s.tcg === 'Pokemon' && s.live && LANGS.includes(s.language) && !SKIP_SET.test(s.name))
    .map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code || null,
      language: s.language === 'JAPANESE' ? 'JP' : 'EN',
      series: s.series || null,
      releaseDate: s.release_date ? new Date(s.release_date).toISOString().slice(0, 10) : null,
      logo: s.img_url || null,
      symbol: s.symbol_img_url || null,
      banner: s.banner_img_url || null,
    }))
    .filter((s) => s.releaseDate && Number(s.releaseDate.slice(0, 4)) >= minYear)
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
}

// Verze výpočtu — při změně se uložené sety postupně načtou znovu.
// v3: všechny karty edice (s id) kvůli sbírce, produkty s id.
const PARSE_VERSION = 3;

// Do srovnání cen patří jen standardní produkty. Kartony, displeje, půlboxy, sady a exkluzivity
// řetězců (Costco, Sam's Club, Pokemon Center…) mají jiný obsah i cenu.
const NOT_STANDARD = /case|display|half|set of|\d-pack|surprise|costco|sam'?s|walmart|target|dollar general|exclusive|pokemon center|\(|art bundle/;
const productKind = (p) => {
  const n = p.name.toLowerCase();
  if (NOT_STANDARD.test(n)) return null;
  if (p.type === 'BOOSTERBOX' && /booster box$/.test(n)) return 'box';
  if (p.type === 'ELITETRAINERBOX' && /elite trainer box$/.test(n)) return 'etb';
  if (p.type === 'COLLECTIONBOX' && /booster bundle$/.test(n)) return 'bundle';
  if (p.type === 'BOOSTERPACK' && /booster pack$/.test(n)) return 'pack';
  return null;
};

async function fetchSetDetail(set) {
  const q = encodeURIComponent(set.name).replace(/%20/g, '+');
  const [rawCards, products] = await Promise.all([
    fetchJson(`${BASE}/cards?set_name=${q}&tcg=&stats=kwan`, { headers: HEADERS, timeoutMs: 20000 }),
    fetchJson(`${BASE}/products?set_id=${set.id}`, { headers: HEADERS, timeoutMs: 20000 }).catch(() => []),
  ]);
  const own = rawCards.filter((c) => c.set_id === set.id); // jména setů se napříč jazyky můžou opakovat
  const cards = own
    .map((c) => ({
      id: c.id,
      name: c.name.replace(/\s+(Holofoil|Normal)$/i, ''),
      num: c.num,
      img: c.img_url,
      raw: stat(c, RAW),
      psa9: stat(c, PSA9),
      psa10: stat(c, PSA10),
      secret: !!c.secret,
    }))
    .sort((a, b) => String(a.num).localeCompare(String(b.num), 'en', { numeric: true }));
  const priced = cards.filter((c) => c.raw != null);
  priced.sort((a, b) => b.raw - a.raw);
  const sum = (arr) => Math.round(arr.reduce((s, c) => s + c.raw, 0) * 100) / 100;

  const prods = (products || []).map((p) => ({ id: p.id, name: p.name, type: p.type, img: p.img_url, usd: p.market_value ?? null, kind: productKind(p) }));
  const kindPrice = (k) => prods.filter((p) => p.kind === k && p.usd).sort((a, b) => a.usd - b.usd)[0]?.usd ?? null;

  return {
    ...set,
    v: PARSE_VERSION,
    fetchedAt: new Date().toISOString(),
    cardCount: own.length,
    pricedCount: priced.length,
    setValue: sum(priced),
    top10: sum(priced.slice(0, 10)),
    top: priced.slice(0, 30),
    cards,
    products: prods.filter((p) => p.usd).sort((a, b) => (b.kind ? 1 : 0) - (a.kind ? 1 : 0) || b.usd - a.usd),
    boxUsd: kindPrice('box'),
    etbUsd: kindPrice('etb'),
    bundleUsd: kindPrice('bundle'),
    packUsd: kindPrice('pack'),
  };
}

const summarize = (d) => ({
  id: d.id, v: d.v, name: d.name, code: d.code, language: d.language, series: d.series, releaseDate: d.releaseDate,
  logo: d.logo, symbol: d.symbol, fetchedAt: d.fetchedAt || null,
  cardCount: d.cardCount ?? null, setValue: d.setValue ?? null, top10: d.top10 ?? null,
  chase: d.top?.[0] ? { id: d.top[0].id ?? null, num: d.top[0].num ?? null, name: d.top[0].name, raw: d.top[0].raw, psa10: d.top[0].psa10, img: d.top[0].img } : null,
  topImgs: (d.top || []).slice(0, 3).map((c) => c.img),
  boxUsd: d.boxUsd ?? null, etbUsd: d.etbUsd ?? null, bundleUsd: d.bundleUsd ?? null, packUsd: d.packUsd ?? null,
});

const BASE_FIELDS = ['id', 'name', 'code', 'language', 'series', 'releaseDate', 'logo', 'symbol', 'banner'];

// Detail edice pro sbírku: když je uložený ve staré verzi (bez všech karet), načte ho hned.
export async function loadSetDetail(id) {
  const cur = await getJson(`set/${id}`);
  if (cur?.v === PARSE_VERSION || cur?.game === 'cyberpunk') return cur; // Cyberpunk edice obnovuje cron-cyberpunk
  const idx = await getJson('sets/summary', { sets: [] });
  const s = idx.sets.find((x) => x.id === id);
  if (!s) return null;
  const d = await fetchSetDetail(Object.fromEntries(BASE_FIELDS.map((k) => [k, s[k] ?? null])));
  await setJson(`set/${id}`, d);
  return d;
}

export async function runSets({ deadline }) {
  const idx = await getJson('sets/summary', { sets: [], listAt: null });
  // seznam setů obnovujeme jednou denně
  if (!idx.listAt || Date.now() - new Date(idx.listAt) > 24 * 3600e3 || !idx.sets.length) {
    const list = await fetchSetList();
    const known = new Map(idx.sets.map((s) => [s.id, s]));
    idx.sets = list.map((s) => ({ ...(known.get(s.id) || {}), ...s }));
    idx.listAt = new Date().toISOString();
  }
  // nejdřív edice ze sbírky (kvůli denní historii cen), pak nikdy nenačtené (od nejnovějších), pak nejstarší data
  const { items: owned } = await getPortfolio();
  const mine = new Set(owned.map((i) => i.setId));
  const stale = idx.sets
    .filter((s) => !s.fetchedAt || s.v !== PARSE_VERSION || Date.now() - new Date(s.fetchedAt) > MAX_AGE_H * 3600e3)
    .sort((a, b) => (mine.has(b.id) ? 1 : 0) - (mine.has(a.id) ? 1 : 0) || (a.fetchedAt ? 1 : 0) - (b.fetchedAt ? 1 : 0) || (a.fetchedAt || '').localeCompare(b.fetchedAt || '') || b.releaseDate.localeCompare(a.releaseDate))
    .slice(0, SETS_PER_RUN);
  let done = 0;
  let limited = false;
  const errors = [];
  await pool(stale, 2, async (s) => {
    if (Date.now() > deadline || limited) return;
    try {
      const d = await fetchSetDetail(s);
      await setJson(`set/${s.id}`, d);
      await recordPrices(d, owned);
      Object.assign(s, summarize(d));
      done++;
    } catch (e) {
      if (/HTTP 429/.test(e.message)) limited = true; // rate limit → zbytek až příští běh
      errors.push(`${s.name}: ${e.message}`);
    }
  });
  idx.usdCzk = await usdCzk();
  idx.at = new Date().toISOString();
  await setJson('sets/summary', idx);
  const r = { updated: done, pending: idx.sets.filter((s) => !s.fetchedAt).length, total: idx.sets.length, errors: errors.slice(0, 5) };
  await setJson('run/sets', { at: idx.at, ...r });
  return r;
}
