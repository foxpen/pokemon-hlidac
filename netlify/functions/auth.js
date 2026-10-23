// GET — stav přihlášení {authed, user, setup}; POST {action: setup|register|login|logout}.
// setup = první účet, jde jen dokud žádný neexistuje. register = další účty, jen s kódem pozvánky z Nastavení.
import { endpoint, json } from './_lib/http-response.js';
import {
  sessionUser, sessionCookie, clearCookie, listUsers, getUser, saveUser, checkPassword,
  normName, validName, validPassword, lockedMinutes, noteFail, clearFails, getInvite, removeInvite,
} from './_lib/auth.js';

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const BAD = 'Špatné jméno nebo heslo';
const BAD_NAME = 'Jméno musí mít 3–32 znaků: písmena bez diakritiky, čísla, tečka, pomlčka nebo podtržítko';

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
    if (!validName(name)) return json({ error: BAD_NAME }, 400);
    if (!validPassword(body.password)) return json({ error: 'Heslo musí mít aspoň 8 znaků' }, 400);
    const user = await saveUser(name, body.password);
    return json({ ok: true, user: name }, 200, { 'Set-Cookie': await sessionCookie(user, body.remember !== false) });
  }

  if (body.action === 'register') {
    const invite = await getInvite(body.code);
    if (!invite) { await pause(600); return json({ error: 'Neplatný nebo prošlý kód pozvánky' }, 400); }
    if (!validName(name)) return json({ error: BAD_NAME }, 400);
    if (await getUser(name)) return json({ error: 'Tohle jméno už má jiný trenér' }, 409);
    if (!validPassword(body.password)) return json({ error: 'Heslo musí mít aspoň 8 znaků' }, 400);
    const user = await saveUser(name, body.password);
    await removeInvite(invite.code); // pozvánka je jednorázová
    return json({ ok: true, user: name }, 200, { 'Set-Cookie': await sessionCookie(user, !!body.remember) });
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
