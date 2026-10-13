// Stahování stránek s hlavičkami běžného prohlížeče. Alza a Smarty vrací 403,
// když chybí Accept / Accept-Language — samotný User-Agent nestačí.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

export async function fetchText(url, { timeoutMs = 12000, headers = {}, method = 'GET', body } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      body,
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'cs-CZ,cs;q=0.9,en;q=0.6',
        ...headers,
      },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { text, finalUrl: res.url };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`timeout po ${timeoutMs / 1000} s`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson(url, opts = {}) {
  const { text } = await fetchText(url, {
    ...opts,
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  return JSON.parse(text);
}

// Spustí úlohy s omezeným paralelismem, ať e-shopy nezahltíme.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = { ok: true, value: await fn(items[idx], idx) };
      } catch (e) {
        out[idx] = { ok: false, error: e };
      }
    }
  });
  await Promise.all(workers);
  return out;
}
