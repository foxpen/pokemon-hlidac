// Cyberpunk TCG: ceny z Cardmarketu, karty a obrázky z oficiálního webu cyberpunktcg.com.
//   Cardmarket — oficiální denní exporty (hra 23): katalog karet, zapečetěných produktů a price guide, ceny v EUR.
//   cyberpunktcg.com — seznam karet čte z veřejného API api.netdeck.gg; odtud čísla karet, rarity a obrázky.
// Uloženo stejně jako edice z PokeData (set/<id>, souhrn cp/summary), aby fungovala sbírka i historie cen.
// Ceny jsou v EUR (`cur`), pole se jmenují jako u Pokémonů (`raw`, `usd`), aby šel použít stejný kód.
import { fetchJson } from './http.js';
import { getJson, setJson } from './store.js';
import { getPortfolio, recordPrices } from './portfolio.js';
import { eurCzk } from './pokedata.js';

const CM = 'https://downloads.s3.cardmarket.com/productCatalog';
const ND = 'https://api.netdeck.gg/api/cards/cyberpunk';

// Id edic a karet = id z Cardmarketu posunuté o miliardu, aby se nepotkala s PokeData.
export const CP = 1e9;
export const isCp = (id) => Number(id) >= CP;

const PARSE_VERSION = 1;
const MAX_AGE_H = 6; // Cardmarket exporty obnovuje jednou denně (kolem 3:00)

// Edice z Cardmarketu → název a sada karet na oficiálním webu (kvůli obrázkům a číslům karet).
// Neznámá edice dostane název ze zapečetěných produktů a obrázky z kterékoli sady.
const EXPANSIONS = {
  6714: ['Welcome to Night City – Beta', 'welcometonightcitybeta'],
  6715: ['The Heist – Beta Starter Deck', 'theheistbetastarterdeck'],
  6716: ['Embracing Power – Beta Starter Deck', 'embracingpowerbetastarterdeck'],
  6717: ['Box Toppers – Beta', 'boxtoppersbeta'],
  6718: ['Pre-Release – Beta', 'prereleasebeta'],
  6719: ['Promo karty', 'PRM01'],
  6720: ['The Heist – Demo Deck', 'mercdemodeck'],
  6721: ['Embracing Power – Demo Deck', 'arasakademodeck'],
  6722: ['Alpha Kit', null],
  6761: ['Welcome to Night City – Retail', 'welcometonightcityretail'],
  6762: ['The Heist – Retail Starter Deck', 'theheistretailstarterdeck'],
  6763: ['Embracing Power – Retail Starter Deck', 'embracingpowerretailstarterdeck'],
};

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Cena z price guide: trend, když chybí (0 = žádné prodeje), tak průměry, nakonec nejnižší nabídka.
const pick = (g, sfx = '') => {
  for (const k of ['trend', 'avg7', 'avg30', 'avg', 'low']) { const v = g?.[k + sfx]; if (v > 0) return v; }
  return null;
};

const productKind = (name) => {
  const n = name.toLowerCase();
  if (/case|\bset$|kit/.test(n)) return null;
  if (/booster box$/.test(n)) return 'box';
  if (/booster$/.test(n)) return 'pack';
  if (/starter deck$|demo deck$/.test(n)) return 'deck';
  return null;
};

async function fetchCards() {
  const items = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const d = await fetchJson(`${ND}?limit=100&offset=${offset}`, { timeoutMs: 20000 });
    items.push(...(d.items || []));
    if (!d.items?.length || items.length >= d.total) break;
  }
  return items;
}

// Podepsané odkazy na obrázky platí jen pár minut, proto je web dostává přes /cp-img (id tisku karty).
export const imgUrl = (printingId) => (printingId ? `/.netlify/functions/cp-img?p=${printingId}` : null);

// Obrázky k produktům Cardmarketu: v rámci edice podle jména, víc stejných (alt arty) podle pořadí —
// Cardmarket je zakládá ve stejném pořadí jako sběratelská čísla.
function printingIndex(cards) {
  const bySet = new Map(), any = new Map();
  for (const c of cards) {
    const key = norm(c.display_name || c.name);
    for (const p of c.printings || []) {
      if (p.language && p.language !== 'en') continue;
      const r = { id: p.id, num: p.collector_number || null, rarity: p.rarity || null };
      const k = `${p.set?.code}|${key}`;
      if (!bySet.has(k)) bySet.set(k, []);
      bySet.get(k).push(r);
      if (!any.has(key)) any.set(key, r);
    }
  }
  for (const arr of bySet.values()) arr.sort((a, b) => String(a.num).localeCompare(String(b.num), 'en', { numeric: true }));
  return { bySet, any };
}

function buildSet(exp, singles, sealed, guide, idx, now) {
  const [name0, ndSet] = EXPANSIONS[exp] || [];
  const name = name0 || (sealed[0]?.name || singles[0]?.name || `Edice ${exp}`).replace(/\s+(6 )?(booster box case|booster box|booster|starter deck|demo deck)$/i, '');
  const seen = new Map();
  const cards = [...singles].sort((a, b) => a.idProduct - b.idProduct).map((x) => {
    const key = norm(x.name);
    const n = seen.get(key) || 0;
    seen.set(key, n + 1);
    const list = idx.bySet.get(`${ndSet}|${key}`) || [];
    const p = list[Math.min(n, list.length - 1)] || idx.any.get(key) || null;
    const g = guide.get(x.idProduct);
    return { id: CP + x.idProduct, name: x.name, num: list.length ? p.num : null, rarity: p?.rarity || null, img: imgUrl(p?.id), raw: pick(g), foil: pick(g, '-foil') };
  }).sort((a, b) => String(a.num ?? '~').localeCompare(String(b.num ?? '~'), 'en', { numeric: true }) || a.name.localeCompare(b.name));
  // cena karty = normální, foil jen u karet, které se normální neprodávají (stejně jako ji ukazuje web)
  const best = (c) => c.raw ?? c.foil ?? 0;
  const priced = cards.filter((c) => best(c) > 0).sort((a, b) => best(b) - best(a));
  const sum = (arr) => Math.round(arr.reduce((s, c) => s + best(c), 0) * 100) / 100;
  const products = sealed.map((x) => ({ id: CP + x.idProduct, name: x.name, type: x.categoryName, img: null, usd: pick(guide.get(x.idProduct)), kind: productKind(x.name) }))
    .filter((p) => p.usd).sort((a, b) => (b.kind ? 1 : 0) - (a.kind ? 1 : 0) || b.usd - a.usd);
  const kindPrice = (k) => products.filter((p) => p.kind === k).sort((a, b) => a.usd - b.usd)[0]?.usd ?? null;
  const added = [...singles, ...sealed].map((x) => x.dateAdded).filter(Boolean).sort()[0];
  return {
    id: CP + Number(exp), game: 'cyberpunk', cur: 'EUR', v: PARSE_VERSION, fetchedAt: now,
    name, code: null, language: 'EN', series: null, logo: null, symbol: null, banner: null,
    releaseDate: added ? added.slice(0, 10) : null, // na Cardmarketu od
    cardCount: cards.length, pricedCount: priced.length, setValue: sum(priced), top10: sum(priced.slice(0, 10)),
    top: priced.slice(0, 30), cards, products,
    boxUsd: kindPrice('box'), packUsd: kindPrice('pack'), deckUsd: kindPrice('deck'),
  };
}

const summarize = (d) => ({
  id: d.id, game: d.game, cur: d.cur, v: d.v, name: d.name, language: d.language, releaseDate: d.releaseDate, fetchedAt: d.fetchedAt,
  cardCount: d.cardCount, setValue: d.setValue, top10: d.top10,
  chase: d.top[0] ? { id: d.top[0].id, num: d.top[0].num, name: d.top[0].name, raw: d.top[0].raw, foil: d.top[0].foil, img: d.top[0].img } : null,
  boxUsd: d.boxUsd, packUsd: d.packUsd, deckUsd: d.deckUsd,
});

export async function runCyberpunk({ force = false } = {}) {
  const idx0 = await getJson('cp/summary');
  if (!force && idx0?.at && Date.now() - new Date(idx0.at) < MAX_AGE_H * 3600e3) return { skipped: true, at: idx0.at };
  const [singles, sealed, guide, cards] = await Promise.all([
    fetchJson(`${CM}/productList/products_singles_23.json`, { timeoutMs: 20000 }),
    fetchJson(`${CM}/productList/products_nonsingles_23.json`, { timeoutMs: 20000 }),
    fetchJson(`${CM}/priceGuide/price_guide_23.json`, { timeoutMs: 20000 }),
    fetchCards().catch(() => []), // bez oficiálního webu jen nebudou obrázky a čísla karet
  ]);
  const g = new Map((guide.priceGuides || []).map((x) => [x.idProduct, x]));
  const exps = new Map();
  const add = (x, k) => { if (!exps.has(x.idExpansion)) exps.set(x.idExpansion, { singles: [], sealed: [] }); exps.get(x.idExpansion)[k].push(x); };
  for (const x of singles.products || []) add(x, 'singles');
  for (const x of sealed.products || []) add(x, 'sealed');

  const now = new Date().toISOString();
  const pidx = printingIndex(cards);
  const { items: owned } = await getPortfolio();
  const sets = [];
  for (const [exp, { singles: s, sealed: p }] of exps) {
    const d = buildSet(exp, s, p, g, pidx, now);
    await setJson(`set/${d.id}`, d);
    await recordPrices(d, owned);
    sets.push(summarize(d));
  }
  sets.sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''));
  const idx = { sets, at: now, priceGuideAt: guide.createdAt || null, eurCzk: await eurCzk(), images: cards.length > 0 };
  await setJson('cp/summary', idx);
  // obrázky: pro /cp-img rovnou uložit čerstvé podepsané odkazy
  if (cards.length) await saveImgUrls(cards);
  return { sets: sets.length, cards: cards.length, at: now };
}

// ---- obrázky karet ----
// Oficiální web podepisuje odkazy na obrázky jen na pár minut. Ukládáme si mapu id tisku → odkaz
// a obnovujeme ji, když je starší než 3 minuty (stačí 2 požadavky na celý seznam karet).
const IMG_TTL = 3 * 60e3;

async function saveImgUrls(cards) {
  const map = {};
  for (const c of cards) for (const p of c.printings || []) if (p.image_url) map[p.id] = p.image_url;
  const v = { at: Date.now(), map };
  await setJson('cp/img', v);
  return v;
}

export async function signedImg(printingId) {
  let v = await getJson('cp/img');
  if (!v || Date.now() - v.at > IMG_TTL || !(printingId in v.map)) {
    // neznámé id obnoví seznam nejvýš jednou za minutu (ochrana před zbytečnými požadavky)
    if (!v || Date.now() - v.at > 60e3) v = await saveImgUrls(await fetchCards());
  }
  return v.map[printingId] || null;
}
