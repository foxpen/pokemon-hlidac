// Oficiální termíny vydání z galerie produktů pokemon.com (EN).
// České obchody listují produkty často až těsně před vydáním, takže „co se chystá“
// bez tohohle zdroje nevíme (např. listopadová vlna 30th Celebration).
import { fetchText, pool } from './http.js';
import { cleanText, decodeEntities } from './product.js';
import { getJson, setJson } from './store.js';

const GALLERY = 'https://www.pokemon.com/us/pokemon-tcg/product-gallery';
const DETAILS_PER_RUN = 8;
const GALLERY_EVERY_H = 6;
// pokemon.com má ochranu proti robotům (stránka „Pardon Our Interruption“) — neobcházíme ji,
// jen se jí vyhýbáme malým počtem požadavků a při zásahu běh přeskočíme.
const isChallenge = (html) => /Pardon Our Interruption/i.test(html);
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

// „Launch: November 06, 2026“ → 2026-11-06 (bez Date, ať nehraje roli časové pásmo)
function parseLaunch(html) {
  const m = html.match(/Launch:\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (!m || !MONTHS[m[1].toLowerCase()]) return null;
  return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

async function fetchProduct(slug) {
  const url = `${GALLERY}/${slug}`;
  const { text } = await fetchText(url);
  if (isChallenge(text)) throw new Error('challenge');
  const meta = (p) => decodeEntities(text.match(new RegExp(`property="${p}" content="([^"]*)"`))?.[1] || '');
  const h1 = cleanText(text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] || '');
  return {
    slug,
    url,
    name: (h1 || meta('og:title')).replace(/^Pokémon TCG:\s*/, ''),
    date: parseLaunch(text),
    image: meta('og:image') || null,
  };
}

// Vrací události „announced“ pro nově objevené produkty (po prvním naplnění).
export async function scanOfficial({ deadline }) {
  const st = await getJson('official', { items: {}, slugs: [], baselined: false });
  // seznam z galerie obnovujeme jen jednou za pár hodin, mezitím dočítáme detaily z uloženého seznamu
  if (!st.galleryAt || Date.now() - new Date(st.galleryAt) > GALLERY_EVERY_H * 3600e3) {
    const { text } = await fetchText(GALLERY);
    if (isChallenge(text)) return []; // ochrana proti robotům → zkusíme příště
    const slugs = [...new Set([...text.matchAll(/\/us\/pokemon-tcg\/product-gallery\/([a-z0-9-]+)/g)].map((m) => m[1]))];
    if (!slugs.length) throw new Error('galerie pokemon.com nevrátila žádné produkty (změnil se web?)');
    st.slugs = slugs;
    st.galleryAt = new Date().toISOString();
  }
  const slugs = st.slugs;
  const todo = slugs.filter((s) => !st.items[s]).slice(0, DETAILS_PER_RUN);
  const events = [];
  let blocked = false;
  await pool(todo, 1, async (slug) => {
    if (Date.now() > deadline || blocked) return;
    let p;
    try { p = await fetchProduct(slug); } catch (e) { if (e.message === 'challenge') { blocked = true; return; } throw e; }
    st.items[slug] = { ...p, firstSeen: new Date().toISOString() };
    if (st.baselined && p.date && p.date >= new Date().toISOString().slice(0, 10)) {
      events.push({ type: 'announced', title: p.name, url: p.url, image: p.image, shop: 'Pokémon (oficiálně)', releaseDate: p.date });
    }
  });
  // baseline až když jsou načtené všechny produkty z galerie
  if (slugs.length && slugs.every((s) => st.items[s])) st.baselined = true;
  st.at = new Date().toISOString();
  await setJson('official', st);
  return events;
}

export async function getOfficial() {
  const st = await getJson('official', { items: {} });
  return Object.values(st.items).filter((i) => i.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 80);
}
