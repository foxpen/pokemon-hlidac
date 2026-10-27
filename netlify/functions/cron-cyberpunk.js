// Cyberpunk TCG z Cardmarketu: kontrola každou hodinu (v :50), ceny se ale stahují jen když jsou
// starší než 6 h. Cardmarket exporty obnovuje jednou denně, takže to stačí na denní historii cen.
import { runCyberpunk } from './_lib/cyberpunk.js';

export default async () => {
  const r = await runCyberpunk();
  console.log('cron-cyberpunk', JSON.stringify(r));
};

export const config = { schedule: '50 * * * *' };
