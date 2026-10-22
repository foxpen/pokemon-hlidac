// Nové produkty v obchodech + novinky: každou hodinu.
import { runScan } from './_lib/jobs.js';

export default async () => {
  const r = await runScan({ deadline: Date.now() + 22000 });
  console.log('cron-scan', JSON.stringify(r));
};

export const config = { schedule: '0 * * * *' };
