const TYPES = {
  konzerte: 'Konzerte',
  sport: 'Sport',
  maerkte: 'Märkte',
  partys: 'Partys',
  buehne: 'Bühne & Kino',
  feste: 'Feste',
  ausstellungen: 'Ausstellungen',
  fuehrungen: 'Führungen',
  bildung: 'Vorträge & Kurse',
  sonstiges: 'Sonstiges',
};
const ULM = { name: 'Ulm', lat: 48.3984, lon: 9.9916 };
const DEFAULTS = { place: ULM, radius: 5, days: 14, types: ['konzerte', 'sport', 'maerkte', 'partys'] };
const STORE_KEY = 'ulmtriebig-settings';

const $ = (id) => document.getElementById(id);
let settings = loadSettings();
let data = { events: [] };

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.place && s.types) return { ...DEFAULTS, ...s };
  } catch {}
  return structuredClone(DEFAULTS);
}
function saveSettings() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch {}
  render();
}

function distanceKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const pad = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function dayLabel(iso) {
  const today = new Date();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const day = iso.slice(0, 10);
  if (day === localDay(today)) return 'Heute';
  if (day === localDay(tomorrow)) return 'Morgen';
  return new Date(day + 'T12:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}

function visibleEvents() {
  const from = localDay(new Date());
  const until = new Date(); until.setDate(until.getDate() + settings.days - 1);
  const to = localDay(until);
  const wanted = new Set(settings.types);
  return data.events
    .filter((e) => e.lat != null && (e.end || e.start).slice(0, 10) >= from && e.start.slice(0, 10) <= to)
    .filter((e) => e.types.some((t) => wanted.has(t)))
    .map((e) => ({ ...e, km: distanceKm(settings.place, e) }))
    .filter((e) => e.km <= settings.radius);
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) n.setAttribute(k, v);
  }
  n.append(...kids.flat().filter((k) => k != null && k !== ''));
  return n;
}

function icsFor(e) {
  const fmt = (iso) => iso.replace(/[-:]/g, '').padEnd(13, 'T0000').slice(0, 13) + '00';
  const allDay = e.start.length === 10;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ULMtriebig//DE', 'BEGIN:VEVENT',
    `UID:${e.id}@ulmtriebig`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
    allDay ? `DTSTART;VALUE=DATE:${e.start.replace(/-/g, '')}` : `DTSTART;TZID=Europe/Berlin:${fmt(e.start)}`,
    !allDay && e.end && e.end.length > 10 ? `DTEND;TZID=Europe/Berlin:${fmt(e.end)}` : null,
    `SUMMARY:${e.title.replace(/[,;]/g, '\\$&')}`,
    `LOCATION:${[e.venue, e.street, `${e.zip} ${e.city}`.trim()].filter(Boolean).join(', ').replace(/[,;]/g, '\\$&')}`,
    e.url ? `URL:${e.url}` : null,
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean);
  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(lines.join('\r\n'));
}

function renderChips() {
  $('chips').replaceChildren(...Object.entries(TYPES).map(([key, label]) =>
    el('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(settings.types.includes(key)),
      onclick: () => {
        settings.types = settings.types.includes(key) ? settings.types.filter((t) => t !== key) : [...settings.types, key];
        saveSettings();
      },
    }, label)));
}

function render() {
  renderChips();
  const events = visibleEvents();
  const radius = `${settings.radius} km um ${settings.place.name}`;
  $('summary').textContent = `${events.length} ${events.length === 1 ? 'Event' : 'Events'} · ${radius}`;

  if (!events.length) {
    $('list').replaceChildren(el('div', { class: 'empty' },
      el('p', {}, data.events.length ? 'Keine passenden Events in diesem Umkreis und Zeitraum.' : 'Noch keine Eventdaten geladen.'),
      data.events.length ? el('button', { type: 'button', class: 'chip', onclick: () => { settings.radius = Math.min(50, settings.radius * 2); saveSettings(); } }, 'Umkreis vergrößern') : null));
    return;
  }

  const groups = new Map();
  for (const e of events) {
    const day = e.start.slice(0, 10) < localDay(new Date()) ? localDay(new Date()) : e.start.slice(0, 10);
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(e);
  }
  const out = [];
  for (const [day, list] of groups) {
    out.push(el('h2', { class: 'day' }, dayLabel(day)));
    for (const e of list) {
      const time = e.start.length > 10 ? e.start.slice(11, 16) : 'ganztags';
      const maps = `https://maps.apple.com/?q=${encodeURIComponent(e.venue || e.title)}&ll=${e.lat},${e.lon}`;
      out.push(el('article', { class: 'event' },
        el('div', { class: 'time' }, time),
        el('div', {},
          el('h3', {}, e.title),
          e.subtitle ? el('p', { class: 'sub' }, e.subtitle) : null,
          el('div', { class: 'meta' },
            ...e.types.filter((t) => t !== 'sonstiges').map((t) => el('span', { class: 'tag' }, TYPES[t])),
            el('span', {}, `${e.venue || e.city} · ${e.km < 1 ? Math.round(e.km * 1000) + ' m' : e.km.toFixed(1).replace('.', ',') + ' km'}`),
            e.price ? el('span', {}, e.price) : null),
          el('div', { class: 'actions' },
            e.url ? el('a', { href: e.url, target: '_blank', rel: 'noopener' }, 'Details') : null,
            el('a', { href: maps, target: '_blank', rel: 'noopener' }, 'Karte'),
            el('a', { href: icsFor(e), download: `${e.title.slice(0, 40)}.ics` }, 'In Kalender')))));
    }
  }
  $('list').replaceChildren(...out);
}

// --- Einstellungen ---------------------------------------------------------
function fillSettings() {
  $('radius').value = settings.radius;
  $('radius-label').textContent = `${settings.radius} km`;
  $('days').value = settings.days;
  $('place-current').textContent = `Aktuell: ${settings.place.name}`;
  $('type-toggles').replaceChildren(...Object.entries(TYPES).map(([key, label]) =>
    el('label', {}, el('input', {
      type: 'checkbox', checked: settings.types.includes(key),
      onchange: (ev) => {
        settings.types = ev.target.checked ? [...settings.types, key] : settings.types.filter((t) => t !== key);
        saveSettings();
      },
    }), label)));
}

function setPlace(place) {
  settings.place = place;
  $('place-results').replaceChildren();
  fillSettings();
  saveSettings();
}

$('open-settings').addEventListener('click', () => { fillSettings(); $('settings').showModal(); });
$('radius').addEventListener('input', (ev) => {
  settings.radius = +ev.target.value;
  $('radius-label').textContent = `${settings.radius} km`;
  saveSettings();
});
$('days').addEventListener('change', (ev) => { settings.days = +ev.target.value; saveSettings(); });
$('use-ulm').addEventListener('click', () => setPlace(ULM));
$('reset').addEventListener('click', () => { settings = structuredClone(DEFAULTS); fillSettings(); saveSettings(); });
$('use-gps').addEventListener('click', () => {
  $('place-current').textContent = 'Standort wird ermittelt …';
  navigator.geolocation.getCurrentPosition(
    (p) => setPlace({ name: 'meinem Standort', lat: p.coords.latitude, lon: p.coords.longitude }),
    () => { $('place-current').textContent = 'Standort nicht verfügbar. Bitte in den iPhone-Einstellungen für Safari erlauben.'; },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
});
async function searchPlace() {
  const q = $('place-input').value.trim();
  if (!q) return;
  $('place-results').replaceChildren(el('li', {}, el('small', {}, 'Suche …')));
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=de&accept-language=de&q=${encodeURIComponent(q)}`;
    const res = await (await fetch(url)).json();
    $('place-results').replaceChildren(...(res.length ? res.map((r) => el('li', {}, el('button', {
      type: 'button',
      onclick: () => setPlace({ name: r.display_name.split(',')[0], lat: +r.lat, lon: +r.lon }),
    }, r.display_name))) : [el('li', {}, el('small', {}, 'Nichts gefunden.'))]));
  } catch {
    $('place-results').replaceChildren(el('li', {}, el('small', {}, 'Suche gerade nicht möglich (offline?).')));
  }
}
$('place-search').addEventListener('click', searchPlace);
$('place-input').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); searchPlace(); } });

// --- Daten laden -----------------------------------------------------------
async function load() {
  try {
    const res = await fetch('data/events.json', { cache: 'no-cache' });
    data = await res.json();
    const when = new Date(data.generated);
    $('updated').textContent = `Stand: ${when.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}`;
  } catch {
    $('updated').textContent = 'Eventdaten konnten nicht geladen werden.';
  }
  render();
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
render();
load();
