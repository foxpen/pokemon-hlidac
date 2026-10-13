import { SHOPS, extractProductLinks, scanCernyRytir } from '../netlify/functions/_lib/shops.js';
import { fetchText } from '../netlify/functions/_lib/http.js';
import { parseProduct } from '../netlify/functions/_lib/product.js';
const only = process.argv[2];
for (const s of SHOPS) {
  if (only && s.id !== only) continue;
  try {
    if (s.api === 'cernyrytir') { const l = await scanCernyRytir(10); console.log(`${s.id}: ${l.length}`); l.slice(0,4).forEach(p=>console.log('   ',p.availability,p.price,p.releaseDate,p.name)); continue; }
    if (!s.scan) continue;
    const { text } = await fetchText(s.scan[0]);
    const links = extractProductLinks(text, s.scan[0], s);
    console.log(`${s.id}: ${links.length} odkazů`);
    for (const l of links.slice(0, 2)) { const { text: d } = await fetchText(l.url); const p = parseProduct(d, l.url); console.log('   ', p.isProduct?'P':'-', p.availability, p.price, (p.name||'').slice(0,55), '|', l.url.slice(0,70)); }
    console.log('    ...', links.slice(2,6).map(l=>l.url.replace(/^https?:\/\/[^/]+/,'')).join('  '));
  } catch (e) { console.log(s.id, 'ERR', e.message); }
}
