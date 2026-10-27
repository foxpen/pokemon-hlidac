// GET ?p=<id tisku karty> — obrázek karty Cyberpunk TCG z oficiálního webu.
// Odkazy tam platí jen pár minut, takže je web nemůže mít přímo; obrázek se stáhne jednou
// a dál ho drží cache prohlížeče i CDN Netlify (obrázek k danému id se nemění).
// Bez přihlášení: jde o veřejné obrázky a vrací jen id, která jsou v seznamu karet (žádná otevřená proxy).
import { endpoint, json } from './_lib/http-response.js';
import { signedImg } from './_lib/cyberpunk.js';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default endpoint(async (req) => {
  const id = new URL(req.url).searchParams.get('p') || '';
  if (!ID.test(id)) return json({ error: 'Neplatné id' }, 400);
  const url = await signedImg(id);
  if (!url) return json({ error: 'Obrázek nenalezen' }, 404);
  const res = await fetch(url);
  if (!res.ok) return json({ error: `Obrázek nejde načíst (HTTP ${res.status})` }, 502);
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) return json({ error: 'Nečekaný typ souboru' }, 502);
  return new Response(await res.arrayBuffer(), {
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Netlify-CDN-Cache-Control': 'public, durable, max-age=31536000, immutable',
    },
  });
}, { open: true });
