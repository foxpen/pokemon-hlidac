// Společné pro HTTP endpointy dashboardu: JSON odpověď a chyby jako JSON.
// Web je bez přihlášení (adresu zná jen uživatel, stránka má noindex).
export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

export function endpoint(handler) {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (e) {
      console.error(e);
      return json({ error: e.message || String(e) }, 500);
    }
  };
}
