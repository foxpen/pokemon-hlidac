// GET — všechno pro dashboard jedním dotazem (data jsou malá, stovky položek).
import { endpoint, json } from './_lib/http-response.js';
import { getJson, listJson, getSettings } from './_lib/store.js';
import { SHOPS } from './_lib/shops.js';
import { configured } from './_lib/notify.js';

export default endpoint(async () => {
  const [watch, settings, feedStock, feedScan, news, releases, runStock, runScan, ...shopStates] = await Promise.all([
    listJson('watch/'),
    getSettings(),
    getJson('feed/stock', []),
    getJson('feed/scan', []),
    getJson('news', { items: [] }),
    getJson('releases', []),
    getJson('run/stock'),
    getJson('run/scan'),
    ...SHOPS.map((s) => getJson(`shop/${s.id}`)),
  ]);

  const shops = [];
  const catalog = [];
  SHOPS.forEach((s, i) => {
    const st = shopStates[i];
    const items = st ? Object.values(st.seen).filter((x) => x.isProduct) : [];
    shops.push({
      id: s.id, name: s.name, host: s.host,
      scans: !!(s.scan || s.api),
      blocked: !!s.blocked,
      lastScan: st?.lastScan || null,
      error: st?.error || null,
      products: items.length,
      queued: st?.queue?.length || 0,
    });
    for (const x of items) {
      catalog.push({
        url: x.url, name: x.name, price: x.price, availability: x.availability,
        image: x.image, releaseDate: x.releaseDate || null, stockNote: x.stockNote || null,
        soldOutAt: x.soldOutAt || null, restockedAt: x.restockedAt || null,
        firstSeen: x.firstSeen, checkedAt: x.checkedAt, shop: s.name, shopId: s.id,
      });
    }
  });

  const feed = [...feedStock, ...feedScan].sort((a, b) => b.time.localeCompare(a.time)).slice(0, 200);

  return json({
    watch: watch.sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || '')),
    catalog,
    shops,
    feed,
    news: news.items.slice(0, 80),
    newsLastScan: news.lastScan || null,
    releases,
    settings,
    channels: configured(),
    runs: { stock: runStock, scan: runScan },
  });
});
