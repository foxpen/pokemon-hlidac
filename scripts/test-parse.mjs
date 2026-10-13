import { readFileSync } from 'node:fs';
import { parseProduct } from '../netlify/functions/_lib/product.js';
const dir = process.argv[2];
const cases = {
  'p_imago.html':'https://www.imago.cz/x','p_tcgshop.html':'https://www.tcgshop.cz/x','p_xzone.html':'https://www.xzone.cz/x',
  'p_drak.html':'https://www.vesely-drak.cz/x','smp.html':'https://www.smarty.cz/x','al1.html':'https://www.alza.cz/x',
  'd_sparkys.html':'https://www.sparkys.cz/x','d_svether.html':'https://www.svet-her.cz/x','d_tlama.html':'https://www.tlamagames.com/x',
  'd_planeta.html':'https://www.planetaher.cz/x','d_xzone.html':'https://www.xzone.cz/x'};
for (const [f,u] of Object.entries(cases)) {
  try { const p = parseProduct(readFileSync(dir+'/'+f,'utf8'), u); console.log(f.padEnd(16), p.availability.padEnd(12), String(p.price).padEnd(7), (p.name||'').slice(0,60)); }
  catch(e){ console.log(f, 'ERR', e.message); }
}
