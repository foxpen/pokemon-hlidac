// GET — souhrn edic (bez ?id) nebo detail jedné edice (?id=<pokedata set id>).
import { endpoint, json } from './_lib/http-response.js';
import { getJson } from './_lib/store.js';
import { loadSetDetail } from './_lib/pokedata.js';

export default endpoint(async (req) => {
  const id = new URL(req.url).searchParams.get('id');
  if (id) {
    // starší uložená verze nemá u karet id (nešly by přidat do sbírky) → načíst novou hned;
    // když PokeData zrovna neodpoví, vrátit aspoň uloženou
    const d = (await loadSetDetail(Number(id)).catch(() => null)) || (await getJson(`set/${Number(id)}`));
    return d ? json(d) : json({ error: 'Edice ještě není načtená' }, 404);
  }
  const idx = await getJson('sets/summary', { sets: [] });
  return json({ sets: idx.sets, usdCzk: idx.usdCzk || null, at: idx.at || null, run: await getJson('run/sets') });
});
