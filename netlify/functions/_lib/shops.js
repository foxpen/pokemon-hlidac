// Konfigurace českých obchodů.
//   scan     — stránky kategorie, kde se hledají NOVÉ produkty (nejlépe řazené od nejnovějších)
//   productRe — které odkazy z kategorie jsou kandidáti na produkt (cesta URL)
// Obchody bez `scan` jdou jen hlídat přes watchlist (vložíš konkrétní URL produktu) —
// jejich výpis kategorií se renderuje JavaScriptem nebo blokuje roboty.
import { fetchJson } from './http.js';

export const SHOPS = [
  {
    id: 'cernyrytir',
    name: 'Černý rytíř',
    host: 'cernyrytir.cz',
    api: 'cernyrytir', // JS aplikace — čteme jejich veřejné API, viz scanCernyRytir
  },
  {
    id: 'veselydrak',
    name: 'Veselý drak',
    host: 'vesely-drak.cz',
    // předprodej je společný pro všechny hry (Magic, fotbal…) → v odkazu musí být „pokemon“
    scan: ['https://www.vesely-drak.cz/produkty/pokemon-karty/', 'https://www.vesely-drak.cz/produkty/predprodej/'],
    productRe: /^\/produkty\/[^/]+\/\d+-[^/]*pokemon[^/]*\/$/,
  },
  {
    id: 'sparkys',
    name: 'Sparkys',
    host: 'sparkys.cz',
    scan: ['https://www.sparkys.cz/sberatelske-karty-pokemon/'],
    productRe: /^\/pokemon-tcg[^/]*\/$/,
  },
  {
    id: 'tlama',
    name: 'Tlama Games',
    host: 'tlamagames.com',
    scan: ['https://www.tlamagames.com/pokemon/?order=-date', 'https://www.tlamagames.com/predprodej/'],
    productRe: /^\/[^/]+\/pokemon[^/]*\/$/,
  },
  {
    id: 'imago',
    name: 'Imago',
    host: 'imago.cz',
    scan: ['https://www.imago.cz/pokemon-karetni-hra'],
    productRe: /^\/pokemon-tcg-[^/]+$/,
  },
  {
    id: 'xzone',
    name: 'Xzone',
    host: 'xzone.cz',
    scan: ['https://www.xzone.cz/sberatelske-hry-pokemon-tcg?s=60&term=&c=725&sort=date_desc&page=1'],
    productRe: /^\/karetni-hra-pokemon[^/]*$/,
  },
  {
    id: 'svether',
    name: 'Svět her',
    host: 'svet-her.cz',
    scan: ['https://www.svet-her.cz/pokemon/'],
    productRe: /^\/[^/]+\/pokemon[^/]*$/,
  },
  {
    id: 'planetaher',
    name: 'Planeta her',
    host: 'planetaher.cz',
    scan: ['https://www.planetaher.cz/pokemon/?order=-date', 'https://www.planetaher.cz/predprodej/'],
    productRe: /^\/[^/]*pokemon[^/]*\/$/,
  },
  {
    id: 'tcgshop',
    name: 'TCGshop',
    host: 'tcgshop.cz',
    // celý obchod je Pokémon; /pokemon-karty/ jsou jen články
    scan: [
      'https://www.tcgshop.cz/booster-boxy-a-bundly/?order=-date',
      'https://www.tcgshop.cz/elite-trainer-boxy/?order=-date',
      'https://www.tcgshop.cz/specialni-sety/?order=-date',
    ],
    productRe: /^\/[a-z0-9-]*(pokemon|booster|box|tin|bundle|collection|blister|etb)[a-z0-9-]*\/$/,
  },
  // Alza a Smarty blokují automatický přístup podle TLS otisku (curl projde, Node/server ne) —
  // obcházet to nechceme, takže je jen ukazujeme jako nepodporované.
  { id: 'alza', name: 'Alza', host: 'alza.cz', blocked: true },
  { id: 'smarty', name: 'Smarty', host: 'smarty.cz', blocked: true },
  { id: 'allegro', name: 'Allegro', host: 'allegro.cz', blocked: true },
  { id: 'najada', name: 'Najáda', host: 'najada.games' },
  { id: 'dracik', name: 'Dráčik', host: 'dracik.cz' },
];

// Kategorie a stránky, které productRe sice chytí, ale nejsou to TCG produkty.
const SKIP = /blog|clanek|navod|gdpr|kategorie|vyrobce|znacka|lego|plys|figurk|burza|alba-pokemon|krabicky|podlozky|kusov|^\/(boostery[a-z-]*|booster-box[a-z-]*|elite-trainer-boxy|specialni-sety|blistery|alba|japonske-booster-boxy)\/$/i;

export function shopForUrl(url) {
  let host;
  try { host = new URL(url).hostname.replace(/^www\.|^m\./, ''); } catch { return null; }
  return SHOPS.find((s) => host === s.host || host.endsWith('.' + s.host)) || {
    id: host, name: host, host,
  };
}

export function extractProductLinks(html, pageUrl, shop) {
  const base = new URL(pageUrl);
  const out = new Map();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]{0,400}?)<\/a>/gi)) {
    let u;
    try { u = new URL(m[1], base); } catch { continue; }
    if (!u.hostname.endsWith(shop.host)) continue;
    let path;
    try { path = decodeURIComponent(u.pathname); } catch { path = u.pathname; }
    if (!shop.productRe.test(path) || SKIP.test(path)) continue;
    const clean = `${u.origin}${u.pathname}`;
    const title = m[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!out.has(clean) || (title && !out.get(clean))) out.set(clean, title);
  }
  return [...out].map(([url, title]) => ({ url, title }));
}

// Černý rytíř: SPA s veřejným API. Kategorie 458 = Pokémon (sealed), řazeno od nejnovějších.
// Vrací rovnou kompletní produkty včetně skladu, předprodeje a data vydání.
export async function scanCernyRytir(rows = 60) {
  const data = await fetchJson('https://eshop-api.cernyrytir.eu/api/public/merch/list', {
    method: 'POST',
    headers: { Origin: 'https://cernyrytir.cz', Referer: 'https://cernyrytir.cz/' },
    body: JSON.stringify({
      extendedFilter: { categoryIds: [458] },
      pagination: { page: 1, rowsPerPage: rows, rowsNumber: 0, descending: true, sortBy: 'createdAt' },
    }),
  });
  return (data.list || []).map(mapCernyRytir);
}

// Detail jednoho produktu pro watchlist (stránka /merch/detail/<uid> je SPA, HTML nemá data).
export async function fetchCernyRytir(url) {
  const uid = url.match(/merch\/detail\/([0-9a-f-]{36})/i)?.[1];
  if (!uid) throw new Error('neplatná URL Černého rytíře');
  const p = await fetchJson(`https://eshop-api.cernyrytir.eu/api/public/merch/${uid}?eshop_lang=CZ`, {
    headers: { Origin: 'https://cernyrytir.cz' },
  });
  return mapCernyRytir(p);
}

function mapCernyRytir(p) {
  const title = p.productTextList?.find((t) => t.typeTxt === 'TITLE' && t.langCode === 'CZ')?.textFull || p.metaTitle;
  const online = (p.availEshopQty || 0) + (p.virtualStockQty || 0);
  return {
    url: `https://cernyrytir.cz/merch/detail/${p.productUid}`,
    name: title,
    price: (p.priceSell || 0) - (p.discountCurr || 0), // discountCurr je sleva v Kč
    currency: 'CZK',
    // U předprodeje je availEshopQty volná alokace (na webu „PRESALE · Skladem na eshopu 3 ks“),
    // takže 0 ks = předprodej vyprodaný, ne „čeká se“.
    availability: p.presale
      ? online > 0 ? 'preorder' : 'out_of_stock'
      : online > 0 || p.availStoreQty > 0 ? 'in_stock' : 'out_of_stock',
    stockNote: `${p.presale ? 'předprodej · ' : ''}e-shop ${online} ks · prodejna ${p.availStoreQty || 0} ks`,
    releaseDate: p.releasedAt || null,
    image: p.imageUuid?.[0]
      ? `https://images.cernyrytir.eu/image/cernyrytir/v2?uid=${p.imageUuid[0]}&faceType=FRONT&imageType=MERCHANDISE&sizeType=BIG`
      : null,
    isProduct: true,
  };
}
