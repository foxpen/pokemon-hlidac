// Úložiště: Netlify Blobs (bez databáze, nic se nenastavuje).
// Rozložení klíčů je zvolené tak, aby si uživatel a cron nepřepisovali data:
//   watch/<id>      — jedna hlídaná položka = jeden klíč (přidání z webu se nepotká s cronem)
//   shop/<shopId>   — katalog viděných produktů obchodu (píše jen cron-scan)
//   news            — novinky (píše jen cron-scan)
//   feed/stock, feed/scan — události z jednotlivých cronů, na čtení se slijí
//   releases, settings — píše jen uživatel
import { getStore } from '@netlify/blobs';

const store = () => getStore({ name: 'pokemon-hlidac', consistency: 'strong' });

export async function getJson(key, fallback = null) {
  const v = await store().get(key, { type: 'json' });
  return v ?? fallback;
}

export async function setJson(key, value) {
  await store().setJSON(key, value);
}

export async function del(key) {
  await store().delete(key);
}

export async function listJson(prefix) {
  const { blobs } = await store().list({ prefix });
  const values = await Promise.all(blobs.map((b) => store().get(b.key, { type: 'json' })));
  return values.filter(Boolean);
}

const FEED_MAX = 200;

export async function pushFeed(which, events) {
  if (!events.length) return;
  const key = `feed/${which}`;
  const cur = await getJson(key, []);
  await setJson(key, [...events, ...cur].slice(0, FEED_MAX));
}

export const DEFAULT_SETTINGS = {
  newsNotify: 'announce', // 'all' | 'announce' | 'off'
  notifyNewProducts: true,
  notifyRestock: true,
  notifyPriceDrop: true,
  keywords: [], // když není prázdné, nové produkty se hlásí jen při shodě (např. „booster box“, „etb“)
  disabledShops: [],
};

export async function getSettings() {
  return { ...DEFAULT_SETTINGS, ...(await getJson('settings', {})) };
}
