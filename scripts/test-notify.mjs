// Ověří formát zpráv bez odeslání: podvrhne fetch a vypíše, co by šlo ven.
process.env.TELEGRAM_BOT_TOKEN = 'TEST'; process.env.TELEGRAM_CHAT_ID = '1';
process.env.DISCORD_WEBHOOK_URL = 'https://discord.invalid/webhook';
globalThis.fetch = async (url, opts) => { console.log('→', url.replace(/bot[^/]+/, 'bot***')); console.log(JSON.stringify(JSON.parse(opts.body), null, 1).slice(0, 600)); return { ok: true, text: async () => '' }; };
const { notify } = await import('../netlify/functions/_lib/notify.js');
console.log(await notify([{ type: 'price_drop', title: 'Pokémon Pitch Black Booster Bundle <test & co>', url: 'https://www.vesely-drak.cz/x', shop: 'Veselý drak', price: 1199, oldPrice: 1499, availability: 'in_stock', image: 'https://example.com/a.jpg' }]));
