// Edice a ceny karet z PokeData: každých 20 minut dočte 6 setů (každý set se obnoví ~1× denně).
import { runSets } from './_lib/pokedata.js';

export default async () => {
  const r = await runSets({ deadline: Date.now() + 22000 });
  console.log('cron-sets', JSON.stringify(r));
};

export const config = { schedule: '5,25,45 * * * *' };
