# Pokémon Hlídka

Webovka, která hlídá **Pokémon TCG na českém trhu**: nové produkty a předprodeje v CZ e-shopech, sklad a ceny konkrétních produktů a novinky / ohlášení setů. Změny posílá do **Telegramu** a/nebo **Discordu**.

Stack: statický web (`public/`) + Netlify Functions (Node, ESM) + Netlify Blobs jako úložiště. Žádná databáze, žádný build krok.

## Co umí

| Záložka | Co dělá |
|---|---|
| **Přehled** | Úvodní stránka: novinky, **Chystá se** (vydání, předprodeje, ohlášené sety), **Co letí** (produkty vyprodané ve většině obchodů / nedávno vyprodané), **Právě v prodeji** (nové a znovu naskladněné, nejlevnější obchod), časová osa událostí, tvoje hlídané |
| **Hlídám** | Produkty jako trenérské karty (cena místo HP, holo lesk). Vložíš URL produktu z libovolného CZ e-shopu → kontrola každou hodinu. Upozorní na naskladnění, spuštění předprodeje a zlevnění (volitelně až pod cílovou cenu). Graf vývoje ceny. |
| **Edice** | Všechny anglické a japonské sety za posledních 8 let (PokeData): logo, nejdražší karta, hodnota top 10 karet a celého setu, cena balíčku a **chase index** (top 10 karet ÷ cena 36 balíčků, orientační). Detail: galerie nejdražších karet (raw + PSA 10), zapečetěné produkty trh USA vs. nejlevnější nabídka v ČR. |
| **Trh CZ** | Katalog Pokémon produktů ze všech skenovaných obchodů. Hledání napříč obchody („pitch black etb“) seřadí nabídky a ukáže nejlevnější dostupnou. |
| **Kalendář** | Data vydání z předprodejů (pokud je obchod uvádí) + ručně přidané termíny |
| **Novinky** | PokeGuardian (ohlášení produktů a setů), Google News EN „Pokémon TCG“, Google News CZ „pokémon karty“ |
| **Nastavení** | Stav notifikací + testovací zpráva, filtry notifikací, stav obchodů, ruční sken |



\* funguje, pokud stránka produktu má strukturovaná data (většina CZ e-shopů). Když ne, karta v „Hlídám“ to napíše.

**První sken obchodu jen zapamatuje, co tam je** — hlásit začne až nové věci. Katalog se doplňuje postupně (každý běh dočte pár detailů produktů).

## Nasazení na Netlify

1. Nahraj složku do nového GitHub repa a v Netlify: **Add new site → Import from Git**. Build command nech prázdný, publish dir `public` je v `netlify.toml`.
2. **Site configuration → Environment variables** nastav:

| Proměnná | Povinná | Popis |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | – | token bota od @BotFather |
| `TELEGRAM_CHAT_ID` | – | kam bot píše (tvoje chat ID) |
| `DISCORD_WEBHOOK_URL` | – | webhook kanálu |
| `SESSION_SECRET` | – | klíč k podpisu přihlášení (aspoň 32 znaků). Bez něj se vygeneruje sám a uloží do Blobs. |

3. Po změně env proměnných **Deploys → Trigger deploy**.
4. **Hned po prvním nasazení otevři web a založ si účet** (jméno + heslo). Dokud žádný účet neexistuje, může ho založit kdokoli, kdo web otevře. Další účty pak přidáš v Nastavení.
5. Otevři web → Nastavení → **Poslat testovací zprávu** (jen když jsi nastavil Telegram nebo Discord).

### Přihlášení

Web je za přihlášením: účty (jméno + heslo) jsou v Netlify Blobs, heslo jen jako otisk (scrypt se solí), přihlášení drží podepsaná cookie (30 dní se „Zapamatovat si mě“, jinak do zavření prohlížeče). Po 5 špatných pokusech je jméno na 5 minut zamčené. Změna nebo reset hesla odhlásí všechna ostatní zařízení toho účtu, smazání účtu ho odhlásí všude. V Nastavení jde změnit heslo, přidat účet, nastavit nové heslo jinému účtu (když ho zapomene) a odhlásit se. Všechny účty vidí stejná data.

Naplánované funkce (`cron-scan` v :00, `cron-stock` v :15 a `cron-sets` v :30, každá jednou za hodinu) běží jen na produkčním deployi, ne v preview. Edice se po nasazení plní postupně (PokeData omezuje počet požadavků): nejnovější sety během první hodiny, všech ~165 zhruba za 28 hodin a stejně často se pak obnovují. Edice, ze kterých máš něco ve sbírce, mají přednost a jejich ceny se ukládají každý den.

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

Při prvním lokálním spuštění si web řekne o založení účtu (lokální účty jsou jen v `.netlify/`). Volitelné tokeny pro notifikace dej lokálně do `.env` (je v `.gitignore`). Netlify Blobs fungují v `netlify dev` lokálně. Cron lokálně neběží — použij v Nastavení „Skenovat teď“ / „Zkontrolovat hlídané“.

Testy parserů proti živým webům:

```bash
node scripts/test-scan.mjs            # všechny obchody
node scripts/test-scan.mjs <id>       # jeden obchod (id ze shops.js)
node scripts/test-notify.mjs          # náhled zpráv pro Telegram/Discord (nic neodešle)
```

## Údržba

- **Obchod hlásí chybu „kategorie nevrátila žádné produkty“** → změnil se web. Uprav `scan` URL nebo `productRe` v `netlify/functions/_lib/shops.js`, ověř `node scripts/test-scan.mjs <id>`.
- **Přidání obchodu** → nový záznam v `SHOPS` (`scan` = kategorie řazená od nejnovějších, `productRe` = tvar cesty produktu). Pokud produkt nemá schema.org, přidej úpravu do `SITE_FIXES` v `_lib/product.js`.
- **Limity Netlify**: naplánovaná funkce má 30 s, běžná 10 s. Úlohy mají deadline a co nestihnou, dodělají v dalším běhu.

## Plán

- Tržní ceny (PokeData, PriceCharting) → srovnání CZ cen s cenou na trhu. PriceCharting je za Cloudflare, cesta je jejich oficiální API (placený token). PokeData jde číst.
