// Edice a ceny karet z PokeData: každou hodinu (v :30) dočte 6 setů. To je 144 denně, takže se celý
// seznam (~165) obnoví zhruba za 28 h; edice ze sbírky mají přednost, jejich ceny se ukládají denně.
import { runSets } from './_lib/pokedata.js';

export default async () => {
  const r = await runSets({ deadline: Date.now() + 22000 });
  console.log('cron-sets', JSON.stringify(r));
};

export const config = { schedule: '30 * * * *' };
