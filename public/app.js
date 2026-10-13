// Pokémon hlídač — dashboard. Bez build kroku, data přes /.netlify/functions/*.
const API = '/.netlify/functions';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const AVAIL = { in_stock: 'Skladem', preorder: 'Předprodej', out_of_stock: 'Nedostupné', unknown: 'Neznámo' };
const EV = { new_product: 'Nový produkt', restock: 'Zpět skladem', preorder: 'Předprodej', price_drop: 'Zlevnění', sold_out: 'Vyprodáno', news: 'Novinka' };
const BUYABLE = new Set(['in_stock', 'preorder']);
const DAY = 86400e3;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

let S = null; // poslední stav ze serveru

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

// ---------- views ----------
const shownViews = new Set();
function setView(v) {
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $$('.content > section').forEach((s) => (s.hidden = s.dataset.view !== v));
  try { localStorage.setItem('ph_view', v); } catch {}
  if (v === 'sets' && !SETS.data && S) loadSets().then(() => animateIn($$('#set-grid .set-tile').slice(0, 16), { stagger: 0.03 })).catch((e) => toast(e.message, true));
  if (S && !shownViews.has(v)) {
    shownViews.add(v);
    const sec = $(`.content > section[data-view="${v}"]`);
    animateIn(sec.querySelectorAll('.ov-hero, .stat, .ov-grid > .panel, :scope > .panel, :scope > .hint, .table-wrap, .tcard, .news-card, .grid-2 > *'), { stagger: 0.035 });
  }
}
$('#tabs').addEventListener('click', (e) => { if (e.target.dataset.view) setView(e.target.dataset.view); });
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  if (go) { setView(go.dataset.go); window.scrollTo({ top: 0, behavior: REDUCED ? 'auto' : 'smooth' }); }
});

async function load() {
  S = await api('state');
  S.groups = groupCatalog(S.catalog);
  render();
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
  return [...auto, ...manual].filter((x) => x.date >= from).sort((a, b) => a.date.localeCompare(b.date));
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
    .slice(0, 7);
  $('#selling').innerHTML = sell.length ? sell.map((g) => {
    const c = g.cheapest;
    const inShops = g.items.filter((i) => BUYABLE.has(i.availability)).length;
    return `<li>
      ${img(g.image)}
      <div>
        ${ext(c.url, esc(g.name))}
        <span class="meta">${g.restocked ? '<span class="tag t-restock">znovu skladem</span> · ' : ''}${esc(c.shop)}${inShops > 1 ? ` · skladem v ${inShops} obchodech` : ''}</span>
      </div>
      <span class="num mono">${price(c.price)}<small>nejlevněji</small></span>
    </li>`;
  }).join('') : `<li class="empty">Nic skladem</li>`;
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
const tilt = { el: null };
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
  tilt.el = frame;
  gsap.to(frame, { rotationY: (px - 0.5) * 10, rotationX: (0.5 - py) * 8, transformPerspective: 900, duration: 0.4, ease: 'power2.out', overwrite: 'auto' });
});
$('#watch-list').addEventListener('pointerout', (e) => {
  const frame = e.target.closest('.tcard-frame');
  if (!frame || frame.contains(e.relatedTarget) || !motion()) return;
  gsap.to(frame, { rotationY: 0, rotationX: 0, duration: 0.7, ease: 'elastic.out(1, 0.6)', overwrite: 'auto' });
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
  SETS.loading = api('sets').then((d) => { SETS.data = d; renderSetFilters(); renderSets(); }).finally(() => (SETS.loading = null));
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
    $$('.seg button').forEach((b) => b.classList.toggle('on', b === seg));
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

async function openSet(id) {
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
        ${d.top.slice(0, 24).map((c, n) => `
          <div class="pcard">
            <div class="img"><span class="rank">#${n + 1}</span>${c.img ? `<img src="${safeUrl(c.img)}" alt="${esc(c.name)}" loading="lazy" referrerpolicy="no-referrer">` : ''}</div>
            <b>${esc(c.name)}</b>
            <div class="price-row"><span class="num mono">${kc(c.raw)}</span><small>${c.num ? `#${esc(c.num)}` : ''}</small></div>
            ${c.psa10 ? `<small>PSA 10: ${kc(c.psa10)}</small>` : ''}
          </div>`).join('')}
      </div>
    </div>

    <div class="grid-2 mt">
      <div class="panel">
        <div class="panel-head"><h2>Zapečetěné produkty: trh USA vs. ČR</h2></div>
        <div class="table-wrap">
          <table class="table compact prod-table">
            <thead><tr><th>Produkt</th><th class="num">Trh USA</th><th class="num">Nejlevněji v ČR</th><th class="num">Rozdíl</th></tr></thead>
            <tbody>
              ${sealed.map((p) => {
                const cz = czBest(p.kind);
                const diff = cz && czk(p.usd) ? (cz.price / czk(p.usd) - 1) * 100 : null;
                return `<tr>
                  <td class="name">${img(p.img, 'thumb', p.name)}<span>${esc(p.name)}</span></td>
                  <td class="num">${kc(p.usd)}</td>
                  <td class="num">${cz ? `${ext(cz.url, price(cz.price))}<div class="meta">${esc(cz.shop)}</div>` : '<span class="muted">—</span>'}</td>
                  <td class="num ${diff == null ? '' : diff <= 0 ? 'diff-good' : 'diff-bad'}">${diff == null ? '' : `${diff > 0 ? '+' : ''}${Math.round(diff)} %`}</td>
                </tr>`;
              }).join('') || '<tr><td colspan="4" class="empty">PokeData pro tuhle edici nemá ceny produktů.</td></tr>'}
              ${others.map((p) => `<tr><td class="name">${img(p.img, 'thumb', p.name)}<span class="muted">${esc(p.name)}</span></td><td class="num">${kc(p.usd)}</td><td></td><td></td></tr>`).join('')}
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
  animateIn($$('#set-detail .set-hero, #set-detail .stat, #set-detail .panel, #set-detail .pcard').slice(0, 30), { stagger: 0.02 });
}

$('#set-detail').addEventListener('click', (e) => {
  if (!e.target.closest('[data-back]')) return;
  $('#set-detail').hidden = true;
  $('#sets-list').hidden = false;
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

// ---------- start ----------
async function start() {
  let v = 'overview';
  try { v = localStorage.getItem('ph_view') || v; } catch {}
  try { await load(); } catch (e) { toast(e.message, true); }
  setView(v);
}

start();
setInterval(() => { if (!document.hidden) load().catch(() => {}); }, 5 * 60e3);
