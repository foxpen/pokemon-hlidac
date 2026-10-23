// Pokémon Hlídka — dashboard. Bez build kroku, data přes /.netlify/functions/*.
const API = '/.netlify/functions';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const AVAIL = { in_stock: 'Skladem', preorder: 'Předprodej', out_of_stock: 'Nedostupné', unknown: 'Neznámo' };
const EV = { new_product: 'Nový produkt', restock: 'Zpět skladem', preorder: 'Předprodej', price_drop: 'Zlevnění', sold_out: 'Vyprodáno', news: 'Novinka', announced: 'Ohlášeno' };
const BUYABLE = new Set(['in_stock', 'preorder']);
const DAY = 86400e3;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

let S = null; // poslední stav ze serveru
let AUTHED = false; // po vypršení přihlášení (401) se stránka načte znovu a ukáže přihlášení

// ---------- utils ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? esc(u) : '#');
const price = (p) => (p == null ? '—' : `${Math.round(p).toLocaleString('cs-CZ')} Kč`);
const badge = (a) => `<span class="badge b-${esc(a || 'unknown')}">${AVAIL[a] || AVAIL.unknown}</span>`;
const img = (src, cls = 'thumb', alt = '') =>
  src ? `<img class="${cls}" src="${safeUrl(src)}" alt="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'${cls} thumb-empty',textContent:'◓'}))">`
      : `<div class="${cls} thumb-empty">◓</div>`;
const ext = (url, html, cls = '') => `<a ${cls ? `class="${cls}"` : ''} href="${safeUrl(url)}" target="_blank" rel="noopener">${html}</a>`;

function ago(iso) {
  if (!iso) return 'nikdy';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'teď';
  if (s < 3600) return `před ${Math.floor(s / 60)} min`;
  if (s < 86400) return `před ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 7) return `před ${Math.floor(s / 86400)} d`;
  return new Date(iso).toLocaleDateString('cs-CZ');
}
const fmtDate = (d) => new Date(d).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' });
const fmtDay = (d) => new Date(d).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
const today = () => new Date().toISOString().slice(0, 10);
const recent = (iso, days) => iso && Date.now() - new Date(iso) < days * DAY;

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (err ? ' err' : '');
  t.hidden = false;
  if (window.gsap && !REDUCED) gsap.fromTo(t, { y: 12, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.35, ease: 'power3.out' });
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 4500);
}

async function api(name, body) {
  const res = await fetch(`${API}/${name}`, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && data.auth === false && AUTHED) { AUTHED = false; location.reload(); }
  if (!res.ok) throw new Error(data.error || `Server odpověděl chybou ${res.status}`);
  return data;
}

async function busy(btn, fn) {
  btn.disabled = true;
  try { return await fn(); } catch (e) { toast(e.message, true); } finally { btn.disabled = false; }
}

// Dvoukrokové potvrzení místo confirm(): první klik „natáhne“ tlačítko, druhý do 3 s provede akci.
function armed(btn, label) {
  if (btn.classList.contains('armed')) return true;
  const orig = btn.textContent;
  btn.classList.add('armed');
  btn.textContent = label;
  setTimeout(() => { btn.classList.remove('armed'); btn.textContent = orig; }, 3000);
  return false;
}

// ---------- animace (GSAP, jen když je k dispozici a uživatel nechce omezený pohyb) ----------
const motion = () => window.gsap && !REDUCED;

function animateIn(els, opts = {}) {
  const list = [...els].filter(Boolean);
  if (!motion() || !list.length) return;
  gsap.fromTo(list, { y: opts.y ?? 14, autoAlpha: 0 }, {
    y: 0, autoAlpha: 1, duration: opts.duration ?? 0.55, ease: 'power3.out',
    stagger: opts.stagger ?? 0.045, delay: opts.delay ?? 0, clearProps: 'transform,opacity,visibility',
  });
}

function countUp(el, to) {
  const from = Number(el.dataset.v || 0);
  el.dataset.v = to;
  if (!motion() || from === to) { el.textContent = to; return; }
  const o = { v: from };
  gsap.to(o, { v: to, duration: 0.9, ease: 'power2.out', onUpdate: () => (el.textContent = Math.round(o.v)) });
}

// ---------- seskupení stejného produktu napříč obchody ----------
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const STOP = new Set(['pokemon', 'tcg', 'karetni', 'hra', 'the', 'and', 'a', 'karty', 'card', 'game', 'sberatelske', 'mega', 'evolution', 'scarlet', 'violet', 'sv', 'me']);
const ALIAS = { etb: ['elite', 'trainer', 'box'] };
function tokens(name) {
  const out = new Set();
  for (const w of norm(name).replace(/[^a-z0-9]+/g, ' ').split(' ')) {
    if (!w || STOP.has(w) || /^(sv|me)\d+$/.test(w)) continue;
    (ALIAS[w] || [w]).forEach((x) => out.add(x));
  }
  return out;
}
const jaccard = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return i / (a.size + b.size - i || 1); };

function groupCatalog(items) {
  const groups = [];
  for (const it of items) {
    const t = tokens(it.name);
    let best = null, score = 0;
    for (const g of groups) { const s = jaccard(t, g.tokens); if (s > score) { score = s; best = g; } }
    if (best && score >= 0.7) best.items.push(it);
    else groups.push({ tokens: t, items: [it] });
  }
  for (const g of groups) {
    const avail = g.items.filter((i) => BUYABLE.has(i.availability) && i.price);
    g.cheapest = avail.sort((a, b) => a.price - b.price)[0] || null;
    g.name = (g.cheapest || g.items[0]).name;
    g.image = g.items.find((i) => i.image)?.image;
    g.total = g.items.length;
    g.out = g.items.filter((i) => i.availability === 'out_of_stock').length;
    g.soldOutAt = g.items.map((i) => i.soldOutAt).filter(Boolean).sort().at(-1) || null;
    g.freshAt = g.items.filter((i) => BUYABLE.has(i.availability)).map((i) => i.restockedAt || i.firstSeen).filter(Boolean).sort().at(-1) || null;
    g.restocked = g.items.some((i) => recent(i.restockedAt, 3));
    g.preorder = g.items.some((i) => i.availability === 'preorder');
  }
  return groups;
}

// ---------- adresy (historie prohlížeče) ----------
// Každá sekce i otevřená edice má vlastní adresu (#/edice, #/edice/567, #/profil…),
// takže funguje Zpět a Vpřed v prohlížeči i odkaz přímo na stránku.
const SLUG = { overview: 'prehled', watch: 'hlidam', profile: 'profil', market: 'trh', sets: 'edice', calendar: 'kalendar', news: 'novinky', settings: 'nastaveni' };
const VIEW_OF = Object.fromEntries(Object.entries(SLUG).map(([v, slug]) => [slug, v]));
function parseHash() {
  const [slug, id] = location.hash.replace(/^#\/?/, '').split('/');
  return { v: VIEW_OF[slug] || null, setId: Number(id) || null };
}
function pushRoute(hash, replace = false) {
  if (location.hash === hash) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', hash);
}
addEventListener('popstate', () => {
  const { v, setId } = parseHash();
  if (!v && location.hash) return; // jiná kotva (třeba „Přeskočit na obsah“)
  const view = v || 'overview';
  if (view === 'sets' && setId) { openSet(setId, { push: false }); return; }
  setView(view, { push: false });
  if (view === 'sets') closeSetDetail();
  window.scrollTo({ top: 0 });
});

// ---------- views ----------
const shownViews = new Set();
const SHEET_VIEWS = new Set(['calendar', 'news', 'settings']); // na mobilu pod „Více“
function setView(v, { push = true } = {}) {
  if (push) pushRoute(`#/${SLUG[v]}`);
  $$('.nav-btn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $('#me').classList.toggle('active', v === 'profile');
  $('#more-btn').classList.toggle('active', SHEET_VIEWS.has(v));
  toggleSheet(false);
  $$('.content > section').forEach((s) => (s.hidden = s.dataset.view !== v));
  try { localStorage.setItem('ph_view', v); } catch {}
  if (v === 'sets' && !SETS.data && S) loadSets().then(() => animateIn($$('#set-grid .set-tile').slice(0, 16), { stagger: 0.03 })).catch((e) => toast(e.message, true));
  if (v === 'profile') PF.data ? renderPfChart() : loadPortfolio().catch((e) => toast(e.message, true));
  if (v === 'settings' && AUTHED) loadAccount().catch((e) => toast(e.message, true));
  if (S && !shownViews.has(v)) {
    shownViews.add(v);
    const sec = $(`.content > section[data-view="${v}"]`);
    animateIn(sec.querySelectorAll('.hero, .pf-hero, .stat, .ov-grid > .panel, :scope > .panel, :scope > .hint, .table-wrap, .tcard, .news-card, .grid-2 > *'), { stagger: 0.035 });
  }
}
const toTop = () => window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });
document.addEventListener('click', (e) => {
  const nav = e.target.closest('.nav-btn[data-view], #me, [data-go]');
  if (!nav) return;
  const v = nav.dataset.view || nav.dataset.go;
  setView(v);
  if (v === 'sets') closeSetDetail(); // „Edice“ v menu = seznam edic
  toTop();
});

// mobil: „Více“ otevře list s Kalendářem, Novinkami a Nastavením
function toggleSheet(open) {
  $('#more-sheet').hidden = !open;
  $('#more-btn').setAttribute('aria-expanded', String(open));
}
$('#more-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleSheet($('#more-sheet').hidden); });
document.addEventListener('click', (e) => { if (!e.target.closest('#more-sheet, #more-btn')) toggleSheet(false); });

async function load() {
  S = await api('state');
  S.groups = groupCatalog(S.catalog);
  render();
  if (PF.data) loadPortfolio().catch(() => {});
}

function render() {
  renderOverview();
  renderWatch();
  renderMarketFilters();
  renderMarket();
  renderCalendar();
  renderNews();
  renderSettings();
}

// ---------- přehled ----------
function upcomingItems() {
  // automaticky: produkty s datem vydání (Černý rytíř) a ručně zadané termíny
  const from = new Date(Date.now() - 14 * DAY).toISOString().slice(0, 10);
  const auto = S.catalog.filter((c) => c.releaseDate && c.releaseDate >= from)
    .map((c) => ({ date: c.releaseDate, name: c.name, url: c.url, meta: `${c.shop} · ${price(c.price)}`, availability: c.availability }));
  const manual = S.releases.map((r) => ({ id: r.id, date: r.date, name: r.name, url: r.url, meta: [r.region, r.note].filter(Boolean).join(' · '), manual: true }));
  // oficiální termíny z pokemon.com (EN vydání, v EU obvykle stejný den)
  const official = (S.official || []).map((o) => ({ date: o.date, name: o.name, url: o.url, image: o.image, meta: 'oficiálně · pokemon.com', official: true }));
  return [...official, ...auto, ...manual].filter((x) => x.date >= from).sort((a, b) => a.date.localeCompare(b.date));
}

const seenFeed = new Set();

function renderOverview() {
  const lastScan = S.runs.scan?.at;
  const scanning = S.shops.filter((s) => s.products).length;
  $('#ov-sub').textContent = `${S.catalog.length} produktů z ${scanning} obchodů · poslední sken ${ago(lastScan)}`;

  // statistiky
  const dayAgo = Date.now() - DAY;
  const stats = [
    { v: S.watch.length, l: `hlídaných · ${S.watch.filter((w) => w.availability === 'in_stock').length} skladem`, e: 'var(--accent)' },
    { v: S.groups.filter((g) => g.preorder).length, l: 'v předprodeji', e: 'var(--water)' },
    { v: S.feed.filter((f) => f.type === 'new_product' && new Date(f.time) > dayAgo).length, l: 'nových produktů za 24 h', e: 'var(--lightning)' },
    { v: S.catalog.filter((c) => recent(c.soldOutAt, 7)).length, l: 'vyprodáno za 7 dní', e: 'var(--fire)' },
  ];
  const box = $('#stats');
  if (!box.querySelector('b')) box.innerHTML = stats.map(() => `<div class="stat"><b data-v="0">0</b><span></span></div>`).join('');
  $$('.stat', box).forEach((el, i) => {
    el.style.setProperty('--energy', stats[i].e);
    el.querySelector('span').textContent = stats[i].l;
    countUp(el.querySelector('b'), stats[i].v);
  });

  renderOvNews();
  renderUpcoming();
  renderHot();
  renderSelling();
  renderChase();
  renderFeed();
  renderOvWatch();
}

function renderOvNews() {
  const items = S.news.slice(0, 30);
  const lead = items.slice(0, 15).find((n) => n.image) || items[0];
  const rest = items.filter((n) => n !== lead).slice(0, 3);
  if (!lead) { $('#ov-news').innerHTML = `<p class="empty">Novinky se načtou při prvním skenu.</p>`; return; }
  const src = (n) => `${n.lang === 'cs' ? 'CZ · ' : ''}${esc(n.source)} · ${ago(n.published || n.firstSeen)}`;
  $('#ov-news').innerHTML = `
    ${ext(lead.url, `${lead.image ? img(lead.image, '', lead.title) : ''}<b>${esc(lead.title)}</b><span class="meta">${src(lead)}</span>`, 'lead')}
    ${rest.map((n) => ext(n.url, `${n.image ? img(n.image, '') : ''}<div><b>${esc(n.title)}</b><span class="meta">${src(n)}</span></div>`, n.image ? 'small' : 'small noimg')).join('')}`;
}

function renderUpcoming() {
  const up = upcomingItems().filter((x) => x.date >= today()).slice(0, 5);
  $('#upcoming').innerHTML = up.length ? up.map((x) => `
    <li>${ext(x.url, esc(x.name))}<span class="meta mono">${fmtDay(x.date)}</span></li>`).join('')
    : `<li class="empty">Žádný ohlášený termín. Přidej ho v Kalendáři.</li>`;

  const pre = S.groups.filter((g) => g.preorder).sort((a, b) => (b.freshAt || '').localeCompare(a.freshAt || '')).slice(0, 5);
  $('#preorders').innerHTML = pre.length ? pre.map((g) => {
    const p = g.items.find((i) => i.availability === 'preorder');
    return `<li>${ext(p.url, esc(g.name))}<span class="meta">${esc(p.shop)} · <span class="mono">${price(p.price)}</span></span></li>`;
  }).join('') : `<li class="empty">Teď nic v předprodeji</li>`;

  // skutečná ohlášení, ne slevové články („Best deal… on Amazon“)
  const DEAL = /deal|under \$|price|amazon|walmart|target|prime day|discount|cheap|sale|buy/i;
  const REVEAL = /reveal|announc|set list|first look|officially|unveil|coming|release date/i;
  const ann = S.news
    .filter((n) => n.lang !== 'cs' && !DEAL.test(n.title) && (n.source === 'PokeGuardian' || REVEAL.test(n.title)) && recent(n.published, 30))
    .slice(0, 4);
  $('#announced').innerHTML = ann.length ? ann.map((n) => `
    <li>${ext(n.url, esc(n.title))}<span class="meta">${ago(n.published || n.firstSeen)}</span></li>`).join('')
    : `<li class="empty">Za poslední 3 týdny nic</li>`;
}

function renderHot() {
  const hot = S.groups
    .filter((g) => (g.total >= 2 && g.out / g.total >= 0.6) || recent(g.soldOutAt, 7))
    .map((g) => ({ ...g, score: (recent(g.soldOutAt, 7) ? 2 : 0) + g.out / g.total + g.total * 0.05 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 7);
  $('#hot').innerHTML = hot.length ? hot.map((g) => {
    const any = g.cheapest;
    const bars = g.items.map((i) => `<i class="${i.availability === 'out_of_stock' ? 'out' : ''}" title="${esc(i.shop)}: ${AVAIL[i.availability]}"></i>`).join('');
    return `<li>
      ${img(g.image)}
      <div>
        ${ext((any || g.items[0]).url, esc(g.name))}
        <span class="meta">${any ? `ještě má ${esc(any.shop)} za <span class="mono">${price(any.price)}</span>` : 'nikde skladem'}${g.soldOutAt ? ` · vyprodáno ${ago(g.soldOutAt)}` : ''}</span>
        <div class="scarcity">${bars}</div>
      </div>
      <span class="heat">${g.out}/${g.total}<small>vyprodáno</small></span>
    </li>`;
  }).join('') : `<li class="empty">Zatím nic nemizí. Údaje se sbírají s každým skenem.</li>`;
}

function renderSelling() {
  const sell = S.groups
    .filter((g) => g.cheapest && g.cheapest.availability === 'in_stock')
    .sort((a, b) => (b.restocked - a.restocked) || (b.freshAt || '').localeCompare(a.freshAt || ''))
    .slice(0, 10);
  $('#selling').innerHTML = sell.length ? sell.map((g) => {
    const c = g.cheapest;
    const inShops = g.items.filter((i) => BUYABLE.has(i.availability)).length;
    return ext(c.url, `
      <div class="tile-img">${img(g.image, '', g.name)}${g.restocked ? '<span class="tile-flag">znovu skladem</span>' : ''}</div>
      <b>${esc(g.name)}</b>
      <span class="tile-price num">${price(c.price)}</span>
      <span class="tile-meta"><span class="tag t-restock"></span>${esc(c.shop)}${inShops > 1 ? ` · +${inShops - 1} další` : ''}</span>`, 'tile');
  }).join('') : `<p class="empty">Nic skladem</p>`;
}

// Nejdražší karta z každé nové anglické edice (ze souhrnu edic) — jde rovnou přidat do sbírky.
function renderChase() {
  const box = $('#chase');
  if (!SETS.data) { box.innerHTML = '<div class="sk pk-sk"></div>'.repeat(6); return; }
  const sets = SETS.data.sets
    .filter((s) => s.language === 'EN' && s.chase)
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
    .slice(0, 10);
  box.innerHTML = sets.map((s) => collectCard(s, s.chase, { sub: s.name, rate: SETS.data.usdCzk })).join('')
    || '<p class="empty">Ceny edic se ještě načítají.</p>';
  renderOwned();
}

function renderFeed() {
  const f = $('#feed-filter').value;
  const feed = S.feed.filter((e) => !f || e.type === f).slice(0, 40);
  const first = seenFeed.size === 0;
  $('#feed').innerHTML = feed.length ? feed.map((e) => `
    <li data-id="${esc(e.id)}">
      ${img(e.image)}
      <div>
        <span class="tag t-${esc(e.type)}">${EV[e.type] || esc(e.type)}</span>
        ${ext(e.url, esc(e.title), 'title')}
        <span class="meta">${[esc(e.shop), e.oldPrice != null ? `<span class="num">${price(e.oldPrice)} → ${price(e.price)}</span>` : e.price != null ? `<span class="num">${price(e.price)}</span>` : ''].filter(Boolean).join(' · ')}</span>
      </div>
      <time datetime="${esc(e.time)}">${ago(e.time)}</time>
    </li>`).join('') : `<li class="empty">Zatím nic. První sken obchodů si jen zapamatuje, co v nich je. Hlásit začne až změny.</li>`;
  // nové události (od posledního načtení) přijedou zleva
  const fresh = $$('#feed li[data-id]').filter((li) => !seenFeed.has(li.dataset.id));
  feed.forEach((e) => seenFeed.add(e.id));
  if (!first && fresh.length && motion()) gsap.from(fresh, { x: -18, autoAlpha: 0, duration: 0.5, stagger: 0.06, ease: 'power3.out', clearProps: 'all' });
}
$('#feed-filter').addEventListener('change', renderFeed);

function renderOvWatch() {
  $('#ov-watch').innerHTML = S.watch.length ? S.watch.slice(0, 8).map((w) => `
    <li>${ext(w.url, esc(w.name || w.url))}<span class="meta">${badge(w.availability)}</span></li>`).join('')
    : `<li class="empty">Nic nehlídáš. <button class="link-more" data-go="watch">Přidat produkt →</button></li>`;
}

// ---------- hlídám: trenérské karty ----------
function sparkline(hist) {
  const pts = (hist || []).filter((h) => h.price != null);
  if (pts.length < 2) return '';
  const min = Math.min(...pts.map((p) => p.price)), max = Math.max(...pts.map((p) => p.price));
  const w = 240, h = 30, span = max - min || 1;
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * w, h - 4 - ((p.price - min) / span) * (h - 8)]);
  const line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><path class="area" d="${line}L${w},${h}L0,${h}Z"/><path d="${line}"/></svg>`;
}

function watchCard(w) {
  const fresh = w.availability === 'in_stock' && recent(w.lastChange, 1);
  return `
    <article class="tcard ${fresh ? 'fresh' : ''}" data-id="${esc(w.id)}">
      <div class="tcard-frame">
        <header class="tcard-head">
          <h3>${ext(w.url, esc(w.name || w.url))}</h3>
          <span class="hp">${price(w.price)}<small>cena</small></span>
        </header>
        <div class="tcard-art">${img(w.image, '', w.name || '')}</div>
        <div class="tcard-type">
          <span class="energy b-${esc(w.availability || 'unknown')}" style="color:inherit">${AVAIL[w.availability] || AVAIL.unknown}</span>
          <span>${esc(w.shopName)}</span>
        </div>
        <div class="tcard-body">
          ${w.stockNote ? `<div class="attack"><b>Sklad</b><span>${esc(w.stockNote)}</span></div>` : ''}
          <div class="attack"><b>Cílová cena</b>${w.targetPrice ? `<span class="num">${price(w.targetPrice)}</span>` : '<span>každé zlevnění</span>'}</div>
          <div class="attack"><b>Ověřeno</b><span>${ago(w.lastChecked)}</span></div>
          ${w.lastChange ? `<div class="attack"><b>Poslední změna</b><span>${ago(w.lastChange)}</span></div>` : ''}
          ${w.error ? `<div class="attack"><span class="warn-text">⚠ ${esc(w.error)}</span></div>` : ''}
          ${sparkline(w.history)}
        </div>
        <div class="tcard-actions">
          <button class="btn" data-act="check">Zkontrolovat</button>
          <button class="btn" data-act="target">Cílová cena</button>
          <button class="btn btn-danger" data-act="remove">Odebrat</button>
        </div>
      </div>
    </article>`;
}

function renderWatch() {
  const list = $('#watch-list');
  if (!S.watch.length) {
    list.innerHTML = `<div class="empty-state"><div class="ball" aria-hidden="true"></div>
      <h3>Začni hlídat první produkt</h3>
      <p>Vlož nahoře odkaz na produkt z českého e-shopu, nebo v sekci Trh CZ klikni u produktu na „Hlídat“. Když se naskladní nebo zlevní, přijde ti zpráva.</p></div>`;
    return;
  }
  list.innerHTML = S.watch.map(watchCard).join('');
  // energie u typu karty: tečka barvy stavu (využívá .energy::before z tagů)
  $$('.tcard-type .energy', list).forEach((el) => el.classList.add('tag'));
}

// náklon a holo lesk karty podle kurzoru
// quickTo: jeden znovupoužitý tween na kartu místo nového tweenu při každém pohybu myši.
// Po odjetí myši ho přebije elastický návrat, proto se při dalším najetí založí znovu.
const tilts = new WeakMap();
function tiltTo(frame) {
  let t = tilts.get(frame);
  if (!t) {
    gsap.set(frame, { transformPerspective: 900 });
    const opts = { duration: 0.4, ease: 'power2.out', overwrite: true };
    t = { y: gsap.quickTo(frame, 'rotationY', opts), x: gsap.quickTo(frame, 'rotationX', opts) };
    tilts.set(frame, t);
  }
  return t;
}
$('#watch-list').addEventListener('pointermove', (e) => {
  const frame = e.target.closest('.tcard-frame');
  if (!frame || e.pointerType === 'touch') return;
  const r = frame.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
  const art = frame.querySelector('.tcard-art');
  art.style.setProperty('--mx', `${px * 100}%`);
  art.style.setProperty('--my', `${py * 100}%`);
  art.style.setProperty('--sx', `${px * 100}%`);
  if (!motion()) return;
  const t = tiltTo(frame);
  t.y((px - 0.5) * 10);
  t.x((0.5 - py) * 8);
});
$('#watch-list').addEventListener('pointerout', (e) => {
  const frame = e.target.closest('.tcard-frame');
  if (!frame || frame.contains(e.relatedTarget) || !motion()) return;
  tilts.delete(frame);
  gsap.to(frame, { rotationY: 0, rotationX: 0, duration: 0.7, ease: 'elastic.out(1, 0.6)', overwrite: true });
});

$('#watch-list').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const card = btn.closest('.tcard');
  const id = card.dataset.id;
  const act = btn.dataset.act;
  if (act === 'remove') {
    if (!armed(btn, 'Opravdu?')) return;
    await busy(btn, async () => {
      await api('watch', { action: 'remove', id });
      S.watch = S.watch.filter((w) => w.id !== id);
      const done = () => { renderWatch(); renderOvWatch(); renderOverview(); };
      motion() ? gsap.to(card, { scale: 0.92, autoAlpha: 0, duration: 0.3, ease: 'power2.in', onComplete: done }) : done();
    });
  } else if (act === 'target') {
    // úprava přímo v kartě místo prompt()
    const old = card.querySelector('.inline-edit');
    if (old) { old.remove(); return; }
    const cur = S.watch.find((w) => w.id === id)?.targetPrice || '';
    const form = document.createElement('form');
    form.className = 'inline-edit';
    form.innerHTML = `<input type="number" min="1" step="1" value="${esc(cur)}" placeholder="Kč (prázdné = každé zlevnění)" aria-label="Cílová cena v Kč"><button class="btn" type="submit">Uložit</button>`;
    card.querySelector('.tcard-actions').after(form);
    form.querySelector('input').focus();
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      await busy(form.querySelector('button'), async () => {
        const v = form.querySelector('input').value.trim();
        const { item } = await api('watch', { action: 'update', id, targetPrice: v || null });
        S.watch = S.watch.map((w) => (w.id === id ? item : w));
        renderWatch();
        toast(v ? `Cílová cena ${price(Number(v))}` : 'Hlásím každé zlevnění');
      });
    });
  } else if (act === 'check') {
    await busy(btn, async () => {
      const { item } = await api('watch', { action: 'check', id });
      S.watch = S.watch.map((w) => (w.id === id ? item : w));
      renderWatch(); renderOvWatch();
      toast(`${AVAIL[item.availability]} · ${price(item.price)}`);
    });
  }
});

async function addWatch(url, targetPrice, btn) {
  return busy(btn, async () => {
    const { item } = await api('watch', { action: 'add', url, targetPrice });
    S.watch.push(item);
    renderWatch(); renderOvWatch(); renderOverview(); renderMarket();
    animateIn([$(`.tcard[data-id="${item.id}"]`)], { y: 24 });
    toast(item.error ? `Přidáno, ale: ${item.error}` : `Hlídám: ${item.name} (${AVAIL[item.availability]}, ${price(item.price)})`, !!item.error);
    return item;
  });
}

$('#watch-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const ok = await addWatch(f.url.value.trim(), f.targetPrice.value || null, f.querySelector('button'));
  if (ok) f.reset();
});

// ---------- trh CZ ----------
function renderMarketFilters() {
  const sel = $('#m-shop');
  const cur = sel.value;
  const shops = [...new Set(S.catalog.map((c) => c.shop))].sort((a, b) => a.localeCompare(b, 'cs'));
  sel.innerHTML = `<option value="">Všechny obchody</option>` + shops.map((s) => `<option>${esc(s)}</option>`).join('');
  sel.value = cur;
}

function renderMarket() {
  const q = norm($('#m-search').value).split(/\s+/).filter(Boolean);
  const av = $('#m-avail').value, shop = $('#m-shop').value, sort = $('#m-sort').value;
  const watched = new Set(S.watch.map((w) => w.url));
  let rows = S.catalog.filter((c) => {
    if (shop && c.shop !== shop) return false;
    if (av === 'buy' && !BUYABLE.has(c.availability)) return false;
    if (av && av !== 'buy' && c.availability !== av) return false;
    const n = norm(c.name);
    return q.every((w) => n.includes(w) || (w === 'etb' && n.includes('elite trainer')));
  });
  rows.sort(sort === 'price' ? (a, b) => (a.price ?? 1e9) - (b.price ?? 1e9)
    : sort === 'name' ? (a, b) => (a.name || '').localeCompare(b.name || '', 'cs')
    : (a, b) => (b.firstSeen || '').localeCompare(a.firstSeen || ''));
  const minPrice = q.length ? Math.min(...rows.filter((r) => BUYABLE.has(r.availability) && r.price).map((r) => r.price)) : null;
  $('#m-count').textContent = `${rows.length} z ${S.catalog.length} produktů` + (q.length && Number.isFinite(minPrice) ? ` · nejlevněji k dostání za ${price(minPrice)}` : '');
  rows = rows.slice(0, 300);
  $('#market-table tbody').innerHTML = rows.length ? rows.map((c) => `
    <tr>
      <td>${img(c.image)}</td>
      <td class="name">${ext(c.url, esc(c.name))}
        ${c.releaseDate ? `<div class="meta">vydání ${fmtDate(c.releaseDate)}</div>` : ''}</td>
      <td>${esc(c.shop)}</td>
      <td class="num ${c.price === minPrice && BUYABLE.has(c.availability) ? 'cheapest' : ''}">${price(c.price)}</td>
      <td>${badge(c.availability)}</td>
      <td class="muted hide-sm" title="přidáno ${esc(c.firstSeen || '')}">${ago(c.checkedAt)}</td>
      <td>${watched.has(c.url) ? '<span class="muted">hlídáš</span>' : `<button class="btn btn-sm" data-watch="${esc(c.url)}">Hlídat</button>`}</td>
    </tr>`).join('') : `<tr><td colspan="7" class="empty">Nic nenalezeno. Zkus kratší dotaz, třeba jen název setu.</td></tr>`;
}
['#m-search', '#m-avail', '#m-shop', '#m-sort'].forEach((s) => $(s).addEventListener('input', renderMarket));
$('#market-table').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-watch]');
  if (b && (await addWatch(b.dataset.watch, null, b))) renderMarket();
});

// ---------- edice (sety, ceny karet z PokeData) ----------
const SETS = { data: null, lang: 'EN', open: null, loading: null };
const czk = (usd) => (usd == null || !SETS.data?.usdCzk ? null : usd * SETS.data.usdCzk);
const kc = (usd) => price(czk(usd));

// Cena jednoho balíčku: nejlevnější cesta (samotný booster, box, bundle, ETB).
function packCost(s) {
  const perBox = s.language === 'JP' ? 30 : 36;
  const opts = [s.packUsd, s.boxUsd && s.boxUsd / perBox, s.bundleUsd && s.bundleUsd / 6, s.language === 'EN' && s.etbUsd && s.etbUsd / 9].filter((v) => v > 0);
  return opts.length ? Math.min(...opts) : null;
}
// Chase index = hodnota top 10 karet / cena 36 balíčků. Orientační, nezohledňuje šanci na tah.
function chaseIndex(s) {
  const pc = packCost(s);
  return pc && s.top10 ? s.top10 / (pc * 36) : null;
}
const idxClass = (i) => (i == null ? '' : i >= 3 ? 'hi' : i >= 1.2 ? 'mid' : 'lo');
const idxEnergy = (i) => (i == null ? 'colorless' : i >= 3 ? 'grass' : i >= 1.2 ? 'lightning' : 'fire');
const fmtIdx = (i) => (i == null ? '—' : `${i.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })}×`);

async function loadSets() {
  if (SETS.loading) return SETS.loading;
  SETS.loading = api('sets').then((d) => { SETS.data = d; renderSetFilters(); renderSets(); renderChase(); }).finally(() => (SETS.loading = null));
  return SETS.loading;
}

function renderSetFilters() {
  const sel = $('#s-series');
  const cur = sel.value;
  const series = [...new Set(SETS.data.sets.filter((s) => s.language === SETS.lang).map((s) => s.series).filter(Boolean))];
  sel.innerHTML = `<option value="">Všechny série</option>` + series.map((x) => `<option>${esc(x)}</option>`).join('');
  sel.value = series.includes(cur) ? cur : '';
}

function renderSets() {
  if (!SETS.data) return;
  const q = norm($('#s-search').value);
  const series = $('#s-series').value, sort = $('#s-sort').value;
  const all = SETS.data.sets.filter((s) => s.language === SETS.lang);
  const loaded = all.filter((s) => s.fetchedAt);
  const rows = all.filter((s) => (!series || s.series === series) && (!q || norm(s.name).includes(q) || norm(s.code).includes(q)));
  const key = {
    chase: (s) => s.chase?.raw ?? -1, top10: (s) => s.top10 ?? -1, value: (s) => s.setValue ?? -1,
    index: (s) => chaseIndex(s) ?? -1, pack: (s) => -(packCost(s) ?? 1e9), new: (s) => s.releaseDate,
  }[sort];
  rows.sort((a, b) => (sort === 'new' ? key(b).localeCompare(key(a)) : key(b) - key(a)));
  $('#s-meta').textContent = `${rows.length} edic · ceny načtené u ${loaded.length} z ${all.length}` +
    (SETS.data.usdCzk ? ` · ceny z PokeData (americký trh) přepočtené kurzem ČNB ${SETS.data.usdCzk.toLocaleString('cs-CZ')} Kč/$` : '') +
    (loaded.length < all.length ? ' · zbytek se načte během dne' : '');
  $('#set-grid').innerHTML = rows.map((s) => {
    const i = chaseIndex(s), pc = packCost(s);
    return `
    <button class="set-tile ${s.fetchedAt ? '' : 'pending'}" data-set="${s.id}">
      <div class="logo-wrap">
        ${s.logo ? `<img class="logo" src="${safeUrl(s.logo)}" alt="${esc(s.name)}" loading="lazy" referrerpolicy="no-referrer">` : `<span class="logo-text">${esc(s.name)}</span>`}
        ${s.chase?.img ? `<img class="chase-img" src="${safeUrl(s.chase.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
      </div>
      <div class="body">
        <h3>${s.symbol ? `<img src="${safeUrl(s.symbol)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}${esc(s.name)}</h3>
        <span class="meta">${s.releaseDate ? fmtDate(s.releaseDate) : ''}${s.series ? ` · ${esc(s.series)}` : ''}${s.code ? ` · ${esc(s.code)}` : ''}</span>
        ${s.chase ? `<span class="chase">Nejdražší: <b>${esc(s.chase.name)}</b> <span class="num">${kc(s.chase.raw)}</span></span>` : '<span class="chase">Ceny se ještě načítají</span>'}
        <div class="kpis">
          <div class="kpi"><span>Top 10 karet</span><b>${kc(s.top10)}</b></div>
          <div class="kpi"><span>Balíček</span><b>${pc ? kc(pc) : '—'}</b></div>
          <div class="kpi"><span>Chase index</span><b class="idx ${idxClass(i)}">${fmtIdx(i)}</b></div>
        </div>
      </div>
    </button>`;
  }).join('') || `<p class="empty">Žádná edice neodpovídá filtru.</p>`;
}

$('#sets-list').addEventListener('click', (e) => {
  const seg = e.target.closest('[data-lang]');
  if (seg) {
    SETS.lang = seg.dataset.lang;
    $$('#sets-list .seg button').forEach((b) => b.classList.toggle('on', b === seg));
    renderSetFilters(); renderSets();
    animateIn($$('#set-grid .set-tile').slice(0, 16), { stagger: 0.03 });
    return;
  }
  const tile = e.target.closest('[data-set]');
  if (tile) openSet(Number(tile.dataset.set));
});
['#s-search', '#s-series', '#s-sort'].forEach((s) => $(s).addEventListener('input', renderSets));

// Nabídky stejné edice v českých obchodech (z katalogu skenovaných obchodů).
const kindOf = (name) => {
  const n = norm(name);
  if (/booster box|display|36 bal/.test(n)) return 'box';
  if (/elite trainer|\betb\b/.test(n)) return 'etb';
  if (/booster bundle/.test(n)) return 'bundle';
  if (/booster/.test(n) && !/blister|bundle|box/.test(n)) return 'pack';
  return null;
};
function czOffers(set) {
  const sn = norm(set.name).replace(/^pokemon card /, '').replace(/ japanese$/, '');
  return S.catalog.filter((c) => {
    const n = norm(c.name);
    if (!n.includes(sn) || /portfolio|album|binder|obal|sleeve|deck ?box|krabick|podlozk|playmat/.test(n)) return false;
    const jp = /japon|japan|\bjp\b/.test(n), cn = /cinsk|chinese|cina/.test(n);
    return set.language === 'JP' ? jp : !jp && !cn;
  });
}

function closeSetDetail() {
  $('#set-detail').hidden = true;
  $('#sets-list').hidden = false;
}

async function openSet(id, { push = true } = {}) {
  setView('sets', { push: false });
  if (push) pushRoute(`#/edice/${id}`);
  const box = $('#set-detail');
  $('#sets-list').hidden = true;
  box.hidden = false;
  box.innerHTML = `<div class="panel"><div class="sk sk-num"></div><div class="sk sk-line"></div><div class="sk sk-line" style="width:60%"></div></div>`;
  window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' });
  try {
    const d = await api(`sets?id=${id}`);
    SETS.open = d;
    renderSetDetail(d);
  } catch (e) {
    box.innerHTML = `<div class="panel"><button class="btn btn-sm back" data-back>← Všechny edice</button><p class="empty">${esc(e.message)}. Ceny této edice se načtou během dne.</p></div>`;
  }
}

function renderSetDetail(d) {
  const i = chaseIndex(d), pc = packCost(d), en = idxEnergy(i);
  const offers = czOffers(d);
  const czBest = (kind) => offers.filter((o) => kindOf(o.name) === kind && BUYABLE.has(o.availability) && o.price).sort((a, b) => a.price - b.price)[0];
  const sealed = d.products.filter((p) => p.kind);
  const others = d.products.filter((p) => !p.kind && !/case|display/i.test(p.name)).slice(0, 6);
  const verdict = i == null ? 'Chybí cena balíčků, index nejde spočítat.'
    : i >= 3 ? 'Set má hodně drahých karet vzhledem k ceně balíčků. Pro lovce chase karet patří k zajímavějším.'
    : i >= 1.2 ? 'Průměr. Drahé karty tu jsou, ale balíčky taky nejsou levné.'
    : 'Top karty jsou levné vzhledem k ceně balíčků. Pro „trefu“ se nevyplácí, výhodnější je koupit konkrétní kartu.';
  $('#set-detail').innerHTML = `
    <div class="set-hero" style="${d.banner ? `--banner:url('${safeUrl(d.banner)}')` : ''}">
      <div>
        <button class="btn btn-sm back" data-back>← Všechny edice</button>
        <h1>${esc(d.name)}</h1>
        <div class="meta">${d.language === 'JP' ? 'Japonská' : 'Anglická'} edice · ${fmtDate(d.releaseDate)}${d.series ? ` · ${esc(d.series)}` : ''}${d.code ? ` · ${esc(d.code)}` : ''} · ${d.cardCount} karet · ceny ${ago(d.fetchedAt)}</div>
      </div>
      ${d.logo ? `<img class="logo" src="${safeUrl(d.logo)}" alt="${esc(d.name)}" referrerpolicy="no-referrer">` : ''}
    </div>

    <div class="set-kpis">
      <div class="stat" style="--energy:var(--accent)"><b class="num">${kc(d.top[0]?.raw)}</b><span>nejdražší karta</span></div>
      <div class="stat" style="--energy:var(--accent)"><b class="num">${kc(d.top10)}</b><span>top 10 karet</span></div>
      <div class="stat" style="--energy:var(--psychic)"><b class="num">${kc(d.setValue)}</b><span>celý set (všechny karty)</span></div>
      <div class="stat" style="--energy:var(--water)"><b class="num">${pc ? kc(pc) : '—'}</b><span>nejlevnější balíček (trh USA)</span></div>
      <div class="stat" style="--energy:var(--${en})"><b class="num">${fmtIdx(i)}</b><span>chase index</span></div>
    </div>

    <div class="panel verdict" style="--energy:var(--${en})">
      <span class="big">${fmtIdx(i)}</span>
      <div>
        <p><b>${verdict}</b></p>
        <p>Chase index = hodnota 10 nejdražších karet ÷ cena 36 balíčků. Je to jen orientace. Nezohledňuje, jak často karta padá (Special Illustration Rare bývá zhruba 1 na několik boxů), takže skutečná očekávaná hodnota balíčku je výrazně nižší.</p>
      </div>
    </div>

    <div class="panel mt">
      <div class="panel-head"><h2>Nejdražší karty</h2><span class="muted">cena raw karty, pod ní PSA 10</span></div>
      <div class="card-gallery">
        ${d.top.slice(0, 24).map((c, n) => collectCard(d, c, { rank: n + 1, rate: SETS.data?.usdCzk, sub: `${c.num ? `#${esc(c.num)}` : ''}${c.psa10 ? ` · PSA 10: ${kc(c.psa10)}` : ''}` })).join('')}
      </div>
    </div>

    <div class="panel mt" id="sd-all">
      <div class="panel-head"><h2>Všechny karty edice</h2><span class="muted">${d.cardCount}</span></div>
      <p class="panel-note">Projdi celou edici a naklikej karty, které máš. Přidají se rovnou do sbírky v profilu.</p>
      <button class="btn btn-primary" data-sd-all>Zobrazit všechny karty</button>
    </div>

    <div class="grid-2 mt">
      <div class="panel">
        <div class="panel-head"><h2>Zapečetěné produkty: trh USA vs. ČR</h2></div>
        <div class="table-wrap">
          <table class="table compact prod-table">
            <thead><tr><th>Produkt</th><th class="num">Trh USA</th><th class="num">Nejlevněji v ČR</th><th class="num">Rozdíl</th><th class="num">Sbírka</th></tr></thead>
            <tbody>
              ${sealed.map((p) => {
                const cz = czBest(p.kind);
                const diff = cz && czk(p.usd) ? (cz.price / czk(p.usd) - 1) * 100 : null;
                return `<tr>
                  <td class="name">${img(p.img, 'thumb', p.name)}<span>${esc(p.name)}</span></td>
                  <td class="num">${kc(p.usd)}</td>
                  <td class="num">${cz ? `${ext(cz.url, price(cz.price))}<div class="meta">${esc(cz.shop)}</div>` : '<span class="muted">—</span>'}</td>
                  <td class="num ${diff == null ? '' : diff <= 0 ? 'diff-good' : 'diff-bad'}">${diff == null ? '' : `${diff > 0 ? '+' : ''}${Math.round(diff)} %`}</td>
                  <td class="num">${prodCollect(d, p)}</td>
                </tr>`;
              }).join('') || '<tr><td colspan="5" class="empty">PokeData pro tuhle edici nemá ceny produktů.</td></tr>'}
              ${others.map((p) => `<tr><td class="name">${img(p.img, 'thumb', p.name)}<span class="muted">${esc(p.name)}</span></td><td class="num">${kc(p.usd)}</td><td></td><td></td><td class="num">${prodCollect(d, p)}</td></tr>`).join('')}
            </tbody>
          </table>
        </div>
        <p class="hint">Ceny v USA jsou bez DPH a dopravy, takže česká cena o 20–30 % vyšší je běžná.</p>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>V českých obchodech</h2><span class="muted">${offers.length}</span></div>
        <ul class="sell-list">
          ${offers.sort((a, b) => (BUYABLE.has(b.availability) - BUYABLE.has(a.availability)) || (a.price ?? 1e9) - (b.price ?? 1e9)).slice(0, 14).map((o) => `
            <li>${img(o.image)}<div>${ext(o.url, esc(o.name))}<span class="meta">${esc(o.shop)} · ${AVAIL[o.availability]}</span></div><span class="num mono">${price(o.price)}</span></li>`).join('')
            || '<li class="empty">Skenované obchody tuhle edici zrovna nemají.</li>'}
        </ul>
      </div>
    </div>`;
  renderOwned();
  animateIn($$('#set-detail .set-hero, #set-detail .stat, #set-detail .panel, #set-detail .pcard').slice(0, 30), { stagger: 0.02 });
}

// „+ Do sbírky“ u zapečetěného produktu v tabulce edice
function prodCollect(d, p) {
  if (p.id == null) return '';
  regRef('product', d, p, p.usd);
  return `<span class="own-ctl" data-own="product:${p.id}">${collectBtns('product', p.id, p.name)}<button class="btn btn-sm" data-collect="add" data-kind="product" data-ref="${p.id}" aria-label="Přidat ${esc(p.name)} do sbírky">+</button></span>`;
}

$('#set-detail').addEventListener('click', async (e) => {
  const all = e.target.closest('[data-sd-all]');
  if (all) {
    // detail ve staré verzi nemá všechny karty: dočte je endpoint sbírky (a uloží novou verzi)
    const box = $('#sd-all');
    const d = SETS.open?.cards ? { ...SETS.open, usdCzk: SETS.data?.usdCzk } : await busy(all, () => api(`portfolio?set=${SETS.open.id}`));
    if (!d) return;
    $('[data-sd-all]', box).remove();
    const holder = document.createElement('div');
    box.append(holder);
    cardBrowser(holder, d);
    return;
  }
  if (!e.target.closest('[data-back]')) return;
  closeSetDetail();
  pushRoute('#/edice');
});

// ---------- můj profil: sbírka a její hodnota ----------
// PokeData dává jen aktuální ceny, historii skládá server po dnech (pricehist) od přidání položky.
const PF = { data: null, days: 30, pick: null, queue: Promise.resolve(), inflight: 0 };
const GRADE = { raw: 'raw', psa9: 'PSA 9', psa10: 'PSA 10' };
const pfKc = (usd) => (usd == null || !PF.data?.usdCzk ? null : usd * PF.data.usdCzk);
const dayAgo = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;
const signed = (v) => (v == null ? '—' : `${v > 0.5 ? '+' : v < -0.5 ? '−' : ''}${price(Math.abs(v))}`);
const pct = (p) => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p * 100).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} %`;
const dirOf = (diff, base) => (!base || Math.abs(diff / base) < 0.0005 ? 'flat' : diff > 0 ? 'up' : 'down');
// změna se šipkou a znaménkem, aby nebyla poznat jen podle barvy
function chg(diff, base) {
  if (diff == null || !base) return '<span class="muted">—</span>';
  const d = dirOf(diff, base);
  return `<span class="chg ${d}">${d === 'up' ? '▲' : d === 'down' ? '▼' : '•'} ${pct(diff / base)}</span>`;
}

// Body ceny položky [[den, usd]]: cena při přidání, denní záznamy a aktuální cena.
function pricePoints(it) {
  const m = new Map();
  if (it.addedUsd != null) m.set(it.addedAt.slice(0, 10), it.addedUsd);
  for (const [d, u] of it.hist || []) m.set(d, u);
  if (it.usd != null && it.pricedAt) m.set(it.pricedAt.slice(0, 10), it.usd);
  return [...m].sort((a, b) => a[0].localeCompare(b[0]));
}
// Cena v daný den = poslední známá. Před prvním záznamem první známá (bez dat se nepočítá změna).
function priceOn(pts, day) {
  let v = pts[0]?.[1] ?? null;
  for (const [d, u] of pts) { if (d > day) break; v = u; }
  return v;
}

function enrichPf() {
  for (const it of PF.data.items) {
    it.pts = pricePoints(it);
    it.now = it.usd ?? it.pts.at(-1)?.[1] ?? null;
    it.valueKc = it.now == null ? null : pfKc(it.now) * it.qty;
    const w = priceOn(it.pts, dayAgo(7));
    it.d7 = it.now == null || w == null ? null : (it.now - w) * it.qty;
    it.w7 = w == null ? null : w * it.qty;
    it.costKc = it.buyPrice == null ? null : it.buyPrice * it.qty;
    it.profitKc = it.costKc == null || it.valueKc == null ? null : it.valueKc - it.costKc;
  }
}

function changeSince(days) {
  let diff = 0, base = 0;
  for (const it of PF.data.items) {
    if (it.now == null) continue;
    const then = priceOn(it.pts, dayAgo(days));
    diff += pfKc(it.now - then) * it.qty;
    base += pfKc(then) * it.qty;
  }
  return { diff, base };
}

const firstDay = () => PF.data.items.filter((i) => i.pts.length).map((i) => i.pts[0][0]).sort()[0] || null;

// Hodnota dnešní sbírky den po dni (dnešní počty kusů × tehdejší ceny).
function pfSeries(days) {
  const items = PF.data.items.filter((i) => i.pts.length);
  let start = firstDay();
  if (!start) return [];
  if (days && start < dayAgo(days)) start = dayAgo(days);
  const out = [];
  for (let t = Date.parse(start + 'T00:00:00Z'); t <= Date.now(); t += DAY) {
    const d = new Date(t).toISOString().slice(0, 10);
    out.push([d, items.reduce((s, i) => s + pfKc(priceOn(i.pts, d)) * i.qty, 0)]);
  }
  return out;
}

// Profil v horní liště: profilovka (sprite trenéra, iniciála, nebo ikona) a hodnota sbírky.
const ME_ICON = $('#me-avatar').innerHTML;
// sprity z public/img/trainers (herní sprity trenérů, 80×80 px)
const TRAINERS = [
  ['red', 'Red'], ['blue', 'Blue'], ['ash', 'Ash'], ['misty', 'Misty'], ['brock', 'Brock'], ['erika', 'Erika'],
  ['sabrina', 'Sabrina'], ['lance', 'Lance'], ['ethan', 'Ethan'], ['lyra', 'Lyra'], ['brendan', 'Brendan'], ['may', 'May'],
  ['steven', 'Steven'], ['lucas', 'Lucas'], ['dawn', 'Dawn'], ['cynthia', 'Cynthia'], ['hilbert', 'Hilbert'], ['hilda', 'Hilda'],
  ['n', 'N'], ['nate', 'Nate'], ['rosa', 'Rosa'], ['calem', 'Calem'], ['serena', 'Serena'], ['elio', 'Elio'],
  ['selene', 'Selene'], ['victor', 'Victor'], ['gloria', 'Gloria'], ['leon', 'Leon'], ['marnie', 'Marnie'], ['raihan', 'Raihan'],
];
const trainerImg = (id) => `<img src="img/trainers/${id}.png" alt="" width="80" height="80" decoding="async">`;
function paintAvatar(av, profile) {
  const avatar = TRAINERS.some(([id]) => id === profile?.avatar) ? profile.avatar : null;
  av.classList.toggle('has-img', !!avatar);
  if (avatar) av.innerHTML = trainerImg(avatar);
  else if (profile?.name) av.textContent = profile.name.trim()[0].toUpperCase();
  else av.innerHTML = ME_ICON;
}
function renderMe(total) {
  const name = PF.data.profile?.name;
  $('#me-name').textContent = name || 'Můj profil';
  $('#me-value').textContent = PF.data.items.length ? price(total) : '';
  for (const av of [$('#me-avatar'), $('#pf-avatar')]) paintAvatar(av, PF.data.profile);
  $('#me').setAttribute('aria-label', `Můj profil${name ? `: ${name}` : ''}${PF.data.items.length ? `, sbírka ${price(total)}` : ''}`);
  if (!$('#pf-avatars').hidden) renderAvatarPicker();
}

// výběr profilovky
function renderAvatarPicker() {
  const cur = PF.data?.profile?.avatar || null;
  const opt = (id, label, inner) => `
    <button class="av-opt ${id === cur ? 'on' : ''}" role="radio" aria-checked="${id === cur}" data-avatar="${id || ''}">
      <span class="av-img">${inner}</span><span>${label}</span>
    </button>`;
  $('#av-grid').innerHTML = opt(null, 'Bez obrázku', ME_ICON) + TRAINERS.map(([id, label]) => opt(id, label, trainerImg(id))).join('');
}
function toggleAvatars(open) {
  $('#pf-avatars').hidden = !open;
  for (const b of [$('#pf-avatar-btn'), $('#pf-avatar-open')]) b.setAttribute('aria-expanded', String(open));
  if (open) { renderAvatarPicker(); $('#av-grid .av-opt.on')?.focus({ preventScroll: true }); }
}
for (const b of [$('#pf-avatar-btn'), $('#pf-avatar-open')]) b.addEventListener('click', () => toggleAvatars($('#pf-avatars').hidden));
$('#pf-avatars').addEventListener('click', (e) => {
  if (e.target.closest('[data-avatar-close]')) { toggleAvatars(false); return; }
  const o = e.target.closest('[data-avatar]');
  if (!o || !PF.data) return;
  const avatar = o.dataset.avatar || null;
  PF.data.profile = { ...PF.data.profile, avatar }; // hned ukázat, uloží se na pozadí
  renderProfile();
  toggleAvatars(false);
  pfSave({ action: 'profile', avatar });
  toast(avatar ? `Profilovka: ${TRAINERS.find(([id]) => id === avatar)[1]}` : 'Profilovka odebrána');
});

async function loadPortfolio() {
  if (PF.inflight) return; // rozpracované změny by se přepsaly
  PF.data = await api('portfolio');
  renderProfile();
}

// Změny jdou na server jedna po druhé (rychlé klikání by si jinak přepisovalo sbírku).
// Stav ze serveru se převezme až po poslední z nich, do té doby platí lokální úprava.
function pfSave(body) {
  PF.inflight++;
  PF.queue = PF.queue
    .then(() => api('portfolio', body))
    .then((d) => { if (--PF.inflight === 0) { PF.data = d; renderProfile(); } })
    .catch((e) => { PF.inflight--; toast(e.message, true); return loadPortfolio(); });
  return PF.queue;
}

function renderProfile() {
  if (!PF.data) return;
  enrichPf();
  // prázdná sbírka = jeden úvodní blok místo prázdného grafu a prázdné tabulky
  const empty = !PF.data.items.length;
  $('#pf-empty').hidden = !empty;
  $('#pf-chart-panel').hidden = empty;
  $('#pf-table-panel').hidden = empty;
  const items = PF.data.items;
  $('#pf-name').textContent = PF.data.profile?.name || 'Trenér';
  const nCards = items.filter((i) => i.kind === 'card').reduce((s, i) => s + i.qty, 0);
  const nProds = items.filter((i) => i.kind === 'product').reduce((s, i) => s + i.qty, 0);
  $('#pf-sub').textContent = items.length
    ? `${plural(nCards, 'karta', 'karty', 'karet')} · ${plural(nProds, 'zapečetěný produkt', 'zapečetěné produkty', 'zapečetěných produktů')} · ${plural(new Set(items.map((i) => i.setId)).size, 'edice', 'edice', 'edic')}`
    : 'Sbírka je zatím prázdná. Přidej karty, které máš, a uvidíš, kolik má hodnotu a jak se jí vede.';

  const total = items.reduce((s, i) => s + (i.valueKc || 0), 0);
  const bought = items.filter((i) => i.profitKc != null);
  const cost = bought.reduce((s, i) => s + i.costKc, 0), profit = bought.reduce((s, i) => s + i.profitKc, 0);
  const energy = (d) => ({ up: 'var(--grass)', down: 'var(--fire)', flat: 'var(--colorless)' })[d];
  // změna za období; když ceny sbírám kratší dobu, řekne to
  const since = firstDay();
  const have = since ? Math.floor((Date.parse(today()) - Date.parse(since)) / DAY) : 0;
  const change = (n, label) => {
    if (have < 1) return { b: '—', l: `${label} · zatím bez historie`, e: 'var(--colorless)' };
    const c = changeSince(n);
    return { b: signed(c.diff), l: `${label}${have < n ? ` (data za ${plural(have, 'den', 'dny', 'dní')})` : ''} · ${chg(c.diff, c.base)}`, e: energy(dirOf(c.diff, c.base)) };
  };
  const stats = [
    { b: price(total), l: 'hodnota sbírky', e: 'var(--accent)' },
    change(1, 'za 24 h'),
    change(30, 'za 30 dní'),
    bought.length
      ? { b: signed(profit), l: `proti nákupu · ${chg(profit, cost)}${bought.length < items.length ? ` · u ${bought.length} z ${items.length}` : ''}`, e: energy(dirOf(profit, cost)) }
      : { b: '—', l: 'proti nákupu · doplň nákupní ceny', e: 'var(--colorless)' },
  ];
  $('#pf-stats').innerHTML = stats.map((s) => `<div class="stat" style="--energy:${s.e}"><b>${s.b}</b><span>${s.l}</span></div>`).join('');
  renderMe(total);

  renderPfChart();
  renderPfTable();
  renderOwned();
}

// osa: „12 400 Kč“, u velkých částek zkráceně „1,2 mil.“
const axisKc = (v) => (Math.abs(v) >= 100000 ? new Intl.NumberFormat('cs-CZ', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : Math.round(v).toLocaleString('cs-CZ')) + ' Kč';
function niceTicks(lo, hi, n) {
  const raw = (hi - lo) / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const out = [];
  for (let v = Math.floor(lo / step) * step; ; v += step) { out.push(v); if (v >= hi - step * 1e-9) break; }
  return out;
}

function renderPfChart() {
  const box = $('#pf-chart');
  if (!PF.data || box.offsetParent === null) return; // skrytý graf by měl nulovou šířku
  const s = pfSeries(PF.days);
  const since = firstDay();
  $('#pf-chart-note').textContent = since
    ? `Ceny sbírám od ${fmtDate(since)}. Graf ukazuje dnešní sbírku v tehdejších cenách, takže přidání karty ho neposune nahoru.`
    : '';
  if (s.length < 2) {
    box.innerHTML = `<p class="empty">${PF.data.items.length ? 'Graf se začne kreslit zítra. Ceny se ukládají jednou denně.' : 'Přidej první kartu a začnu sledovat, kolik má sbírka hodnotu.'}</p>`;
    return;
  }
  const W = box.clientWidth, H = 240, L = 74, R = 12, T = 12, B = 28;
  const vals = s.map((p) => p[1]);
  const allBought = PF.data.items.every((i) => i.costKc != null || i.now == null);
  const cost = allBought ? PF.data.items.reduce((a, i) => a + (i.costKc || 0), 0) : null;
  let lo = Math.min(...vals, cost ?? Infinity), hi = Math.max(...vals, cost ?? -Infinity);
  if (hi - lo < hi * 0.02) { const pad = Math.max(hi * 0.02, 50); lo -= pad; hi += pad; } // téměř plochou křivku neroztahovat přes celou výšku
  const ticks = niceTicks(Math.max(0, lo), hi, 4);
  lo = ticks[0]; hi = ticks.at(-1);
  const x = (i) => L + (i / (s.length - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const line = s.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join('');
  const xIdx = [...new Set((W < 520 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((f) => Math.round(f * (s.length - 1))))];
  const first = vals[0], last = vals.at(-1);
  box.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" tabindex="0" role="img" aria-label="Hodnota sbírky od ${fmtDate(s[0][0])} do dnes: z ${price(first)} na ${price(last)}">
      <defs><linearGradient id="pf-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:.2"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient></defs>
      <g class="grid">${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 10}" y="${y(t) + 4}" text-anchor="end">${axisKc(t)}</text>`).join('')}</g>
      ${cost != null ? `<line class="cost" x1="${L}" x2="${W - R}" y1="${y(cost)}" y2="${y(cost)}"/><text class="cost-l" x="${W - R}" y="${y(cost) - 6}" text-anchor="end">nákup ${price(cost)}</text>` : ''}
      <path class="area" d="${line}L${x(s.length - 1)},${H - B}L${L},${H - B}Z"/>
      <path class="line" d="${line}"/>
      <g class="xl">${xIdx.map((i) => `<text x="${x(i)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === s.length - 1 ? 'end' : 'middle'}">${fmtDay(s[i][0])}</text>`).join('')}</g>
      <g class="hover" visibility="hidden"><line class="cross" y1="${T}" y2="${H - B}"/><circle r="5"/></g>
    </svg>
    <div class="pf-tip" hidden></div>`;

  const svg = box.querySelector('svg'), hov = svg.querySelector('.hover'), tip = box.querySelector('.pf-tip');
  let cur = s.length - 1;
  const show = (i) => {
    cur = Math.max(0, Math.min(s.length - 1, i));
    const [d, v] = s[cur], cx = x(cur), cy = y(v);
    hov.setAttribute('visibility', 'visible');
    hov.querySelector('line').setAttribute('x1', cx);
    hov.querySelector('line').setAttribute('x2', cx);
    hov.querySelector('circle').setAttribute('cx', cx);
    hov.querySelector('circle').setAttribute('cy', cy);
    tip.innerHTML = `<b>${price(v)}</b><span>${fmtDate(d)}${cur ? ` · ${chg(v - first, first)} od ${fmtDay(s[0][0])}` : ''}</span>`;
    tip.hidden = false;
    tip.style.left = `${Math.max(tip.offsetWidth / 2, Math.min(W - tip.offsetWidth / 2, cx))}px`;
    tip.style.top = `${Math.max(0, cy - tip.offsetHeight - 14)}px`;
  };
  const hide = () => { hov.setAttribute('visibility', 'hidden'); tip.hidden = true; };
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    show(Math.round((((e.clientX - r.left) * (W / r.width)) - L) / (W - L - R) * (s.length - 1)));
  });
  svg.addEventListener('pointerleave', hide);
  svg.addEventListener('blur', hide);
  svg.addEventListener('focus', () => show(cur));
  svg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); show(cur + (e.key === 'ArrowLeft' ? -1 : 1)); }
  });
}

$('#pf-period').addEventListener('click', (e) => {
  const b = e.target.closest('[data-days]');
  if (!b) return;
  PF.days = Number(b.dataset.days);
  $$('#pf-period button').forEach((x) => x.classList.toggle('on', x === b));
  renderPfChart();
});
let pfResize;
addEventListener('resize', () => { clearTimeout(pfResize); pfResize = setTimeout(renderPfChart, 150); });

function renderPfTable() {
  const tb = $('#pf-table tbody');
  const items = [...PF.data.items];
  if (!items.length) { tb.innerHTML = ''; return; } // prázdnou sbírku ukazuje #pf-empty
  const rel = (i) => (i.d7 == null || !i.w7 ? 0 : i.d7 / i.w7);
  const key = {
    value: (a, b) => (b.valueKc ?? -1) - (a.valueKc ?? -1),
    up: (a, b) => rel(b) - rel(a),
    down: (a, b) => rel(a) - rel(b),
    profit: (a, b) => (b.profitKc ?? -1e12) - (a.profitKc ?? -1e12),
    new: (a, b) => b.addedAt.localeCompare(a.addedAt),
    name: (a, b) => a.name.localeCompare(b.name, 'cs'),
  }[$('#pf-sort').value];
  items.sort(key);
  tb.innerHTML = items.map((it) => `
    <tr data-id="${esc(it.id)}">
      <td>${img(it.img, it.kind === 'card' ? 'thumb pf-thumb' : 'thumb', it.name)}</td>
      <td class="name"><b>${esc(it.name)}</b>
        <div class="meta">${esc(it.setName)}${it.num ? ` · #${esc(it.num)}` : ''} · ${it.kind === 'card' ? GRADE[it.grade] : 'zapečetěné'}</div></td>
      <td class="num">${it.qty}</td>
      <td class="num hide-sm">${price(pfKc(it.now))}</td>
      <td class="num">${price(it.valueKc)}<div class="meta show-sm">${chg(it.d7, it.w7)}</div></td>
      <td class="num hide-sm">${chg(it.d7, it.w7)}</td>
      <td class="num hide-sm">${it.profitKc == null ? '<span class="muted">—</span>' : `${chg(it.profitKc, it.costKc)}<div class="meta">${signed(it.profitKc)}</div>`}</td>
      <td class="hide-sm"><button class="btn btn-sm" data-edit aria-expanded="false">Upravit</button></td>
    </tr>`).join('');
}
$('#pf-sort').addEventListener('input', renderPfTable);

$('#pf-table').addEventListener('click', (e) => {
  // klik kamkoli do řádku = Upravit (na mobilu je tlačítko skryté)
  const row = e.target.closest('tr[data-id]');
  const b = e.target.closest('[data-edit]') || (row && !e.target.closest('a, button') && row.querySelector('[data-edit]'));
  if (!b) return;
  const tr = b.closest('tr');
  const open = tr.nextElementSibling?.classList.contains('pf-edit');
  $$('#pf-table .pf-edit').forEach((x) => x.remove());
  $$('#pf-table [data-edit]').forEach((x) => x.setAttribute('aria-expanded', 'false'));
  if (open) return;
  const it = PF.data.items.find((i) => i.id === tr.dataset.id);
  b.setAttribute('aria-expanded', 'true');
  tr.insertAdjacentHTML('afterend', `
    <tr class="pf-edit"><td colspan="8">
      <form class="pf-edit-form">
        <label class="field"><span>Kusů</span><input name="qty" type="number" min="0" step="1" value="${it.qty}" required></label>
        ${it.kind === 'card' ? `<label class="field"><span>Stav karty</span><select name="grade">${Object.entries(GRADE).map(([k, l]) => `<option value="${k}" ${k === it.grade ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
        <label class="field"><span>Nákupní cena za kus (Kč)</span><input name="buyPrice" type="number" min="0" step="1" value="${it.buyPrice ?? ''}" placeholder="nepovinné"></label>
        <button class="btn btn-primary" type="submit">Uložit</button>
        <button class="btn btn-danger" type="button" data-remove>Odebrat ze sbírky</button>
      </form>
    </td></tr>`);
  const f = tr.nextElementSibling.querySelector('form');
  f.qty.focus();
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(f.querySelector('[type=submit]'), async () => {
      await pfSave({ action: 'update', id: it.id, qty: f.qty.value, buyPrice: f.buyPrice.value, ...(f.grade ? { grade: f.grade.value } : {}) });
      toast('Uloženo');
    });
  });
  f.querySelector('[data-remove]').addEventListener('click', (ev) => {
    if (!armed(ev.currentTarget, 'Opravdu odebrat?')) return;
    busy(ev.currentTarget, () => pfSave({ action: 'remove', id: it.id }));
  });
});

$('#pf-rename').addEventListener('click', () => {
  const h = $('#pf-name');
  if ($('#pf-rename-form') || !PF.data) return;
  const f = document.createElement('form');
  f.id = 'pf-rename-form';
  f.className = 'pf-rename-form';
  f.innerHTML = `<input name="nick" maxlength="40" value="${esc(PF.data.profile?.name || '')}" placeholder="Jméno nebo přezdívka" aria-label="Jméno profilu"><button class="btn btn-primary btn-sm" type="submit">Uložit</button>`;
  h.hidden = true;
  h.after(f);
  f.nick.focus();
  const close = () => { f.remove(); h.hidden = false; };
  f.nick.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    busy(f.querySelector('button'), async () => { await pfSave({ action: 'profile', name: f.nick.value }); close(); });
  });
});

// ---- výběr karet do sbírky ----
async function openPicker() {
  if (!PF.data) return;
  $('#pf-picker').hidden = false;
  if (!PF.pick) { $('#pk-sets').hidden = false; $('#pk-set').hidden = true; }
  $('#pf-picker').scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'start' });
  if (!SETS.data) await loadSets().catch((e) => toast(e.message, true));
  renderPickSets();
  if (!PF.pick) $('#pk-set-search').focus({ preventScroll: true });
}
$('#pf-add').addEventListener('click', openPicker);
$('#pf-empty [data-pf-add]').addEventListener('click', openPicker);
$('#pk-close').addEventListener('click', () => { $('#pf-picker').hidden = true; });

function renderPickSets() {
  const q = norm($('#pk-set-search').value);
  const mine = new Set(PF.data.items.map((i) => i.setId));
  const list = (SETS.data?.sets || [])
    .filter((s) => !q || norm(s.name).includes(q) || norm(s.code).includes(q))
    .sort((a, b) => (mine.has(b.id) - mine.has(a.id)) || b.releaseDate.localeCompare(a.releaseDate))
    .slice(0, q ? 30 : 12);
  $('#pk-set-list').innerHTML = list.map((s) => `
    <button class="pk-set-btn" data-pick="${s.id}">
      ${s.logo ? `<img src="${safeUrl(s.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
      <span><b>${esc(s.name)}</b><small>${s.language === 'JP' ? 'japonská' : 'anglická'} · ${fmtDate(s.releaseDate)}${mine.has(s.id) ? ' · máš z ní' : ''}</small></span>
    </button>`).join('') || `<p class="empty">Žádná edice neodpovídá. Zkus anglický název nebo kód setu.</p>`;
}
$('#pk-set-search').addEventListener('input', renderPickSets);
$('#pk-set-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick]');
  if (b) pickSet(Number(b.dataset.pick));
});

async function pickSet(id) {
  const box = $('#pk-set');
  $('#pk-sets').hidden = true;
  box.hidden = false;
  box.innerHTML = `<div class="sk sk-line" style="width:40%"></div><div class="pk-grid">${'<div class="sk pk-sk"></div>'.repeat(12)}</div>`;
  try {
    PF.pick = await api(`portfolio?set=${id}`);
    renderPickSet();
  } catch (e) {
    PF.pick = null;
    box.innerHTML = `<button class="btn btn-sm" data-pk-back>← Jiná edice</button><p class="empty">${esc(e.message)}</p>`;
  }
}

const ownedQty = (kind, refId) => (PF.data ? PF.data.items.filter((i) => i.kind === kind && i.refId === refId).reduce((s, i) => s + i.qty, 0) : 0);

function renderPickSet() {
  $('#pk-title').textContent = `Přidat do sbírky: ${PF.pick.name}`;
  cardBrowser($('#pk-set'), PF.pick, { back: true, done: true });
}

$('#pk-set').addEventListener('click', (e) => {
  if (e.target.closest('[data-pk-back]')) {
    PF.pick = null;
    $('#pk-title').textContent = 'Přidat do sbírky';
    $('#pk-set').hidden = true;
    $('#pk-sets').hidden = false;
    renderPickSets();
    return;
  }
  if (e.target.closest('[data-pk-done]')) $('#pf-picker').hidden = true;
});

// ---- sbírka odkudkoli: Edice, Přehled i výběr v profilu ----
// Každé místo, které ukazuje kartu nebo produkt, si ho zaregistruje (REFS) a vykreslí tlačítka
// [data-collect="add|minus"] uvnitř prvku [data-own="kind:id"]. Klik obslouží jeden společný handler,
// počty kusů se pak překreslí všude najednou (renderOwned).
const REFS = new Map();
function regRef(kind, set, r, usd) {
  REFS.set(`${kind}:${r.id}`, { kind, refId: r.id, setId: set.id, setName: set.name, fetchedAt: set.fetchedAt || null, name: r.name, num: r.num || null, img: r.img || null, usd: usd ?? null });
}
const collectBtns = (kind, id, name) => `
  <span class="pk-qty"></span>
  <button class="pk-minus" data-collect="minus" data-kind="${kind}" data-ref="${id}" aria-label="Odebrat jeden kus ${esc(name)}" hidden>−</button>`;

// Karta s obrázkem a tlačítkem „+“ (Přehled, nejdražší karty v Edicích).
function collectCard(set, c, { rank = null, sub = '', rate = null } = {}) {
  const can = c.id != null;
  if (can) regRef('card', set, c, c.raw);
  return `
    <div class="pcard" ${can ? `data-own="card:${c.id}"` : ''}>
      <div class="img">${rank ? `<span class="rank">#${rank}</span>` : ''}${c.img ? `<img src="${safeUrl(c.img)}" alt="${esc(c.name)}" loading="lazy" referrerpolicy="no-referrer">` : ''}
        ${can ? `<button class="pc-add" data-collect="add" data-kind="card" data-ref="${c.id}" aria-label="Přidat ${esc(c.name)} do sbírky">+</button>` : ''}</div>
      <b>${esc(c.name)}</b>
      <div class="price-row"><span class="num mono">${c.raw == null || !rate ? '—' : price(c.raw * rate)}</span>${can ? collectBtns('card', c.id, c.name) : ''}</div>
      ${sub ? `<small>${sub}</small>` : ''}
    </div>`;
}

// Všechny karty a produkty edice s filtrem (výběr v profilu i detail edice).
function cardBrowser(box, d, { back = false, done = false } = {}) {
  for (const c of d.cards) regRef('card', d, c, c.raw);
  for (const p of d.products) if (p.id != null) regRef('product', d, p, p.usd);
  const kc2 = (usd) => price(usd == null || !d.usdCzk ? null : usd * d.usdCzk);
  box.innerHTML = `
    <div class="pk-tools">
      ${back ? '<button class="btn btn-sm" data-pk-back>← Jiná edice</button>' : ''}
      <input class="cb-filter" type="search" placeholder="Filtrovat podle jména nebo čísla" aria-label="Filtrovat karty">
      <label class="check"><input type="checkbox" class="cb-mine"> Jen co mám</label>
    </div>
    <p class="hint">Klik na kartu přidá jeden kus (raw). Stav (PSA 9 / PSA 10), počet a nákupní cenu upravíš pak v tabulce sbírky v profilu.</p>
    <div class="pk-grid"></div>
    ${d.products.length ? '<h3 class="sub">Zapečetěné produkty</h3><ul class="pk-prods"></ul>' : ''}
    ${done ? '<div class="pk-foot"><button class="btn" data-pk-done>Hotovo</button></div>' : ''}`;
  const draw = () => {
    const q = norm($('.cb-filter', box).value.trim()), mineOnly = $('.cb-mine', box).checked;
    const ok = (name, num, kind, id) => (!q || norm(name).includes(q) || String(num ?? '') === q) && (!mineOnly || ownedQty(kind, id));
    $('.pk-grid', box).innerHTML = d.cards.filter((c) => ok(c.name, c.num, 'card', c.id)).map((c) => `
      <div class="pk-card" data-own="card:${c.id}">
        <button class="pk-art" data-collect="add" data-kind="card" data-ref="${c.id}" aria-label="Přidat ${esc(c.name)} #${esc(c.num)}">
          ${c.img ? `<img src="${safeUrl(c.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span class="pk-qty"></span>
        </button>
        <b title="${esc(c.name)}">${esc(c.name)}</b>
        <div class="pk-row"><small>#${esc(c.num)}</small><span class="num">${kc2(c.raw)}</span>
          <button class="pk-minus" data-collect="minus" data-kind="card" data-ref="${c.id}" aria-label="Odebrat jeden kus ${esc(c.name)}" hidden>−</button></div>
      </div>`).join('') || '<p class="empty">Žádná karta neodpovídá filtru.</p>';
    const prods = $('.pk-prods', box);
    if (prods) {
      prods.innerHTML = d.products.filter((p) => p.id != null && ok(p.name, null, 'product', p.id)).map((p) => `
        <li data-own="product:${p.id}">
          ${img(p.img, 'thumb', p.name)}
          <div><b>${esc(p.name)}</b><span class="meta num">${kc2(p.usd)}</span></div>
          ${collectBtns('product', p.id, p.name)}
          <button class="btn btn-sm" data-collect="add" data-kind="product" data-ref="${p.id}">Přidat</button>
        </li>`).join('') || '<li class="empty">Nic neodpovídá filtru.</li>';
    }
    renderOwned();
  };
  $('.cb-filter', box).addEventListener('input', draw);
  $('.cb-mine', box).addEventListener('change', draw);
  draw();
}

// počty kusů všude, kde se karta nebo produkt ukazuje (mřížky se nepřekreslují, aby neposkakovaly)
function renderOwned() {
  $$('[data-own]').forEach((el) => {
    const [kind, id] = el.dataset.own.split(':');
    const n = ownedQty(kind, Number(id));
    el.classList.toggle('own', n > 0);
    const q = $('.pk-qty', el);
    if (q) q.textContent = n ? `×${n}` : '';
    $$('[data-collect="minus"]', el).forEach((b) => (b.hidden = !n));
  });
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-collect]');
  if (!b) return;
  e.preventDefault();
  if (!PF.data) { toast('Sbírka se ještě načítá, zkus to za chvilku.', true); return; }
  const kind = b.dataset.kind, refId = Number(b.dataset.ref);
  const ref = REFS.get(`${kind}:${refId}`);
  if (!ref) return;
  const items = PF.data.items;
  if (b.dataset.collect === 'add') {
    const id = kind === 'card' ? `c:${refId}:raw` : `p:${refId}`;
    const it = items.find((i) => i.id === id);
    if (it) it.qty++;
    else items.push({ id, kind, refId, grade: kind === 'card' ? 'raw' : null, qty: 1, setId: ref.setId, setName: ref.setName, name: ref.name, num: ref.num, img: ref.img, buyPrice: null, addedAt: new Date().toISOString(), addedUsd: ref.usd, usd: ref.usd, pricedAt: ref.fetchedAt, hist: [] });
    pfSave({ action: 'add', kind, setId: ref.setId, refId });
    // mimo výběr v profilu potvrdit, že se to opravdu uložilo do sbírky
    if (!b.closest('#pf-picker')) toast(`Ve sbírce: ${ref.name} (${ownedQty(kind, refId)} ks)`);
  } else {
    // ubírá se nejdřív raw kus, pak ostatní stavy
    const it = items.find((i) => i.id === `c:${refId}:raw`) || items.find((i) => i.kind === kind && i.refId === refId);
    if (!it) return;
    it.qty--;
    if (it.qty <= 0) PF.data.items = items.filter((i) => i !== it);
    pfSave({ action: 'update', id: it.id, qty: Math.max(0, it.qty) });
  }
  renderOwned();
  renderProfile();
  const badge = $('.pk-qty', b.closest('[data-own]') || b);
  if (badge && motion()) gsap.fromTo(badge, { scale: 1.5 }, { scale: 1, duration: 0.35, ease: 'back.out(3)' });
});

// ---------- kalendář ----------
function renderCalendar() {
  const items = upcomingItems();
  if (!items.length) { $('#calendar').innerHTML = `<p class="empty">Zatím žádné termíny. Doplňují se z předprodejů v obchodech (Černý rytíř uvádí datum vydání), ručně je přidáš vpravo.</p>`; return; }
  const soon = new Date(Date.now() + 7 * DAY).toISOString().slice(0, 10);
  const byMonth = {};
  for (const x of items) (byMonth[x.date.slice(0, 7)] ||= []).push(x);
  $('#calendar').innerHTML = Object.entries(byMonth).map(([m, xs]) => `
    <div class="month">
      <h3>${new Date(m + '-01').toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' })}</h3>
      ${xs.map((x) => `
        <div class="rel">
          <span class="day ${x.date >= today() && x.date <= soon ? 'soon' : ''}">${fmtDay(x.date)}</span>
          <div>
            ${x.url ? ext(x.url, esc(x.name)) : `<b>${esc(x.name)}</b>`}
            <div class="meta">${esc(x.meta)}${x.availability ? ' · ' + AVAIL[x.availability] : ''}</div>
          </div>
          ${x.manual ? `<button class="x" data-del="${esc(x.id)}">Smazat</button>` : '<span></span>'}
        </div>`).join('')}
    </div>`).join('');
}
$('#calendar').addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-del]');
  if (!b || !armed(b, 'Opravdu?')) return;
  await busy(b, async () => {
    S.releases = (await api('releases', { action: 'remove', id: b.dataset.del })).releases;
    renderCalendar(); renderUpcoming();
  });
});
$('#release-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  await busy(f.querySelector('button'), async () => {
    const r = await api('releases', { action: 'add', name: f.name.value, date: f.date.value, region: f.region.value, url: f.url.value || null, note: f.note.value || null });
    S.releases = r.releases;
    f.reset();
    renderCalendar(); renderUpcoming();
    toast('Termín přidán');
  });
});

// ---------- novinky ----------
function renderNews() {
  const only = $('#n-announce').checked, cz = $('#n-cz').checked;
  const items = S.news.filter((n) => (!only || n.announce) && (!cz || n.lang === 'cs'));
  $('#n-meta').textContent = `PokeGuardian · Google News EN · Google News CZ · načteno ${ago(S.newsLastScan)}`;
  $('#news').innerHTML = items.length ? items.map((n) => `
    <a class="news-card" href="${safeUrl(n.url)}" target="_blank" rel="noopener">
      ${n.image ? img(n.image, '', n.title) : ''}
      <div>
        <span class="src">${n.announce && n.lang !== 'cs' ? '<span class="tag t-news">ohlášení</span> · ' : ''}${n.lang === 'cs' ? 'CZ · ' : ''}${esc(n.source)}</span>
        <b>${esc(n.title)}</b>
        ${n.excerpt ? `<span class="meta">${esc(n.excerpt)}</span>` : ''}
        <span class="meta">${ago(n.published || n.firstSeen)}</span>
      </div>
    </a>`).join('') : `<p class="empty">Žádné novinky pro tenhle filtr.</p>`;
}
$('#n-announce').addEventListener('change', renderNews);
$('#n-cz').addEventListener('change', renderNews);

// ---------- účet (Nastavení) ----------
async function loadAccount() {
  const d = await api('account');
  $('#acc-me').textContent = `Přihlášený účet: ${d.user}`;
  renderAccounts(d.user, d.users);
}
function renderAccounts(me, users) {
  $('#acc-list').innerHTML = users.map((u) => `
    <li data-user="${esc(u.name)}">
      <span><b>${esc(u.name)}</b>${u.name === me ? ' <span class="muted">· ty</span>' : ''}</span>
      ${u.name === me ? '' : `<span class="row"><button class="btn btn-sm" data-acc="reset">Nové heslo</button><button class="btn btn-sm btn-danger" data-acc="remove">Smazat</button></span>`}
    </li>`).join('');
}
$('#acc-list').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-acc]');
  if (!b) return;
  const li = b.closest('li'), user = li.dataset.user;
  if (b.dataset.acc === 'remove') {
    if (!armed(b, 'Opravdu smazat?')) return;
    await busy(b, async () => { const d = await api('account', { action: 'remove', user }); renderAccounts($('#acc-me').textContent.split(': ')[1], d.users); toast(`Účet ${user} smazán`); });
    return;
  }
  // nové heslo pro jiný účet (kdo zapomněl) — formulář přímo v řádku
  if (li.nextElementSibling?.classList.contains('acc-reset')) { li.nextElementSibling.remove(); return; }
  li.insertAdjacentHTML('afterend', `<li class="acc-reset"><form class="row"><label class="field grow"><span>Nové heslo pro ${esc(user)}</span><input name="password" type="password" autocomplete="new-password" minlength="8" required></label><button class="btn" type="submit">Nastavit</button></form></li>`);
  const f = li.nextElementSibling.querySelector('form');
  f.password.focus();
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    busy(f.querySelector('button'), async () => { await api('account', { action: 'reset', user, password: f.password.value }); f.closest('li').remove(); toast(`Heslo pro ${user} změněno`); });
  });
});
$('#pw-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  busy(f.querySelector('button'), async () => { await api('account', { action: 'password', old: f.old.value, password: f.password.value }); f.reset(); toast('Heslo změněno'); });
});
$('#acc-add').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target;
  busy(f.querySelector('button'), async () => {
    const d = await api('account', { action: 'add', user: f.user.value, password: f.password.value });
    renderAccounts($('#acc-me').textContent.split(': ')[1], d.users);
    toast(`Účet ${f.user.value.trim().toLowerCase()} přidán`);
    f.reset();
  });
});
$('#logout').addEventListener('click', (e) => busy(e.target, async () => {
  await api('auth', { action: 'logout' });
  location.reload();
}));

// ---------- nastavení ----------
function renderSettings() {
  const c = S.channels;
  $('#channels').innerHTML = `
    <div class="channel"><span class="dot ${c.telegram ? 'on' : ''}"></span> Telegram ${c.telegram ? 'nastaven' : '<span class="muted">· chybí TELEGRAM_BOT_TOKEN a TELEGRAM_CHAT_ID</span>'}</div>
    <div class="channel"><span class="dot ${c.discord ? 'on' : ''}"></span> Discord ${c.discord ? 'nastaven' : '<span class="muted">· chybí DISCORD_WEBHOOK_URL</span>'}</div>`;
  const f = $('#settings-form');
  f.notifyRestock.checked = S.settings.notifyRestock;
  f.notifyPriceDrop.checked = S.settings.notifyPriceDrop;
  f.notifyNewProducts.checked = S.settings.notifyNewProducts;
  f.keywords.value = (S.settings.keywords || []).join(', ');
  f.newsNotify.value = S.settings.newsNotify;

  const r = S.runs;
  const errs = [...(r.stock?.notifyErrors || []), ...(r.scan?.notifyErrors || [])];
  $('#runs').innerHTML = `Sken obchodů ${ago(r.scan?.at)} · kontrola hlídaných ${ago(r.stock?.at)}` +
    (errs.length ? `<br><span class="error">Notifikace selhala: ${esc(errs[0])}</span>` : '');

  const disabled = new Set(S.settings.disabledShops || []);
  $('#shops-table tbody').innerHTML = S.shops.map((s) => `
    <tr>
      <td>${ext(`https://${s.host}`, esc(s.name))}
        ${s.error ? `<div class="error">⚠ ${esc(s.error)}</div>` : ''}</td>
      <td class="muted">${s.blocked ? '<span class="error">blokuje roboty</span>' : s.scans ? 'sken + hlídání' : 'jen hlídání'}</td>
      <td class="num">${s.products || ''}${s.queued ? ` <span class="muted">(+${s.queued})</span>` : ''}</td>
      <td class="muted">${s.scans ? ago(s.lastScan) : ''}</td>
      <td>${s.scans ? `<input type="checkbox" data-shop="${esc(s.id)}" aria-label="Skenovat ${esc(s.name)}" ${disabled.has(s.id) ? '' : 'checked'}>` : ''}</td>
    </tr>`).join('');
}

async function saveSettings(patch) {
  S.settings = (await api('settings', patch)).settings;
}

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  await busy(f.querySelector('button[type=submit]'), async () => {
    await saveSettings({
      notifyRestock: f.notifyRestock.checked,
      notifyPriceDrop: f.notifyPriceDrop.checked,
      notifyNewProducts: f.notifyNewProducts.checked,
      keywords: f.keywords.value,
      newsNotify: f.newsNotify.value,
    });
    renderSettings();
    toast('Uloženo');
  });
});

$('#shops-table').addEventListener('change', async (e) => {
  const cb = e.target.closest('input[data-shop]');
  if (!cb) return;
  const set = new Set(S.settings.disabledShops || []);
  cb.checked ? set.delete(cb.dataset.shop) : set.add(cb.dataset.shop);
  await saveSettings({ disabledShops: [...set] }).catch((x) => toast(x.message, true));
});

$('#test-notify').addEventListener('click', (e) => busy(e.target, async () => {
  const r = await api('run', { job: 'test' });
  if (!r.channels.telegram && !r.channels.discord) toast('Není nastavený Telegram ani Discord. Postup je v README.', true);
  else if (r.errors.length) toast(r.errors[0], true);
  else toast('Odesláno. Mrkni do Telegramu nebo Discordu.');
}));

$('#run-scan').addEventListener('click', (e) => busy(e.target, async () => {
  const r = await api('run', { job: 'scan' });
  const bad = Object.entries(r.status).filter(([, v]) => !v.ok).map(([k]) => k);
  toast(`Sken hotový · ${r.events} nových událostí${bad.length ? ` · chyba: ${bad.join(', ')}` : ''}`, bad.length > 0);
  await load();
}));

$('#run-stock').addEventListener('click', (e) => busy(e.target, async () => {
  const r = await api('run', { job: 'stock' });
  toast(`Zkontrolováno ${r.checked} z ${r.total} · ${r.events} změn`);
  await load();
}));

$('#refresh').addEventListener('click', (e) => busy(e.target, load));

// ---------- hledání v horní liště ----------
// Edice (ze souhrnu PokeData) a produkty z českých obchodů. Enter bez výběru = Trh CZ s tímhle dotazem.
const Q = { items: [], sel: -1 };
function searchItems(q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const match = (name) => { const n = norm(name); return words.every((w) => n.includes(w) || (w === 'etb' && n.includes('elite trainer'))); };
  const sets = (SETS.data?.sets || []).filter((s) => match(s.name) || norm(s.code) === norm(q)).slice(0, 4).map((s) => ({
    img: s.logo, cls: 'logo', label: s.name, meta: `edice · ${s.language === 'JP' ? 'japonská' : 'anglická'} · ${fmtDate(s.releaseDate)}`,
    go: () => openSet(s.id),
  }));
  const prods = (S?.groups || []).filter((g) => match(g.name))
    .sort((a, b) => (!!b.cheapest - !!a.cheapest) || (a.cheapest?.price ?? 1e9) - (b.cheapest?.price ?? 1e9))
    .slice(0, 6).map((g) => ({
      img: g.image, cls: 'thumb', label: g.name,
      meta: g.cheapest ? `nejlevněji ${price(g.cheapest.price)} · ${g.cheapest.shop}` : `${g.total} ${g.total === 1 ? 'nabídka' : 'nabídek'} · nikde skladem`,
      go: () => goMarket(g.name),
    }));
  return [...sets, ...prods];
}
function goMarket(q) {
  setView('market');
  $('#m-search').value = q;
  renderMarket();
  toTop();
}
function renderSearch() {
  const box = $('#q-results'), q = $('#q').value.trim();
  Q.items = searchItems(q);
  Q.sel = -1;
  const open = q.length > 1;
  box.hidden = !open;
  $('#q').setAttribute('aria-expanded', String(open));
  if (!open) return;
  box.innerHTML = Q.items.map((it, i) => `
    <button class="q-item" role="option" data-i="${i}" id="q-opt-${i}">
      ${it.img ? `<img class="${it.cls}" src="${safeUrl(it.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="thumb thumb-empty">◓</span>'}
      <span><b>${esc(it.label)}</b><small>${esc(it.meta)}</small></span>
    </button>`).join('') + `<button class="q-item q-all" role="option" data-all>Hledat „${esc(q)}“ ve všech obchodech →</button>`;
}
function closeSearch() { $('#q-results').hidden = true; $('#q').setAttribute('aria-expanded', 'false'); }
// po výběru výsledku pole vyprázdnit (dotaz zůstane ve filtru Trhu CZ)
function pickedSearch() { closeSearch(); $('#q').value = ''; $('#q').blur(); }
$('#q').addEventListener('input', renderSearch);
$('#q').addEventListener('focus', renderSearch);
$('#q').addEventListener('keydown', (e) => {
  const opts = $$('#q-results .q-item');
  if (e.key === 'Escape') { closeSearch(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!opts.length) return;
    Q.sel = (Q.sel + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
    opts.forEach((o, i) => o.classList.toggle('sel', i === Q.sel));
    $('#q').setAttribute('aria-activedescendant', opts[Q.sel].id || '');
  }
  if (e.key === 'Enter') {
    e.preventDefault();
    const o = opts[Q.sel];
    if (o && o.dataset.i != null) Q.items[o.dataset.i].go(); else if ($('#q').value.trim()) goMarket($('#q').value.trim());
    pickedSearch();
  }
});
// pointerdown místo click: výsledek se vybere dřív, než input ztratí fokus a seznam zavře
$('#q-results').addEventListener('pointerdown', (e) => {
  const o = e.target.closest('.q-item');
  if (!o) return;
  e.preventDefault();
  if (o.dataset.i != null) Q.items[o.dataset.i].go(); else goMarket($('#q').value.trim());
  pickedSearch();
});
$('#q').addEventListener('blur', () => setTimeout(closeSearch, 120));

// ---------- úvod ----------
// Pokéball spadne, kymácí se (jako při chytání), dokud se načítají data, pak cvakne a otevře se.
// Je to zároveň indikátor načítání: krátké načtení = krátký úvod. Klik nebo klávesa ho přeskočí.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function playIntro() {
  const el = $('#intro');
  if (!motion()) { el.remove(); return { finish: async () => {} }; }
  el.style.animation = 'none'; // CSS pojistku převezme JS: po 6 s se otevře i bez dat (pod ním jsou skeletony)
  const ball = $('.intro-ball', el), shadow = $('.intro-shadow', el);
  const t0 = performance.now();
  let skip;
  const skipped = new Promise((r) => (skip = r));
  setTimeout(() => skip(), 6000);
  const onKey = () => skip();
  el.addEventListener('pointerdown', onKey);
  addEventListener('keydown', onKey, { once: true });

  const wobble = gsap.timeline({ paused: true, repeat: -1, repeatDelay: 0.45, defaults: { ease: 'sine.inOut', transformOrigin: '50% 90%' } })
    .to(ball, { rotation: -18, duration: 0.16 })
    .to(ball, { rotation: 15, duration: 0.24 })
    .to(ball, { rotation: -7, duration: 0.18 })
    .to(ball, { rotation: 0, duration: 0.14 });
  const enter = gsap.timeline({ onComplete: () => wobble.play() })
    .from(ball, { y: -180, duration: 0.8, ease: 'bounce.out' })
    .from(shadow, { scale: 0.3, autoAlpha: 0, duration: 0.8, ease: 'bounce.out' }, '<')
    .from('.intro-name, .intro-status', { y: 10, autoAlpha: 0, stagger: 0.08, duration: 0.45, ease: 'power3.out' }, '-=0.35');
  const slow = setTimeout(() => { $('#intro-status').textContent = 'Procházím obchody…'; }, 2500);

  let done = null;
  const finish = () => (done ||= (async () => {
    // minimálně jedno kymácnutí, ať úvod nebliká; přeskočení to zkrátí
    await Promise.race([wait(Math.max(0, 1300 - (performance.now() - t0))), skipped]);
    clearTimeout(slow);
    wobble.pause();
    enter.progress(1);
    $('#intro-status').textContent = 'Hotovo';
    await gsap.timeline({ defaults: { ease: 'power3.out' } })
      .to(ball, { rotation: 0, duration: 0.12 })
      .addLabel('click')
      .to($('.ib-btn', el), { scale: 1.25, backgroundColor: '#fffbe6', boxShadow: '0 0 0 4px #0a0a0a, 0 0 28px 10px rgba(242, 194, 48, .9)', duration: 0.12 }, 'click')
      .addLabel('open', '+=0.08')
      .to($('.ib-top', el), { yPercent: -70, rotation: -22, duration: 0.5 }, 'open')
      .to($('.ib-bottom', el), { yPercent: 70, rotation: 12, duration: 0.5 }, 'open')
      .to($('.ib-btn', el), { scale: 0, duration: 0.25, ease: 'power2.in' }, 'open')
      .fromTo($('.ib-flash', el), { scale: 0, autoAlpha: 1 }, { scale: 26, autoAlpha: 0, duration: 0.7, ease: 'power2.out' }, 'open')
      .to('.intro-name, .intro-status, .intro-shadow', { autoAlpha: 0, duration: 0.25 }, 'open')
      .to(el, { autoAlpha: 0, duration: 0.35, ease: 'power1.in' }, 'open+=0.3');
    el.removeEventListener('pointerdown', onKey);
    removeEventListener('keydown', onKey);
    el.remove();
  })());
  skipped.then(finish);
  return { finish };
}

// ---------- přihlášení ----------
// Ilustrace se pomalu přibližuje a plují světlušky. Špatné heslo: pokéball se zakymácí a karta zatřese.
// Správné: pokéball cvakne a otevře se, záře zaplní obrazovku a mezitím se načtou data.
const LOGIN_SUB = 'Přihlas se a hlídej s námi novinky, ceny a svou sbírku.';
function showLogin(setup) {
  const el = $('#login'), f = $('#login-form'), q = (s) => $(s, el);
  el.hidden = false;
  document.body.classList.add('locked');
  // web pod přihlášením nejde projít Tabem ani čtečkou
  $('#app').inert = $('#bnav').inert = true;
  $('#login-title').textContent = setup ? 'Vítej, trenére!' : 'Vítej zpět, trenére!';
  $('#login-sub').textContent = setup ? 'Přidej se k hlídce a založ si účet. Další trenéry pak přidáš v Nastavení.' : LOGIN_SUB;
  $('#login-go-text').textContent = setup ? 'Založit účet' : 'Přihlásit se';
  $('#login-pw2').hidden = !setup;
  f.password.autocomplete = setup ? 'new-password' : 'current-password';
  $('#login-flies').innerHTML = Array.from({ length: 24 }, () =>
    `<i style="--x:${(Math.random() * 100).toFixed(1)}%;--y:${(30 + Math.random() * 70).toFixed(1)}%;--d:${(7 + Math.random() * 9).toFixed(1)}s;--t:-${(Math.random() * 12).toFixed(1)}s;--s:${(2 + Math.random() * 3).toFixed(1)}px"></i>`).join('');
  if (motion()) {
    gsap.timeline({ defaults: { ease: 'power3.out' } })
      .from(q('.login-brand'), { y: -16, autoAlpha: 0, duration: 0.6, clearProps: 'transform' })
      .from(q('.login-card'), { y: 34, autoAlpha: 0, scale: 0.97, duration: 0.7 }, '-=0.35')
      .from(q('.intro-ball'), { y: -90, duration: 0.8, ease: 'bounce.out' }, '-=0.5')
      .from(q('.login-card').children, { y: 10, autoAlpha: 0, stagger: 0.05, duration: 0.4 }, '-=0.6');
  }
  f.user.focus();

  // oko: zobrazit / skrýt heslo
  const eye = q('.lf-eye');
  eye.onclick = () => {
    const show = f.password.type === 'password';
    f.password.type = f.password2.type = show ? 'text' : 'password';
    eye.setAttribute('aria-pressed', String(show));
    eye.setAttribute('aria-label', show ? 'Skrýt heslo' : 'Zobrazit heslo');
  };

  const fail = (msg) => {
    $('#login-err').textContent = msg;
    f.password.value = '';
    if (setup) f.password2.value = '';
    f.password.focus();
    if (!motion()) return;
    gsap.timeline()
      .to(q('.login-card'), { keyframes: { x: [-10, 10, -7, 7, -3, 0] }, duration: 0.45, ease: 'power2.out' })
      .to(q('.intro-ball'), { keyframes: { rotation: [-18, 15, -9, 5, 0] }, duration: 0.6, transformOrigin: '50% 90%', ease: 'sine.inOut' }, 0);
  };

  return new Promise((resolve) => {
    f.onsubmit = async (e) => {
      e.preventDefault();
      $('#login-err').textContent = '';
      if (!f.user.value.trim() || !f.password.value) return fail('Vyplň jméno i heslo.');
      if (setup && f.password.value !== f.password2.value) return fail('Hesla se neshodují.');
      const btn = q('.login-go');
      btn.disabled = true;
      try {
        const r = await api('auth', { action: setup ? 'setup' : 'login', user: f.user.value, password: f.password.value, remember: f.remember.checked });
        resolve(r.user);
      } catch (x) {
        fail(x.message);
      } finally {
        btn.disabled = false;
      }
    };
  });
}

async function finishLogin(dataReady) {
  const el = $('#login'), q = (s) => $(s, el);
  if (motion()) {
    await gsap.timeline({ defaults: { ease: 'power3.out' } })
      .to(q('.intro-ball'), { rotation: 0, duration: 0.1 })
      .to(q('.ib-btn'), { scale: 1.25, backgroundColor: '#fffbe6', boxShadow: '0 0 0 4px #0a0a0a, 0 0 28px 10px rgba(242, 194, 48, .9)', duration: 0.14 })
      .addLabel('open', '+=0.08')
      .to(q('.ib-top'), { yPercent: -70, rotation: -22, duration: 0.5 }, 'open')
      .to(q('.ib-bottom'), { yPercent: 70, rotation: 12, duration: 0.5 }, 'open')
      .to(q('.ib-btn'), { scale: 0, duration: 0.25, ease: 'power2.in' }, 'open')
      .fromTo(q('.ib-flash'), { scale: 0, autoAlpha: 1 }, { scale: 70, autoAlpha: 1, duration: 0.8, ease: 'power2.in' }, 'open')
      .then();
  }
  await dataReady; // data se načítají, zatímco záře zakrývá obrazovku
  if (motion()) await gsap.to(el, { autoAlpha: 0, duration: 0.5, ease: 'power1.inOut' }).then();
  el.remove();
  document.body.classList.remove('locked');
  $('#app').inert = $('#bnav').inert = false;
}

// ---------- start ----------
async function start() {
  // adresa má přednost (odkaz, obnovení stránky), jinak naposledy otevřená sekce
  const route = parseHash();
  let v = route.v || 'overview';
  if (!route.v) try { v = localStorage.getItem('ph_view') || v; } catch {}
  const loadAll = async () => {
    loadPortfolio().catch(() => {}); // jméno a hodnota sbírky do horní lišty
    loadSets().catch(() => {}); // nejcennější karty na Přehledu a edice ve hledání
    try { await load(); } catch (e) { toast(e.message, true); }
  };
  let me = null;
  try { me = await api('auth'); } catch (e) { toast(e.message, true); }
  if (me && !me.authed) {
    // nepřihlášený: místo úvodní animace přihlašovací obrazovka (má vlastní otevření pokéballu)
    $('#intro').remove();
    await showLogin(me.setup);
    AUTHED = true;
    await finishLogin(loadAll());
  } else {
    AUTHED = !!me?.authed;
    $('#login').remove();
    const intro = playIntro();
    await loadAll();
    await intro.finish();
  }
  if (v === 'sets' && route.setId) openSet(route.setId, { push: false });
  else setView(v, { push: false });
  pushRoute(route.setId && v === 'sets' ? `#/edice/${route.setId}` : `#/${SLUG[v]}`, true);
}

start();
setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 5 * 60e3);
