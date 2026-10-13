// POST {job: stock|scan, shop?} — ruční spuštění kontroly z dashboardu.
// Běžná funkce má na Netlify limit 10 s, proto kratší deadline; zbytek dodělá cron.
import { authed, json } from './_lib/auth.js';
import { runStock, runScan } from './_lib/jobs.js';
import { notify } from './_lib/notify.js';
import { runSets } from './_lib/pokedata.js';

export default authed(async (req) => {
  const { job, shop } = await req.json().catch(() => ({}));
  const deadline = Date.now() + 7000;
  if (job === 'stock') return json(await runStock({ deadline }));
  if (job === 'scan') return json(await runScan({ deadline, only: shop }));
  if (job === 'sets') return json(await runSets({ deadline }));
  if (job === 'test') {
    const r = await notify([{ type: 'test', title: 'Pokémon hlídač je napojený 👍', url: new URL(req.url).origin }]);
    return json(r);
  }
  return json({ error: 'Neznámá úloha' }, 400);
});
