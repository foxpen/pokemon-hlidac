// Vytáhne z produktové stránky název, cenu a dostupnost.
// Pořadí zdrojů: JSON-LD → microdata → og/product meta → úpravy pro konkrétní obchod.
// Většina CZ e-shopů (Shoptet, Imago, xzone, Smarty, Alza) má schema.org Product,
// takže obecný parser pokryje i obchody, které tu nejsou vyjmenované.

export const AVAIL = {
  in_stock: 'Skladem',
  preorder: 'Předprodej',
  out_of_stock: 'Nedostupné',
  unknown: 'Neznámo',
};

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s = '') {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z0-9#]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

export function cleanText(s = '') {
  return decodeEntities(String(s).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

export function parsePrice(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = decodeEntities(String(v)).replace(/\s| /g, '').replace(/Kč|CZK|,-/gi, '');
  // "1199.00", "1199,00", "1.199,00"
  const norm = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = parseFloat(norm);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function normAvailability(v) {
  if (!v) return 'unknown';
  const s = String(v).toLowerCase();
  if (/preorder|presale|předprodej|predprodej|předobjedn|predobjedn/.test(s)) return 'preorder';
  if (/outofstock|soldout|discontinued|nedostupn|vyprodán|vyprodan|není skladem|neni skladem/.test(s)) return 'out_of_stock';
  if (/backorder/.test(s)) return 'out_of_stock';
  if (/instock|limitedavailability|instoreonly|onlineonly|skladem|instock/.test(s)) return 'in_stock';
  return 'unknown';
}

function* walkJsonLd(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) yield* walkJsonLd(n);
    return;
  }
  yield node;
  if (node['@graph']) yield* walkJsonLd(node['@graph']);
  if (node.hasVariant) yield* walkJsonLd(node.hasVariant);
}

function isType(node, type) {
  const t = node['@type'];
  return Array.isArray(t) ? t.includes(type) : t === type;
}

function fromJsonLd(html) {
  const blocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, raw] of blocks) {
    let data;
    try {
      data = JSON.parse(raw.trim());
    } catch {
      // některé obchody mají v JSON-LD neescapované nové řádky
      try { data = JSON.parse(raw.trim().replace(/[\r\n\t]+/g, ' ')); } catch { continue; }
    }
    for (const node of walkJsonLd(data)) {
      if (!isType(node, 'Product')) continue;
      let offers = node.offers;
      if (Array.isArray(offers)) offers = offers[0];
      if (offers && isType(offers, 'AggregateOffer') && offers.offers) {
        offers = Array.isArray(offers.offers) ? offers.offers[0] : offers.offers;
      }
      const price = parsePrice(offers?.price ?? offers?.lowPrice ?? node.offers?.lowPrice);
      const image = Array.isArray(node.image) ? node.image[0] : node.image?.url || node.image;
      return {
        name: node.name ? cleanText(node.name) : null,
        price,
        currency: offers?.priceCurrency || 'CZK',
        availability: normAvailability(offers?.availability),
        image: typeof image === 'string' ? image : null,
      };
    }
  }
  return null;
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1] : null;
}

function fromMicrodata(html) {
  const priceTag = html.match(/<[^>]*itemprop=["']price["'][^>]*>/i)?.[0];
  const availTag = html.match(/<[^>]*itemprop=["']availability["'][^>]*>/i)?.[0];
  if (!priceTag && !availTag) return null;
  let price = priceTag ? parsePrice(attr(priceTag, 'content')) : null;
  if (price == null && priceTag) {
    const after = html.slice(html.indexOf(priceTag) + priceTag.length, html.indexOf(priceTag) + priceTag.length + 80);
    price = parsePrice(after.split('<')[0]);
  }
  // itemprop="name" záměrně ne — na Shoptetu je první výskyt v drobečkové navigaci („Domů“).
  return {
    name: null,
    price,
    currency: 'CZK',
    availability: normAvailability(availTag && (attr(availTag, 'href') || attr(availTag, 'content'))),
    image: null,
  };
}

function meta(html, prop) {
  const re = new RegExp(`<meta[^>]*(?:property|name)=["']${prop}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag ? decodeEntities(attr(tag, 'content') || '') : null;
}

function fromMeta(html) {
  return {
    name: cleanText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '') || meta(html, 'og:title') || null,
    price: parsePrice(meta(html, 'product:price:amount')),
    currency: meta(html, 'product:price:currency') || 'CZK',
    availability: normAvailability(meta(html, 'product:availability')),
    image: meta(html, 'og:image'),
  };
}

// Obchody bez strukturovaných dat (nebo s nespolehlivými)
const SITE_FIXES = [
  {
    host: /vesely-drak\.cz$/,
    fix(html, p) {
      const info = html.match(/class="quick-info-list"[\s\S]*?<\/p>/i)?.[0] || '';
      const text = cleanText(info);
      if (/předprodej|predprodej|předobjedn/i.test(text)) p.availability = 'preorder';
      else if (/Skladem:\s*[>\d]/i.test(text) || /Dostupnost:\s*ihned/i.test(text)) p.availability = 'in_stock';
      else if (/Dostupnost:/i.test(text)) p.availability = normAvailability(text) === 'unknown' ? 'out_of_stock' : normAvailability(text);
      const price = html.match(/class="price-num">([^<]+)/i)?.[1];
      if (price) p.price = parsePrice(price);
      const h1 = html.match(/<h1 class="product-name">([^<]+)/i)?.[1];
      if (h1) p.name = cleanText(h1);
    },
  },
  {
    // Sparkys nemá schema.org dostupnost; stav je v dataLayeru detailu: "availability":"acs: není skladem;store.0;web.0"
    host: /sparkys\.cz$/,
    fix(html, p) {
      const acs = html.match(/"availability":"acs:\s*([^;"]*)/i)?.[1];
      if (acs) p.availability = normAvailability(acs) === 'unknown' ? 'in_stock' : normAvailability(acs);
    },
  },
  {
    // Alza dává do JSON-LD "Discontinued" i u dočasně vyprodaného zboží; viditelný štítek je přesnější.
    host: /alza\.(cz|sk)$/,
    fix(html, p) {
      const lbl = html.match(/class="stcStock avlVal[^"]*"[^>]*title="([^"]*)"/i)?.[1];
      if (!lbl) return;
      if (/předprodej|předobjedn/i.test(lbl)) p.availability = 'preorder';
      else if (/skladem/i.test(lbl)) p.availability = 'in_stock';
      else p.availability = 'out_of_stock';
    },
  },
];

export function parseProduct(html, url) {
  const parts = [fromJsonLd(html), fromMicrodata(html), fromMeta(html)].filter(Boolean);
  const p = { name: null, price: null, currency: 'CZK', availability: 'unknown', image: null };
  // Za produkt považujeme jen stránku se strukturovaným Product/availability — stránka kategorie
  // má taky ceny (og/microdata prvního výpisu), ale nemá schema.org dostupnost.
  let structured = parts.some((x) => x !== parts.at(-1) && x.availability !== 'unknown') ||
    !!meta(html, 'product:availability') || /"@type"\s*:\s*"Product"/.test(html);
  for (const part of parts) {
    for (const k of Object.keys(p)) {
      const empty = (v) => v == null || v === '' || v === 'unknown';
      if (empty(p[k]) && !empty(part[k])) p[k] = part[k];
    }
  }
  let host = '';
  try { host = new URL(url).hostname; } catch {}
  for (const f of SITE_FIXES) {
    if (!f.host.test(host)) continue;
    f.fix(html, p);
    structured = structured || p.availability !== 'unknown';
  }

  // Předprodej často není ve schema.org, jen v názvu nebo štítku produktu.
  if (p.availability !== 'out_of_stock' && /předprodej|predprodej|pre-?order|předobjednávk/i.test(p.name || '')) {
    p.availability = 'preorder';
  }
  if (p.name) p.name = p.name.replace(/\s+\|\s+[^|]{1,30}$/, ''); // „… | Sparkys“
  p.isProduct = p.price != null && structured;
  return p;
}
