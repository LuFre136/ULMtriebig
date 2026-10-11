// Holt Events aus kostenlosen Quellen, ordnet sie den App-Kategorien zu,
// ergänzt Koordinaten und schreibt alles nach data/events.json.
// Läuft per GitHub Action (siehe .github/workflows/update-events.yml), ohne Abhängigkeiten.
//
//   node scripts/fetch-events.mjs                 # live holen
//   LEO_FIXTURE=test/leo-sample.xml NO_GEOCODE=1 node scripts/fetch-events.mjs   # offline testen

import { readFile, writeFile } from 'node:fs/promises';

const LEO_URL = 'https://veranstaltungen.ulm.de/leoonline/portals/ulm/veranstaltungen/templates/rss_events.groovy?data_source=evt_rssfeed_ulm_events';
const ULM = { lat: 48.3984, lon: 9.9916 };
const OUT = new URL('../data/events.json', import.meta.url);
const GEOCACHE = new URL('../data/geocache.json', import.meta.url);
const USER_AGENT = 'ULMtriebig/1.0 (private event app; github.com/LuFre136)';
const MAX_NEW_GEOCODES = 200;

// Kategorie-Schlüssel der App -> Stichworte aus den Quellen (klein geschrieben)
const TYPE_RULES = [
  ['konzerte', ['musik', 'konzert', 'music', 'jazz', 'rock', 'pop', 'klassik', 'chor', 'orchester']],
  ['sport', ['sport', 'sports', 'fußball', 'basketball', 'lauf', 'turnier', 'eishockey', 'handball']],
  ['maerkte', ['märkte', 'markt', 'messe', 'flohmarkt', 'wochenmarkt', 'basar', 'weihnachtsmarkt']],
  ['partys', ['party', 'club', 'disco', 'clubbing', 'dj', 'tanz']],
  ['buehne', ['bühne', 'theater', 'kabarett', 'comedy', 'oper', 'musical', 'kino', 'film', 'arts & theatre']],
  ['feste', ['feste & events', 'fest', 'festival', 'feier']],
  ['ausstellungen', ['ausstellung', 'museum', 'galerie']],
  ['fuehrungen', ['führung', 'exkursion', 'stadtrundgang']],
  ['bildung', ['vortrag', 'vorträge', 'lesung', 'literatur', 'kurse', 'workshop', 'bildung', 'seminar']],
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

function berlinIso(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

function classify(texts) {
  const hay = texts.join(' | ').toLowerCase();
  const types = TYPE_RULES.filter(([, words]) => words.some((w) => hay.includes(w))).map(([k]) => k);
  return types.length ? types : ['sonstiges'];
}

// Inhalt des ersten <name>…</name> innerhalb von xml (ohne Dekodierung).
const inner = (xml, name) => xml.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`))?.[1] ?? '';
const text = (xml, name) => decode(inner(xml, name));

const euro = (v) => (+v).toLocaleString('de-DE', { minimumFractionDigits: +v % 1 ? 2 : 0, maximumFractionDigits: 2 });
function formatPrices(xml) {
  const prices = [...xml.matchAll(/<preis>([\s\S]*?)<\/preis>/g)].map(([, p]) => {
    const from = text(p, 'preiswert'), to = text(p, 'preis_bis');
    if (!from) return '';
    const amount = +from === 0 && !(+to > 0) ? 'kostenlos' : `${euro(from)}${to && +to !== +from ? `–${euro(to)}` : ''} €`;
    const kind = text(p, 'preisart').replace(/\s*\(.*?\)/g, '');
    return kind && amount !== 'kostenlos' ? `${kind} ${amount}` : amount;
  }).filter(Boolean);
  return prices.slice(0, 2).join(' · ') + (prices.length > 2 ? ' …' : '');
}

// Der Ulmer Feed (LEO) steckt seine Felder als XML in <description>:
// <termin><jahr/><monat/><tag/><uhrzeit/></termin>, <beschreibung/>,
// <kategorien><kategorie/><unterkategorie1/><unterkategorie2/></kategorien>,
// <staette><bezeichnung/><strasse/><hausnr/><plz/><ort/></staette>, <preise/>
function parseLeoItem(xml) {
  const d = inner(xml, 'description').replace(/<!\[CDATA\[|\]\]>/g, '');
  const termin = inner(d, 'termin');
  const [y, mo, day] = ['jahr', 'monat', 'tag'].map((n) => text(termin, n));
  const time = text(termin, 'uhrzeit').match(/(\d{1,2})[:.](\d{2})/);
  const start = y && mo && day
    ? `${y}-${mo.padStart(2, '0')}-${day.padStart(2, '0')}` + (time ? `T${time[1].padStart(2, '0')}:${time[2]}` : '')
    : null;
  const kat = inner(d, 'kategorien');
  const cats = [...new Set([text(kat, 'kategorie'), text(kat, 'unterkategorie1'), text(kat, 'unterkategorie2'), text(xml, 'category')]
    .flatMap((c) => c.split(/,\s*/)).filter(Boolean))];
  const st = inner(d, 'staette');
  const room = text(st, 'teilstaette');
  let venue = text(st, 'bezeichnung');
  if (room && venue.endsWith(room) && venue !== room) venue = `${venue.slice(0, -room.length).trim()}, ${room}`;
  return {
    title: text(xml, 'title'),
    subtitle: text(d, 'beschreibung'),
    start,
    end: null,
    venue,
    street: [text(st, 'strasse'), text(st, 'hausnr')].filter(Boolean).join(' '),
    zip: text(st, 'plz'),
    city: text(st, 'ort'),
    price: formatPrices(inner(d, 'preise')),
    url: text(xml, 'link') || text(xml, 'guid'),
    image: text(d, 'bild'),
    categories: cats,
    lat: null,
    lon: null,
    types: classify(cats.length ? cats : [text(xml, 'title')]),
    source: 'ulm',
  };
}

async function fetchLeo() {
  let xml;
  if (process.env.LEO_FIXTURE) xml = await readFile(process.env.LEO_FIXTURE, 'utf8');
  else {
    const res = await fetch(LEO_URL, { headers: { 'User-Agent': USER_AGENT } });
    xml = await res.text();
    console.log(`::notice::Ulm-Feed: HTTP ${res.status}, ${res.headers.get('content-type')}, ${xml.length} Zeichen`);
  }
  const raw = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/g)];
  const items = raw.map((m) => parseLeoItem(m[1])).filter((e) => e.title && e.start);
  if (raw.length && !items.length) console.log(`::warning::Ulm-Feed: ${raw.length} Einträge, aber keiner lesbar. Erster: ${raw[0][1].slice(0, 1500).replace(/\s+/g, ' ')}`);
  return items;
}

async function fetchTicketmaster() {
  const key = process.env.TICKETMASTER_API_KEY;
  if (!key) return [];
  const out = [];
  for (let page = 0; page < 5; page++) {
    const u = new URL('https://app.ticketmaster.com/discovery/v2/events.json');
    Object.entries({ apikey: key, latlong: `${ULM.lat},${ULM.lon}`, radius: '60', unit: 'km', size: '200', page: String(page), sort: 'date,asc', locale: '*' })
      .forEach(([k, v]) => u.searchParams.set(k, v));
    const res = await fetch(u);
    if (!res.ok) { console.warn('Ticketmaster', res.status); break; }
    const data = await res.json();
    for (const ev of data._embedded?.events || []) {
      const v = ev._embedded?.venues?.[0] || {};
      const cl = ev.classifications?.[0] || {};
      const cats = [cl.segment?.name, cl.genre?.name, cl.subGenre?.name].filter((c) => c && c !== 'Undefined');
      out.push({
        title: ev.name,
        subtitle: '',
        start: ev.dates?.start?.dateTime ? berlinIso(new Date(ev.dates.start.dateTime)) : ev.dates?.start?.localDate,
        end: null,
        venue: v.name || '', street: v.address?.line1 || '', zip: v.postalCode || '', city: v.city?.name || '',
        price: ev.priceRanges?.[0] ? `ab ${ev.priceRanges[0].min} ${ev.priceRanges[0].currency}` : '',
        url: ev.url, description: '', categories: cats,
        lat: v.location ? +v.location.latitude : null, lon: v.location ? +v.location.longitude : null,
        types: classify(cats), source: 'ticketmaster',
      });
    }
    if (page + 1 >= (data.page?.totalPages || 0)) break;
    await sleep(250);
  }
  return out;
}

async function geocode(events) {
  let cache = {};
  try { cache = JSON.parse(await readFile(GEOCACHE, 'utf8')); } catch {}
  let fresh = 0;
  for (const e of events) {
    if (e.lat != null) continue;
    const queries = [
      [e.street, `${e.zip} ${e.city}`].filter((s) => s.trim()).join(', '),
      `${e.zip} ${e.city}`.trim(),
    ].filter(Boolean);
    for (const q of queries) {
      if (!(q in cache)) {
        if (process.env.NO_GEOCODE || fresh >= MAX_NEW_GEOCODES) continue;
        const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=de&q=${encodeURIComponent(q)}`;
        try {
          const r = await (await fetch(u, { headers: { 'User-Agent': USER_AGENT } })).json();
          cache[q] = r[0] ? [+(+r[0].lat).toFixed(5), +(+r[0].lon).toFixed(5)] : null;
        } catch { cache[q] = null; }
        fresh++;
        await sleep(1100); // Nominatim-Regel: max. 1 Anfrage pro Sekunde
      }
      if (cache[q]) { [e.lat, e.lon] = cache[q]; break; }
    }
  }
  await writeFile(GEOCACHE, JSON.stringify(cache, null, 0));
  console.log(`Geocoding: ${fresh} neue Abfragen`);
}

const hash = (s) => [...s].reduce((h, c) => (Math.imul(31, h) + c.charCodeAt(0)) | 0, 7).toString(36);

const results = await Promise.allSettled([fetchLeo(), fetchTicketmaster()]);
const sources = ['Veranstaltungskalender Ulm/Neu-Ulm', 'Ticketmaster'];
let events = [];
results.forEach((r, i) => {
  if (r.status === 'fulfilled') { console.log(`${sources[i]}: ${r.value.length} Events`); events.push(...r.value); }
  else console.log(`::warning::${sources[i]} fehlgeschlagen: ${r.reason?.message} ${r.reason?.cause?.message || ''}`);
});

const today = berlinIso(new Date()).slice(0, 10);
events = events.filter((e) => (e.end || e.start).slice(0, 10) >= today);
const seen = new Set();
events = events.filter((e) => {
  const k = `${e.title.toLowerCase()}|${e.start.slice(0, 10)}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
await geocode(events);
events.sort((a, b) => a.start.localeCompare(b.start));
for (const e of events) e.id = hash(`${e.source}|${e.title}|${e.start}|${e.venue}`);

if (!events.length && !process.env.LEO_FIXTURE) {
  console.log('::error::Keine Events gefunden – alte Datei bleibt erhalten.');
  process.exitCode = 1;
  process.exit();
}
await writeFile(OUT, JSON.stringify({ generated: new Date().toISOString(), count: events.length, events }, null, 1));
console.log(`${events.length} Events gespeichert.`);
