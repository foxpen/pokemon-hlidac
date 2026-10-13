# Pokémon hlídač

Webovka, která hlídá **Pokémon TCG na českém trhu**: nové produkty a předprodeje v CZ e-shopech, sklad a ceny konkrétních produktů a novinky / ohlášení setů. Změny posílá do **Telegramu** a/nebo **Discordu**.

Stack: statický web (`public/`) + Netlify Functions (Node, ESM) + Netlify Blobs jako úložiště. Žádná databáze, žádný build krok.

## Co umí

| Záložka | Co dělá |
|---|---|
| **Přehled** | Úvodní stránka: novinky, **Chystá se** (vydání, předprodeje, ohlášené sety), **Co letí** (produkty vyprodané ve většině obchodů / nedávno vyprodané), **Právě v prodeji** (nové a znovu naskladněné, nejlevnější obchod), časová osa událostí, tvoje hlídané |
| **Hlídám** | Produkty jako trenérské karty (cena místo HP, holo lesk). Vložíš URL produktu z libovolného CZ e-shopu → kontrola každých 10 min. Upozorní na naskladnění, spuštění předprodeje a zlevnění (volitelně až pod cílovou cenu). Graf vývoje ceny. |
| **Trh CZ** | Katalog Pokémon produktů ze všech skenovaných obchodů. Hledání napříč obchody („pitch black etb“) seřadí nabídky a ukáže nejlevnější dostupnou. |
| **Kalendář** | Data vydání z předprodejů (Černý rytíř je uvádí) + ručně přidané termíny |
| **Novinky** | PokeGuardian (ohlášení produktů a setů), Google News EN „Pokémon TCG“, Google News CZ „pokémon karty“ |
| **Nastavení** | Stav notifikací + testovací zpráva, filtry notifikací, stav obchodů, ruční sken |

## Obchody

| Obchod | Sken nových produktů | Hlídání URL | Jak |
|---|---|---|---|
| Černý rytíř | ✅ | ✅ | jejich veřejné API (web je JS aplikace); sklad e-shop + prodejna, předprodej, datum vydání |
| Veselý drak | ✅ (vč. předprodeje) | ✅ | HTML (vlastní parser, nemají schema.org) |
| Sparkys | ✅ | ✅ | HTML + dataLayer |
| Tlama Games | ✅ (vč. předprodeje) | ✅ | Shoptet, schema.org |
| Imago | ✅ | ✅ | schema.org |
| Xzone | ✅ | ✅ | schema.org |
| Svět her | ✅ | ✅ | schema.org |
| Planeta her | ✅ (vč. předprodeje) | ✅ | Shoptet, schema.org |
| TCGshop | ✅ | ✅ | Shoptet, schema.org |
| Najáda, Dráčik | ❌ (výpis renderuje JS) | ✅* | schema.org na detailu |
| Jiný CZ e-shop | ❌ | ✅* | obecný parser (JSON-LD / microdata / og meta) |
| **Alza, Smarty** | ❌ | ❌ | aktivně blokují automatický přístup (TLS otisk) — neobcházíme |

\* funguje, pokud stránka produktu má strukturovaná data (většina CZ e-shopů). Když ne, karta v „Hlídám“ to napíše.

**První sken obchodu jen zapamatuje, co tam je** — hlásit začne až nové věci. Katalog se doplňuje postupně (každý běh dočte pár detailů produktů).

## Nasazení na Netlify

1. Nahraj složku do nového GitHub repa a v Netlify: **Add new site → Import from Git**. Build command nech prázdný, publish dir `public` je v `netlify.toml`.
2. **Site configuration → Environment variables** nastav:

| Proměnná | Povinná | Popis |
|---|---|---|
| `APP_PASSWORD` | ✅ | heslo do webu |
| `SESSION_SECRET` | ✅ | náhodný řetězec ≥ 32 znaků (podpis cookie) |
| `TELEGRAM_BOT_TOKEN` | – | token bota od @BotFather |
| `TELEGRAM_CHAT_ID` | – | kam bot píše (tvoje chat ID) |
| `DISCORD_WEBHOOK_URL` | – | webhook kanálu |

3. Po změně env proměnných **Deploys → Trigger deploy**.
4. Otevři web → Nastavení → **Poslat testovací zprávu**.

Naplánované funkce (`cron-stock` každých 10 min, `cron-scan` každých 30 min) běží jen na produkčním deployi, ne v preview.

### Telegram
1. V Telegramu napiš **@BotFather** → `/newbot` → dostaneš token → `TELEGRAM_BOT_TOKEN`.
2. Napiš svému novému botovi cokoli (třeba „ahoj“).
3. Otevři `https://api.telegram.org/bot<TOKEN>/getUpdates` → v odpovědi najdi `"chat":{"id":123456789` → to je `TELEGRAM_CHAT_ID`.

### Discord
Nastavení kanálu → **Integrace → Webhooky → Nový webhook → Kopírovat URL** → `DISCORD_WEBHOOK_URL`.

## Lokální běh

```bash
npm install
npm run dev        # netlify dev (npx netlify-cli) na http://localhost:8888
```

Lokálně je potřeba `.env` s `APP_PASSWORD` a `SESSION_SECRET` (soubor je v `.gitignore`). Netlify Blobs fungují v `netlify dev` lokálně. Cron lokálně neběží — použij v Nastavení „Skenovat teď“ / „Zkontrolovat hlídané“.

Testy parserů proti živým webům:

```bash
node scripts/test-scan.mjs            # všechny obchody
node scripts/test-scan.mjs tlama      # jeden obchod
node scripts/test-notify.mjs          # náhled zpráv pro Telegram/Discord (nic neodešle)
```

## Údržba

- **Obchod hlásí chybu „kategorie nevrátila žádné produkty“** → změnil se web. Uprav `scan` URL nebo `productRe` v `netlify/functions/_lib/shops.js`, ověř `node scripts/test-scan.mjs <id>`.
- **Přidání obchodu** → nový záznam v `SHOPS` (`scan` = kategorie řazená od nejnovějších, `productRe` = tvar cesty produktu). Pokud produkt nemá schema.org, přidej úpravu do `SITE_FIXES` v `_lib/product.js`.
- **Limity Netlify**: naplánovaná funkce má 30 s, běžná 10 s. Úlohy mají deadline a co nestihnou, dodělají v dalším běhu.

## Plán

- Tržní ceny (PokeData, PriceCharting) → srovnání CZ cen s cenou na trhu. PriceCharting je za Cloudflare, cesta je jejich oficiální API (placený token). PokeData jde číst.
