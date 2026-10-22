// Sbírka (portfolio): karty a zapečetěné produkty, které mám. Ceny bere z uložených edic (PokeData).
// PokeData dává jen aktuální průměr, žádnou historii — tu si skládáme sami:
//   portfolio            — položky sbírky a profil (píše jen uživatel)
//   pricehist/<setId>    — denní ceny vlastněných položek té edice (píše jen cron-sets po obnově edice)
import { getJson, setJson } from './store.js';

export const GRADES = ['raw', 'psa9', 'psa10'];
const HIST_DAYS = 400;

// Stejná karta v jiném stavu (raw / PSA 10) je jiná položka, protože má jinou cenu.
export const itemId = (kind, refId, grade) => (kind === 'card' ? `c:${refId}:${grade}` : `p:${refId}`);

export const findRef = (d, kind, refId) =>
  kind === 'card' ? d?.cards?.find((c) => c.id === refId) : d?.products?.find((p) => p.id === refId);

export function refUsd(d, it) {
  const r = findRef(d, it.kind, it.refId);
  if (!r) return null;
  return (it.kind === 'card' ? r[it.grade] : r.usd) ?? null;
}

export async function getPortfolio() {
  const p = await getJson('portfolio', {});
  return { items: p.items || [], profile: p.profile || {} };
}

// Po obnově edice zapíše dnešní ceny vlastněných položek z té edice (jeden bod za den).
export async function recordPrices(d, items) {
  const mine = items.filter((i) => i.setId === d.id);
  if (!mine.length) return;
  const key = `pricehist/${d.id}`;
  const hist = await getJson(key, {});
  const day = new Date().toISOString().slice(0, 10);
  for (const it of mine) {
    const usd = refUsd(d, it);
    if (usd == null) continue;
    const arr = (hist[it.id] ||= []);
    if (arr.at(-1)?.[0] === day) arr[arr.length - 1][1] = usd;
    else arr.push([day, usd]);
    if (arr.length > HIST_DAYS) arr.splice(0, arr.length - HIST_DAYS);
  }
  await setJson(key, hist);
}
