// GET — stav přihlášení {authed, user, setup}; POST {action: setup|login|logout}.
// setup jde jen jednou, když ještě neexistuje žádný účet (pak se další přidávají v Nastavení).
import { endpoint, json } from './_lib/http-response.js';
import {
  sessionUser, sessionCookie, clearCookie, listUsers, getUser, saveUser, checkPassword,
  normName, validName, validPassword, lockedMinutes, noteFail, clearFails,
} from './_lib/auth.js';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const BAD = 'Špatné jméno nebo heslo';

export default endpoint(async (req) => {
  if (req.method === 'GET') {
    const user = await sessionUser(req);
    return json({ authed: !!user, user, setup: !user && !(await listUsers()).length });
  }

  const body = await req.json().catch(() => ({}));
  const name = normName(body.user);

  if (body.action === 'logout') return json({ ok: true }, 200, { 'Set-Cookie': clearCookie });

  if (body.action === 'setup') {
    if ((await listUsers()).length) return json({ error: 'Účet už existuje, přihlas se' }, 409);
    if (!validName(name)) return json({ error: 'Jméno musí mít 3–32 znaků: písmena bez diakritiky, čísla, tečka, pomlčka nebo podtržítko' }, 400);
    if (!validPassword(body.password)) return json({ error: 'Heslo musí mít aspoň 8 znaků' }, 400);
    const user = await saveUser(name, body.password);
    return json({ ok: true, user: name }, 200, { 'Set-Cookie': await sessionCookie(user, body.remember !== false) });
  }

  if (body.action === 'login') {
    if (!validName(name)) { await pause(600); return json({ error: BAD }, 401); }
    const lock = await lockedMinutes(name);
    if (lock) return json({ error: `Moc pokusů. Zkus to znovu za ${lock} min.` }, 429);
    const user = await getUser(name);
    if (!user || !(await checkPassword(String(body.password || ''), user.hash))) {
      await noteFail(name);
      await pause(600); // zpomalí hádání
      return json({ error: BAD }, 401);
    }
    await clearFails(name);
    return json({ ok: true, user: name }, 200, { 'Set-Cookie': await sessionCookie(user, !!body.remember) });
  }

  return json({ error: 'Neznámá akce' }, 400);
}, { open: true });
