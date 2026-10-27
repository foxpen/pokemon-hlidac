// Novinky ze světa Pokémon TCG.
// PokeBeach nejde: RSS má vypnuté a web je za Cloudflare challenge (Node fetch dostane 403).
// Zdroje proto: PokeGuardian (ohlášení produktů a setů), Google News EN a Google News CZ (český trh).
import { fetchText } from './http.js';
import { cleanText, decodeEntities } from './product.js';

// Co považujeme za ohlášení produktu / setu (pro notifikace v režimu „jen ohlášení“).
export const ANNOUNCE_RE =
  /reveal|announc|new set|expansion|pre-?order|elite trainer|booster|collection|\btin\b|bundle|set list|first look|release date|předprodej|nová edice|nový set|vydání|ohlás/i;

async function pokeGuardian() {
  const { text } = await fetchText('https://www.pokeguardian.com/');
  const items = [];
  for (const m of text.matchAll(/<article class="jw-news-post[\s\S]*?<\/article>/g)) {
    const b = m[0];
    const a = b.match(/<h2 class="jw-news-post__title">\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    const id = a[1].match(/\/(\d+)_/)?.[1] || a[1];
    const date = b.match(/class="jw-news-date">([^<]+)/)?.[1];
    // připnuté stálé články (seznamy karet starších setů) nemají datum — nejsou to novinky
    if (!date || Number.isNaN(Date.parse(date))) continue;
    items.push({
      id: `pg-${id}`,
      source: 'PokeGuardian',
      title: cleanText(a[2]),
      url: new URL(a[1], 'https://www.pokeguardian.com/').toString(),
      image: b.match(/background-image:\s*url\(([^)]+)\)/)?.[1] || null,
      published: new Date(date).toISOString(),
      excerpt: cleanText(b.match(/jw-news-post__lead[^>]*>([\s\S]*?)<\/div>/)?.[1] || '').slice(0, 220),
    });
  }
  return items;
}

async function googleNews(query, lang, label) {
  const ceid = lang === 'cs' ? 'CZ:cs' : 'US:en';
  const gl = lang === 'cs' ? 'CZ' : 'US';
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=${lang}&gl=${gl}&ceid=${ceid}`;
  const { text } = await fetchText(url, { headers: { Accept: 'application/rss+xml, application/xml' } });
  return [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 30).map(([, b]) => {
    const get = (t) => decodeEntities(b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`))?.[1] || '').trim();
    const source = get('source');
    // Google přidává „ - Zdroj“ na konec titulku
    const title = get('title').replace(new RegExp(`\\s+-\\s+${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), '');
    return {
      id: `gn-${get('guid') || get('link')}`,
      source: source ? `${source} (${label})` : label,
      title,
      url: get('link'),
      image: null,
      published: get('pubDate') ? new Date(get('pubDate')).toISOString() : null,
      lang,
    };
  });
}

export const NEWS_SOURCES = [
  { id: 'pokeguardian', fn: pokeGuardian },
  { id: 'gnews-en', fn: () => googleNews('"Pokémon TCG" when:7d', 'en', 'Google News') },
  { id: 'gnews-cz', fn: () => googleNews('pokémon karty when:14d', 'cs', 'CZ') },
  // Cyberpunk TCG (nová hra, zpráv je málo → delší okno)
  { id: 'gnews-cp', game: 'cyberpunk', fn: () => googleNews('"Cyberpunk TCG" OR "Cyberpunk trading card game" when:30d', 'en', 'Google News') },
];

export async function fetchAllNews() {
  const results = await Promise.allSettled(NEWS_SOURCES.map((s) => s.fn()));
  const items = [];
  const errors = {};
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') items.push(...r.value.map((it) => ({ ...it, game: NEWS_SOURCES[i].game || 'pokemon' })));
    else errors[NEWS_SOURCES[i].id] = r.reason?.message || String(r.reason);
  });
  for (const it of items) it.announce = ANNOUNCE_RE.test(it.title) || it.lang === 'cs';
  if (!items.length) throw new Error(`žádný zdroj novinek neodpověděl: ${JSON.stringify(errors)}`);
  return { items, errors };
}
