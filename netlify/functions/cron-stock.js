// Watchlist: každou hodinu (v :15, aby se nepotkal se skenem a edicemi). Naplánované funkce mají limit 30 s → rezerva 8 s na zápis a notifikace.
import { runStock } from './_lib/jobs.js';

export default async () => {
  const r = await runStock({ deadline: Date.now() + 22000 });
  console.log('cron-stock', JSON.stringify(r));
};

export const config = { schedule: '15 * * * *' };
