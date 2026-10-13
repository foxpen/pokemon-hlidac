// GET — souhrn edic (bez ?id) nebo detail jedné edice (?id=<pokedata set id>).
import { authed, json } from './_lib/auth.js';
import { getJson } from './_lib/store.js';

export default authed(async (req) => {
  const id = new URL(req.url).searchParams.get('id');
  if (id) {
    const d = await getJson(`set/${Number(id)}`);
    return d ? json(d) : json({ error: 'Edice ještě není načtená' }, 404);
  }
  const idx = await getJson('sets/summary', { sets: [] });
  return json({ sets: idx.sets, usdCzk: idx.usdCzk || null, at: idx.at || null, run: await getJson('run/sets') });
});
