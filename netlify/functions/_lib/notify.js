// Notifikace: Telegram bot a/nebo Discord webhook — co je v env nastavené, tam to jde.
//   TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
//   DISCORD_WEBHOOK_URL
import { AVAIL } from './product.js';

const ICON = {
  new_product: '🆕',
  restock: '✅',
  preorder: '📝',
  price_drop: '💸',
  news: '📰',
  announced: '📣',
  test: '🔔',
};

const LABEL = {
  new_product: 'Nový produkt',
  restock: 'Zpět skladem',
  preorder: 'Předprodej spuštěn',
  price_drop: 'Zlevnění',
  news: 'Novinka',
  announced: 'Ohlášeno',
  test: 'Test',
};

const esc = (s = '') => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
export const fmtPrice = (p) => (p == null ? '' : `${Math.round(p).toLocaleString('cs-CZ')} Kč`);

function lines(ev) {
  const out = [];
  if (ev.shop) out.push(ev.shop);
  if (ev.price != null) {
    out.push(ev.oldPrice != null && ev.oldPrice !== ev.price ? `${fmtPrice(ev.oldPrice)} → ${fmtPrice(ev.price)}` : fmtPrice(ev.price));
  }
  if (ev.availability && ev.type !== 'news') out.push(AVAIL[ev.availability] || ev.availability);
  if (ev.releaseDate) out.push(`vydání ${new Date(ev.releaseDate).toLocaleDateString('cs-CZ')}`);
  return out.join(' · ');
}

export function configured() {
  return {
    telegram: !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
    discord: !!process.env.DISCORD_WEBHOOK_URL,
  };
}

async function telegram(ev) {
  // „Hlídka hlásí: zpět skladem“
  const label = String(LABEL[ev.type] || ev.type);
  const text = `${ICON[ev.type] || '•'} <b>Hlídka hlásí: ${esc(label.charAt(0).toLowerCase() + label.slice(1))}</b>\n${esc(ev.title)}\n${esc(lines(ev))}${ev.url ? `\n${esc(ev.url)}` : ''}`;
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
  });
  if (!res.ok) throw new Error(`Telegram ${res.status}: ${await res.text()}`);
}

async function discord(ev) {
  const res = await fetch(process.env.DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'Pokémon Hlídka',
      embeds: [{
        title: `${ICON[ev.type] || ''} ${LABEL[ev.type] || ev.type}: ${ev.title}`.slice(0, 250),
        url: ev.url || undefined,
        description: lines(ev) || undefined,
        thumbnail: ev.image ? { url: ev.image } : undefined,
        color: { new_product: 0xffcb05, restock: 0x3fb950, preorder: 0x58a6ff, price_drop: 0xf0883e, news: 0xa371f7, announced: 0xb386ee }[ev.type],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text()}`);
}

const MAX_SINGLE = 8;

// Pošle události; když jich je moc najednou (např. obchod přidal 30 produktů), zbytek shrne do jedné zprávy.
export async function notify(events) {
  if (!events.length) return { sent: 0, errors: [] };
  const cfg = configured();
  const senders = [cfg.telegram && telegram, cfg.discord && discord].filter(Boolean);
  const errors = [];
  let list = events.slice(0, MAX_SINGLE);
  if (events.length > MAX_SINGLE) {
    const rest = events.slice(MAX_SINGLE);
    list.push({
      type: 'new_product',
      title: `…a dalších ${rest.length} změn`,
      shop: [...new Set(rest.map((e) => e.shop).filter(Boolean))].join(', '),
    });
  }
  for (const ev of list) {
    for (const send of senders) {
      try { await send(ev); } catch (e) { errors.push(e.message); }
    }
  }
  return { sent: senders.length ? list.length : 0, errors, channels: cfg };
}
