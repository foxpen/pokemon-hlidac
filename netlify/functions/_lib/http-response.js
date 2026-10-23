// Společné pro HTTP endpointy dashboardu: JSON odpověď, chyby jako JSON a přihlášení.
// Bez platné cookie vrací 401 ({auth: false}), web pak ukáže přihlašovací obrazovku.
import { sessionUser } from './auth.js';

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

// open: true = endpoint bez přihlášení (jen samotné přihlašování)
export function endpoint(handler, { open = false } = {}) {
  return async (req, ctx) => {
    try {
      const user = open ? null : await sessionUser(req);
      if (!open && !user) return json({ error: 'Nejsi přihlášený', auth: false }, 401);
      return await handler(req, ctx, user);
    } catch (e) {
      console.error(e);
      return json({ error: e.message || String(e) }, 500);
    }
  };
}
