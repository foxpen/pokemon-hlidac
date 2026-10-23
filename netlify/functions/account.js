// GET — přihlášený účet, seznam účtů a platné pozvánky; POST {action: password|add|reset|remove|invite|revoke}.
// Kdo zapomene heslo, tomu ho nastaví jiný přihlášený účet (reset).
import { endpoint, json } from './_lib/http-response.js';
import { listUsers, getUser, saveUser, removeUser, checkPassword, normName, validName, validPassword, clearFails, sessionCookie,
  createInvite, listInvites, removeInvite } from './_lib/auth.js';

const SHORT = 'Heslo musí mít aspoň 8 znaků';

export default endpoint(async (req, ctx, me) => {
  if (req.method === 'GET') return json({ user: me, users: await listUsers(), invites: await listInvites() });

  const body = await req.json().catch(() => ({}));
  const name = normName(body.user);

  if (body.action === 'password') {
    const u = await getUser(me);
    if (!(await checkPassword(String(body.old || ''), u.hash))) return json({ error: 'Současné heslo nesedí' }, 400);
    if (!validPassword(body.password)) return json({ error: SHORT }, 400);
    // nová verze hesla odhlásí ostatní zařízení; tady se rovnou vydá nová cookie, ať tohle zůstane přihlášené
    const updated = await saveUser(me, body.password, u);
    return json({ ok: true }, 200, { 'Set-Cookie': await sessionCookie(updated, true) });
  }

  if (body.action === 'add') {
    if (!validName(name)) return json({ error: 'Jméno musí mít 3–32 znaků: písmena bez diakritiky, čísla, tečka, pomlčka nebo podtržítko' }, 400);
    if (await getUser(name)) return json({ error: 'Účet s tímhle jménem už existuje' }, 409);
    if (!validPassword(body.password)) return json({ error: SHORT }, 400);
    await saveUser(name, body.password);
    return json({ ok: true, users: await listUsers() });
  }

  if (body.action === 'reset') {
    const u = await getUser(name);
    if (!u) return json({ error: 'Účet nenalezen' }, 404);
    if (!validPassword(body.password)) return json({ error: SHORT }, 400);
    await saveUser(name, body.password, u);
    await clearFails(name);
    return json({ ok: true });
  }

  if (body.action === 'remove') {
    if (name === me) return json({ error: 'Účet, ve kterém jsi přihlášený, smazat nejde' }, 400);
    if (!(await getUser(name))) return json({ error: 'Účet nenalezen' }, 404);
    await removeUser(name);
    return json({ ok: true, users: await listUsers() });
  }

  if (body.action === 'invite') {
    const invite = await createInvite(me);
    return json({ ok: true, invite, invites: await listInvites() });
  }

  if (body.action === 'revoke') {
    await removeInvite(body.code);
    return json({ ok: true, invites: await listInvites() });
  }

  return json({ error: 'Neznámá akce' }, 400);
});
