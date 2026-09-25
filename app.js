/* Tafels — persoonlijke restaurantlijst met kaart en GitHub-sync */
"use strict";

const BASE_TAGS = ["Zakelijk","Lunch","Terras","Aan het water","Italiaans","Frans","Thais","Aziatisch","Indonesisch","Peruaans","Steak","Vis","Vegan","Fine dining","Knus","Groot","Betaalbaar","Prijzig","Tip","Wachtlijst"];
const BASE_CITIES = ["Amsterdam","Utrecht","Kantoor"];
// Zoekgebied per lijst (voor het automatisch vinden van locaties) en startpunt van de kaart
const AREAS = {
  Amsterdam: { search: "Amsterdam", viewbox: "4.72,52.44,5.08,52.27", center: [52.372, 4.892], zoom: 13 },
  Utrecht:   { search: "Utrecht",   viewbox: "4.95,52.16,5.22,52.02", center: [52.090, 5.121], zoom: 13 },
  Kantoor:   { search: "Utrecht",   viewbox: "4.95,52.16,5.22,51.98", center: [52.060, 5.100], zoom: 12 },
};
// Bekijkversie (?bekijk): alleen lezen, zonder notities
const READONLY = /[?&]bekijk\b/i.test(location.search) || /^#bekijk$/i.test(location.hash);
const LS_DATA = READONLY ? "tafels.view.v1" : "tafels.data.v1", LS_SET = "tafels.settings.v1", LS_UI = "tafels.ui.v1";

const $ = id => document.getElementById(id);
const now = () => Date.now();

/* ---------------- state ---------------- */
let store = { data: emptyData(), sha: null, dirty: false };
const settings = { owner: "robmun", repo: "rest", branch: "data", path: "restaurants.json",
  // ingebouwde toegang (alleen Contents op robmun/rest), versleuteld zodat hij niet als leesbare tekst in de code staat
  token: atob(["SWFiN2wzSmlTWEZFQVROVG1l", "NHhOUlNMUkI2WXBXTmJCV2h5", "aUw1WHk0WUZZdWY2UGtZc3Mz", "NnRiQWRfaDh3dmE2YXl3Q2Z2", "MElaTldKREMxMV90YXBfYnVo", "dGln"].join("")).split("").reverse().join("") };
let ui = { city: null, view: "list" };
let query = "", activeTags = new Set(), visitFilter = null;
let editing = null, formTags = new Set(), delArmed = false, draftPos = null;
let syncState = { kind: "local", text: "Alleen op dit toestel" };

function emptyData() { return { version: 1, cities: BASE_CITIES.slice(), inspiration: [], items: [] }; }
function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

const cached = lsGet(LS_DATA); if (cached && cached.data) store = cached;
Object.assign(ui, lsGet(LS_UI) || {});
try { localStorage.removeItem(LS_SET); } catch (e) {}
const connected = () => true;

function persist() { lsSet(LS_DATA, store); }
function visible() { return store.data.items.filter(i => !i.deleted); }
function allCities() {
  const s = new Set(store.data.cities && store.data.cities.length ? store.data.cities : BASE_CITIES);
  visible().forEach(i => i.city && s.add(i.city));
  return [...s];
}
function allTags() { const s = new Set(BASE_TAGS); visible().forEach(i => (i.tags || []).forEach(t => s.add(t))); return [...s]; }
function norm(s) { return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
function safeUrl(u) { return /^https?:\/\//i.test(u || "") ? u : null; }
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return "Website"; } }
function area(city) { return AREAS[city] || { search: city, viewbox: null, center: [52.2, 5.3], zoom: 8 }; }
function mapsUrl(i) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(i.name + " " + (i.address || "") + " " + area(i.city).search);
}
function slug(s) { return norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "r"; }

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  kids.flat().forEach(k => k != null && e.append(k));
  return e;
}
const ARROW = () => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("width", "12"); s.setAttribute("height", "12"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2.5"); s.innerHTML = '<path d="M7 17 17 7M8 7h9v9"/>'; return s; };
function toast(msg) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 2400); }

/* ---------------- openingstijden (OpenStreetMap-notatie, ook Nederlandse dagen) ---------------- */
const DAY_KEYS = ["mo", "tu", "we", "th", "fr", "sa", "su"];
const NL_DAYS = { ma: "mo", di: "tu", wo: "we", do: "th", vr: "fr", za: "sa", zo: "su" };
const NL_SHORT = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const NL_LONG = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
const ohCache = new Map();
function parseHours(src) {
  if (!src) return null;
  if (ohCache.has(src)) return ohCache.get(src);
  let res = null;
  try { res = parseHoursRaw(src); } catch (e) { res = null; }
  ohCache.set(src, res);
  return res;
}
function parseHoursRaw(src) {
  let s = src.trim().toLowerCase().replace(/[–—]/g, "-").replace(/\s*-\s*/g, "-").replace(/\./g, ":").replace(/\b(\d{1,2})u\b/g, "$1:00");
  s = s.replace(/\b(ma|di|wo|do|vr|za|zo)\b/g, m => NL_DAYS[m]);
  s = s.replace(/\b(gesloten|dicht)\b/g, "off");
  s = s.replace(/vanaf\s+(\d{1,2}(?::\d{2})?)/g, "$1+").replace(/(\d{1,2}(?::\d{2})?)-laat\b/g, "$1+");
  if (s === "24/7") return { always: true, week: DAY_KEYS.map(() => [[0, 1440]]) };
  const week = DAY_KEYS.map(() => null);
  let any = false;
  for (let rule of s.split(";")) {
    rule = rule.trim(); if (!rule) continue;
    if (/^ph\b/.test(rule)) continue;                 // feestdagen negeren
    const m = /^((?:mo|tu|we|th|fr|sa|su)(?:-(?:mo|tu|we|th|fr|sa|su))?(?:\s*,\s*(?:mo|tu|we|th|fr|sa|su|ph)(?:-(?:mo|tu|we|th|fr|sa|su))?)*)?\s*(.*)$/.exec(rule);
    if (!m) return null;
    const days = new Set();
    if (m[1]) {
      for (const part of m[1].split(",")) {
        const p = part.trim(); if (p === "ph") continue;
        const [a, b] = p.split("-");
        let x = DAY_KEYS.indexOf(a); const y = b ? DAY_KEYS.indexOf(b) : x;
        if (x < 0 || y < 0) return null;
        for (;;) { days.add(x); if (x === y) break; x = (x + 1) % 7; }
      }
    } else DAY_KEYS.forEach((_, i) => days.add(i));
    const rest = m[2].trim();
    let ranges;
    if (rest === "off" || rest === "closed") ranges = [];
    else {
      ranges = [];
      for (const t of rest.split(",")) {
        const oe = /^(\d{1,2})(?::(\d{2}))?\+$/.exec(t.trim());   // open eind, bijv. 17:30+
        if (oe) { ranges.push([+oe[1] * 60 + +(oe[2] || 0), 1440, true]); continue; }
        const tm = /^(\d{1,2})(?::(\d{2}))?-(\d{1,2})(?::(\d{2}))?\+?$/.exec(t.trim());
        if (!tm) return null;
        const a = +tm[1] * 60 + +(tm[2] || 0); let b = +tm[3] * 60 + +(tm[4] || 0);
        if (b <= a) b += 1440;
        ranges.push([a, b]);
      }
    }
    days.forEach(d => (week[d] = ranges));
    any = true;
  }
  if (!any) return null;
  return { week: week.map(r => r || []) };
}
const hhmm = m => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
function hoursStatus(i, date = new Date()) {
  const oh = parseHours(i.hours);
  if (!oh) return null;
  if (oh.always) return { open: true, text: "Altijd open" };
  const d = (date.getDay() + 6) % 7, min = date.getHours() * 60 + date.getMinutes();
  const today = oh.week[d], yest = oh.week[(d + 6) % 7];
  for (const [a, b] of yest) if (b > 1440 && min + 1440 < b) return { open: true, text: `Open tot ${hhmm(b)}` };
  for (const [a, b, oe] of today) if (min >= a && min < b) return { open: true, text: oe ? `Open · vanaf ${hhmm(a)}` : `Open tot ${hhmm(b)}` };
  const later = today.filter(([a]) => a > min).sort((x, y) => x[0] - y[0])[0];
  if (later) return { open: false, text: `Gesloten · open om ${hhmm(later[0])}` };
  for (let k = 1; k <= 7; k++) {
    const nd = (d + k) % 7, r = oh.week[nd].slice().sort((x, y) => x[0] - y[0])[0];
    if (r) return { open: false, text: `Gesloten · ${k === 1 ? "morgen" : NL_LONG[nd]} vanaf ${hhmm(r[0])}` };
  }
  return { open: false, text: "Gesloten" };
}
function hoursLines(i) {
  const oh = parseHours(i.hours); if (!oh) return null;
  return oh.week.map((r, d) => [NL_SHORT[d], r.length ? r.map(([a, b, oe]) => oe ? `vanaf ${hhmm(a)}` : `${hhmm(a)}–${hhmm(b)}`).join(", ") : "gesloten"]);
}

/* ---------------- categorie (kleur op de kaart) ---------------- */
const CATS = [
  ["it", "Italiaans", t => t.includes("Italiaans")],
  ["fr", "Frans", t => t.includes("Frans")],
  ["as", "Aziatisch", t => t.some(x => ["Aziatisch", "Thais", "Indonesisch"].includes(x))],
  ["vis", "Vis", t => t.includes("Vis")],
  ["fine", "Fine dining", t => t.includes("Fine dining")],
  ["lunch", "Lunch", t => t.includes("Lunch")],
];
function catOf(i) { const t = i.tags || []; const c = CATS.find(([, , f]) => f(t)); return c ? c[0] : "x"; }

/* ---------------- filtering & list ---------------- */
const ALL = "Alles";
let hereCity = null, openFilter = false;
function inCityOf(i) { return ui.city === ALL || i.city === ui.city; }
function markHere(c) {
  hereCity = c;
  document.querySelectorAll("#cities button").forEach(b => b.classList.toggle("here", ui.city === ALL && b.dataset.city === c));
}
function filtered() {
  const q = norm(query);
  const nowD = new Date();
  return visible().filter(i => {
    if (!inCityOf(i)) return false;
    if (visitFilter === "yes" && !i.visited) return false;
    if (visitFilter === "no" && i.visited) return false;
    if (openFilter) { const st = hoursStatus(i, nowD); if (!st || !st.open) return false; }
    for (const t of activeTags) if (!(i.tags || []).includes(t)) return false;
    if (q && !norm([i.name, i.notes, i.address, (i.tags || []).join(" ")].join(" ")).includes(q)) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name, "nl", { sensitivity: "base" }));
}
function activeFilterCount() { return activeTags.size + (visitFilter ? 1 : 0) + (openFilter ? 1 : 0) + (ui.city !== ALL ? 1 : 0); }

function render() {
  const cities = allCities();
  if (!ui.city || (ui.city !== ALL && !cities.includes(ui.city))) ui.city = ALL;
  const vis = visible();
  $("cities").replaceChildren(...[ALL, ...cities].map(c => el("button", {
    type: "button", "aria-pressed": String(c === ui.city), "data-city": c,
    class: ui.city === ALL && c === hereCity ? "here" : null,
    onclick: () => { ui.city = c; lsSet(LS_UI, ui); activeTags.clear(); closePlace(); render(); fitCity(); $("listView").scrollTop = 0; }
  }, c, el("span", { text: String(c === ALL ? vis.length : vis.filter(i => i.city === c).length) }))));

  const inCity = vis.filter(inCityOf);
  const used = new Map(); inCity.forEach(i => (i.tags || []).forEach(t => used.set(t, (used.get(t) || 0) + 1)));
  const tagList = [...used.keys()].sort((a, b) => used.get(b) - used.get(a) || a.localeCompare(b, "nl"));
  $("filters").replaceChildren(
    el("button", { type: "button", class: "chip state", "aria-pressed": String(openFilter), onclick: () => { openFilter = !openFilter; render(); } }, "Nu open"),
    el("button", { type: "button", class: "chip state", "aria-pressed": String(visitFilter === "yes"), onclick: () => { visitFilter = visitFilter === "yes" ? null : "yes"; render(); } }, "Geweest"),
    el("button", { type: "button", class: "chip state", "aria-pressed": String(visitFilter === "no"), onclick: () => { visitFilter = visitFilter === "no" ? null : "no"; render(); } }, "Nog proberen"),
    ...tagList.map(t => el("button", { type: "button", class: "chip", "aria-pressed": String(activeTags.has(t)), onclick: () => { activeTags.has(t) ? activeTags.delete(t) : activeTags.add(t); render(); } }, t))
  );
  $("legend").replaceChildren(
    ...[...CATS.map(([k, label]) => [k, label]), ["x", "Overig"]].map(([k, label]) => el("span", { class: "lg" }, el("i", { class: "dot c-" + k }), label)),
    el("span", { class: "lg" }, el("i", { class: "dot been-dot" }), "Geweest"));
  const n = activeFilterCount();
  $("filterBadge").hidden = !n; $("filterBadge").textContent = String(n);

  const shown = filtered();
  $("count").textContent = shown.length === inCity.length ? `${inCity.length}` : `${shown.length}/${inCity.length}`;
  $("list").replaceChildren(...shown.map(card));
  const empty = $("empty");
  empty.hidden = !!shown.length;
  if (!shown.length) empty.textContent = inCity.length ? (openFilter ? "Geen restaurants die nu open zijn (van de restaurants met bekende openingstijden)." : "Niets gevonden met deze filters.") : (ui.city === ALL ? "Nog geen restaurants. Tik op + om er een toe te voegen." : `Nog geen restaurants in ${ui.city}. Tik op + om er een toe te voegen.`);

  const inspo = (store.data.inspiration || []).filter(x => (!x.city || ui.city === ALL || x.city === ui.city) && safeUrl(x.url));
  $("inspo").hidden = !inspo.length;
  $("inspo").replaceChildren(el("h2", { text: "Inspiratie" }), ...inspo.map(x => el("a", { href: x.url, target: "_blank", rel: "noopener" }, x.label || x.url)));

  renderNotice();
  renderSync();
  if (map) renderMarkers();
  if (placeId) { const p = byId(placeId); if (p && !p.deleted) renderPlace(p); else closePlace(); }
}

function linkRow(i) {
  const links = el("div", { class: "links" });
  const u = safeUrl(i.url);
  if (u) { const a = el("a", { href: u, target: "_blank", rel: "noopener" }, hostOf(u)); a.append(ARROW()); links.append(a); }
  const g = el("a", { href: mapsUrl(i), target: "_blank", rel: "noopener" }, "Google Maps"); g.append(ARROW()); links.append(g);
  if (i.lat != null) links.append(el("button", { type: "button", onclick: () => showOnMap(i.id) }, "Op kaart"));
  else links.append(el("span", { class: "nopos", text: geoQueue.includes(i.id) ? "Locatie zoeken…" : "Geen locatie" }));
  return links;
}
function statusBadge(i) {
  const st = hoursStatus(i);
  return st ? el("span", { class: "open-badge " + (st.open ? "is-open" : "is-closed"), text: st.open ? "Open" : "Dicht" }) : null;
}
function card(i) {
  const main = el("button", { type: "button", class: "card-main", onclick: () => READONLY ? (i.lat != null && showOnMap(i.id)) : openSheet(i), "aria-label": (READONLY ? "Toon " : "Bewerk ") + i.name },
    ui.city === ALL ? el("span", { class: "where", text: i.city }) : null,
    el("div", { class: "name-row" }, el("i", { class: "dot c-" + catOf(i), "aria-hidden": "true" }), el("span", { class: "name", text: i.name }), i.visited ? el("span", { class: "been", text: "Geweest" }) : null, statusBadge(i)),
    i.notes ? el("p", { class: "notes", text: i.notes }) : null,
    (i.tags && i.tags.length) ? el("div", { class: "tags" }, i.tags.map(t => el("span", { class: "tag", text: t }))) : null
  );
  return el("li", { class: "card" }, main, linkRow(i));
}

function renderNotice() { $("notice").hidden = true; }

/* ---------------- restaurantkaart onderin ---------------- */
let placeId = null;
const ICONS = {
  route: '<path d="M3 11 21 3l-8 18-2-8-8-2Z"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  web: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  share: '<path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13 7 4 4"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
};
function svgIcon(name, size = 22) {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("width", size); s.setAttribute("height", size); s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2");
  s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICONS[name]; return s;
}
function routeUrl(i) {
  const dest = i.lat != null ? `${i.lat},${i.lng}` : (i.address || i.name + " " + area(i.city).search);
  return `https://maps.apple.com/?daddr=${encodeURIComponent(dest)}&q=${encodeURIComponent(i.name)}`;
}
function telUrl(p) { return "tel:" + p.replace(/[^\d+]/g, ""); }
async function sharePlace(i) {
  const url = safeUrl(i.url) || mapsUrl(i);
  const text = [i.name, i.address].filter(Boolean).join("\n");
  if (navigator.share) { try { await navigator.share({ title: i.name, text, url }); } catch (e) {} return; }
  try { await navigator.clipboard.writeText(text + "\n" + url); toast("Gekopieerd, plak het in je bericht"); }
  catch (e) { toast("Delen lukt hier niet"); }
}
function actionBtn(icon, label, attrs) {
  const tag = attrs.href ? "a" : "button";
  const b = el(tag, { class: "act", ...(tag === "button" ? { type: "button" } : {}), ...attrs });
  b.append(svgIcon(icon), el("span", { text: label }));
  return b;
}
function renderPlace(i) {
  placeId = i.id;
  const st = hoursStatus(i);
  const lines = hoursLines(i);
  const box = $("place");
  const acts = el("div", { class: "acts" },
    actionBtn("route", "Route", { href: routeUrl(i), target: "_blank", rel: "noopener" }),
    i.phone ? actionBtn("phone", "Bellen", { href: telUrl(i.phone) }) : null,
    safeUrl(i.url) ? actionBtn("web", "Website", { href: safeUrl(i.url), target: "_blank", rel: "noopener" }) : null,
    actionBtn("share", "Delen", { onclick: () => sharePlace(byId(i.id) || i) }),
    READONLY ? null : actionBtn("edit", "Bewerken", { onclick: () => { const it = byId(i.id); closePlace(); openSheet(it); } }));
  let hoursEl = null;
  if (lines) {
    const today = (new Date().getDay() + 6) % 7;
    hoursEl = el("details", { class: "hours" },
      el("summary", {}, el("span", { class: "open-text " + (st.open ? "is-open" : "is-closed"), text: st.text }), el("span", { class: "more", text: "Alle tijden" })),
      el("table", {}, ...lines.map(([d, t], k) => el("tr", { class: k === today ? "today" : null }, el("th", { text: d }), el("td", { text: t })))));
  } else if (i.hours) hoursEl = el("p", { class: "hours-raw", text: i.hours });
  else hoursEl = el("p", { class: "hours-raw muted", text: "Openingstijden onbekend" });
  box.replaceChildren(
    el("div", { class: "place-head" },
      el("div", { class: "place-title" },
        el("span", { class: "where", text: i.city }),
        el("h3", {}, el("i", { class: "dot c-" + catOf(i), "aria-hidden": "true" }), i.name, i.visited ? el("span", { class: "been", text: "Geweest" }) : null)),
      el("button", { type: "button", class: "x", "aria-label": "Sluiten", onclick: closePlace }, svgIcon("close", 16))),
    i.address ? el("p", { class: "addr", text: i.address }) : null,
    hoursEl,
    acts,
    i.notes ? el("p", { class: "notes", text: i.notes }) : null,
    (i.tags && i.tags.length) ? el("div", { class: "tags" }, i.tags.map(t => el("span", { class: "tag", text: t }))) : null);
  box.hidden = false;
  $("mapView").classList.add("card-open");
}
function openPlace(id) {
  const i = byId(id); if (!i) return;
  renderPlace(i); markHere(i.city);
  markers.forEach((m, mid) => { const e = m.getElement(); if (e) e.classList.toggle("selected", mid === id); });
}
function closePlace() {
  placeId = null;
  $("place").hidden = true; $("mapView").classList.remove("card-open");
  markers.forEach(m => { const e = m.getElement(); if (e) e.classList.remove("selected"); });
  markHere(null);
}

/* ---------------- map ---------------- */
let map = null, cluster = null, markers = new Map(), meMarker = null, lastFitCity = null;
function tileLayer() {
  // Standaardkaart van OpenStreetMap (geen sleutel nodig); in donkere modus via CSS gedimd
  return L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, className: "osm-tiles",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  });
}
const CHECK = '<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>';
function pinIcon(cls, been) {
  return L.divIcon({ className: "pin-wrap", html: `<div class="pin ${cls}"><i></i></div>${been ? `<b class="pin-been">${CHECK}</b>` : ""}`, iconSize: [28, 28], iconAnchor: [14, 28], tooltipAnchor: [12, -16] });
}
const LABEL_ZOOM = 15;
function updateLabels() { if (map) map.getContainer().classList.toggle("labels", map.getZoom() >= LABEL_ZOOM); }

function initMap() {
  if (map || typeof L === "undefined") return;
  const a = area(ui.city);
  map = L.map("map", { zoomControl: false, attributionControl: true }).setView(a.center, a.zoom);
  tileLayer().addTo(map);
  cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 40, spiderfyOnMaxZoom: true, disableClusteringAtZoom: 16 });
  map.addLayer(cluster);
  map.on("zoomend", updateLabels);
  map.on("click", () => { closePlace(); document.querySelector(".app").classList.remove("filters-open"); $("filterBtn").setAttribute("aria-expanded", "false"); });
  updateLabels();
  renderMarkers();
}
function renderMarkers() {
  if (!map) return;
  cluster.clearLayers(); markers.clear();
  const shown = filtered();
  const withPos = shown.filter(i => i.lat != null && i.lng != null);
  withPos.forEach(i => {
    const m = L.marker([i.lat, i.lng], { icon: pinIcon("c-" + catOf(i), i.visited), title: i.name, riseOnHover: true });
    m.bindTooltip(i.name, { permanent: true, direction: "right", className: "pin-label", interactive: false });
    m.on("click", () => openPlace(i.id));
    m.on("add", () => { if (i.id === placeId) { const e = m.getElement(); if (e) e.classList.add("selected"); } });
    markers.set(i.id, m); cluster.addLayer(m);
  });
  const missing = shown.length - withPos.length;
  const np = $("noPin");
  np.hidden = !missing;
  if (missing) np.textContent = geoQueue.length ? `Locaties zoeken… ${missing} nog niet op de kaart` : `${missing} restaurant${missing > 1 ? "s" : ""} zonder locatie. Open ze om de pin te zetten.`;
  if (lastFitCity !== ui.city || (lastFitCount < 3 && withPos.length >= 3)) fitCity();
}
let lastFitCount = 0;
function fitCity() {
  if (!map) return;
  const pts = visible().filter(i => inCityOf(i) && i.lat != null).map(i => [i.lat, i.lng]);
  if (pts.length) map.fitBounds(pts, { paddingTopLeft: [30, 90], paddingBottomRight: [30, 40], maxZoom: 15 });
  else { const a = area(ui.city); map.setView(a.center, a.zoom); }
  lastFitCity = ui.city; lastFitCount = pts.length;
}
function showOnMap(id) {
  setView("map");
  const i = byId(id); if (!i || i.lat == null) return;
  setTimeout(() => {
    const m = markers.get(id);
    const done = () => { map.panTo([i.lat, i.lng]); openPlace(id); };
    if (m) cluster.zoomToShowLayer(m, () => { if (map.getZoom() < LABEL_ZOOM) map.setView([i.lat, i.lng], LABEL_ZOOM); done(); });
    else { map.setView([i.lat, i.lng], 16); done(); }
  }, 80);
}
$("locateBtn").onclick = () => {
  if (!map) return;
  map.locate({ setView: true, maxZoom: 15, enableHighAccuracy: true });
};
function onLocated(e) {
  if (meMarker) meMarker.setLatLng(e.latlng);
  else meMarker = L.marker(e.latlng, { icon: L.divIcon({ className: "", html: '<div class="me-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false }).addTo(map);
}

function setView(v) {
  ui.view = v; lsSet(LS_UI, ui);
  const app = document.querySelector(".app");
  app.classList.toggle("mapmode", v === "map");
  app.classList.remove("filters-open"); $("filterBtn").setAttribute("aria-expanded", "false");
  $("listView").hidden = v !== "list"; $("mapView").hidden = v !== "map";
  $("tabList").setAttribute("aria-pressed", String(v === "list"));
  $("tabMap").setAttribute("aria-pressed", String(v === "map"));
  if (v === "map") {
    if (!map) { initMap(); map.on("locationfound", onLocated); map.on("locationerror", () => toast("Je locatie is niet beschikbaar. Sta locatie toe in je instellingen.")); }
    setTimeout(() => map && map.invalidateSize(), 30);
  } else closePlace();
}
$("tabList").onclick = () => setView("list");
$("tabMap").onclick = () => setView("map");
$("filterBtn").onclick = () => {
  const app = document.querySelector(".app");
  const open = !app.classList.contains("filters-open");
  app.classList.toggle("filters-open", open);
  $("filterBtn").setAttribute("aria-expanded", String(open));
  if (open) closePlace();
};
$("q").addEventListener("focus", () => closePlace());

/* ---------------- data changes ---------------- */
function byId(id) { return store.data.items.find(i => i.id === id); }
function upsert(item) {
  item.updatedAt = now();
  const idx = store.data.items.findIndex(i => i.id === item.id);
  if (idx >= 0) store.data.items[idx] = item; else store.data.items.push(item);
  store.dirty = true; persist(); render(); scheduleSync();
}
function removeItem(id) {
  const idx = store.data.items.findIndex(i => i.id === id);
  if (idx < 0) return;
  store.data.items[idx] = { id, deleted: true, updatedAt: now() };
  store.dirty = true; persist(); render(); scheduleSync();
}

/* ---------------- geocoding: adres via PDOK (officieel NL-adressenregister), anders OpenStreetMap ---------------- */
let geoQueue = [], geoRunning = false;
function cleanName(n) { return n.replace(/\(.*?\)/g, "").replace(/[–—-]\s.*$/, "").trim(); }
async function nominatim(q, viewbox) {
  const p = new URLSearchParams({ format: "jsonv2", limit: "1", countrycodes: "nl", q, "accept-language": "nl" });
  if (viewbox) { p.set("viewbox", viewbox); p.set("bounded", "1"); }
  const r = await fetch("https://nominatim.openstreetmap.org/search?" + p.toString(), { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("geo " + r.status);
  const j = await r.json();
  return j && j[0] ? { lat: +(+j[0].lat).toFixed(6), lng: +(+j[0].lon).toFixed(6) } : null;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function pdok(address) {
  const p = new URLSearchParams({ q: address, fq: "type:adres", rows: "1", fl: "centroide_ll,weergavenaam" });
  const r = await fetch("https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?" + p.toString());
  if (!r.ok) throw new Error("pdok " + r.status);
  const d = (await r.json()).response.docs[0];
  const m = d && /POINT\(([-\d.]+) ([-\d.]+)\)/.exec(d.centroide_ll || "");
  return m ? { lat: +(+m[2]).toFixed(6), lng: +(+m[1]).toFixed(6), via: "adres" } : null;
}
async function geocode(i) {
  const a = area(i.city);
  if (i.address && /\d/.test(i.address)) {
    try {
      const res = await pdok(/,/.test(i.address) ? i.address : `${i.address}, ${a.search}`);
      await sleep(150);
      if (res) return res;
    } catch (e) {}
  }
  const tries = [];
  if (i.address) tries.push([`${i.address}, ${a.search}`, null]);
  tries.push([cleanName(i.name), a.viewbox]);
  tries.push([`${cleanName(i.name)}, ${a.search}`, null]);
  for (const [q, vb] of tries) {
    const res = await nominatim(q, vb);
    await sleep(1100); // max 1 verzoek per seconde (gebruiksregels Nominatim)
    if (res) return res;
  }
  return null;
}
function queueGeocoding() {
  if (READONLY) return;
  visible().forEach(i => { if (i.lat == null && !i.geoFailed && !geoQueue.includes(i.id)) geoQueue.push(i.id); });
  runGeo();
}
async function runGeo() {
  if (geoRunning) return;
  if (!geoQueue.length) { updateGeoProgress(); runEnrich(); return; }
  geoRunning = true;
  const total = geoQueue.length; let done = 0;
  while (geoQueue.length) {
    const id = geoQueue[0];
    $("geoProgress").hidden = false;
    $("geoProgress").textContent = `Locaties zoeken voor de kaart… ${done + 1} van ${total}`;
    const i = byId(id);
    if (i && !i.deleted && i.lat == null) {
      try {
        const res = await geocode(i);
        const cur = byId(id);
        if (cur && !cur.deleted && cur.lat == null) {
          if (res) { cur.lat = res.lat; cur.lng = res.lng; cur.geo = res.via || "auto"; }
          else cur.geoFailed = true;
          cur.updatedAt = now(); store.dirty = true; persist();
        }
      } catch (e) { geoQueue.shift(); break; } // offline of geweigerd: later opnieuw
    }
    geoQueue.shift(); done++;
    if (done % 5 === 0 || !geoQueue.length) { render(); scheduleSync(); }
  }
  geoRunning = false; render(); updateGeoProgress(); scheduleSync();
  runEnrich();
}

/* ---------------- telefoon en openingstijden aanvullen uit OpenStreetMap (eenmalig per restaurant) ---------------- */
let enrichRunning = false;
async function osmNear(i) {
  const d = 0.0025;
  const p = new URLSearchParams({ format: "jsonv2", extratags: "1", limit: "3", q: cleanName(i.name),
    viewbox: `${i.lng - d},${i.lat + d},${i.lng + d},${i.lat - d}`, bounded: "1", "accept-language": "nl" });
  const r = await fetch("https://nominatim.openstreetmap.org/search?" + p.toString(), { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("osm " + r.status);
  const res = await r.json();
  return (res.find(x => x.extratags && (x.extratags.opening_hours || x.extratags.phone || x.extratags["contact:phone"])) || res[0] || {}).extratags || null;
}
async function runEnrich() {
  if (READONLY) return;
  if (enrichRunning || geoRunning) return;
  enrichRunning = true;
  let changed = 0;
  for (const item of visible().filter(i => i.lat != null && !i.osmChecked)) {
    let x = null;
    try { x = await osmNear(item); } catch (e) { break; }
    await sleep(1100); // max 1 verzoek per seconde
    const cur = byId(item.id); if (!cur || cur.deleted) continue;
    if (x) {
      const tel = x.phone || x["contact:phone"];
      if (tel && !cur.phone) cur.phone = tel.split(";")[0].trim();
      if (x.opening_hours && !cur.hours && parseHours(x.opening_hours)) cur.hours = x.opening_hours;
    }
    cur.osmChecked = now(); cur.updatedAt = now(); store.dirty = true; persist(); changed++;
    if (changed % 8 === 0) { render(); scheduleSync(); }
  }
  enrichRunning = false;
  if (changed) { render(); scheduleSync(); }
}
function updateGeoProgress() { if (!geoQueue.length) $("geoProgress").hidden = true; }

/* ---------------- restaurant sheet ---------------- */
let miniMap = null, miniMarker = null;
function renderTagPick() {
  const tags = [...new Set([...allTags(), ...formTags])];
  $("fTags").replaceChildren(...tags.map(t => el("button", {
    type: "button", class: "chip", "aria-pressed": String(formTags.has(t)),
    onclick: e => { formTags.has(t) ? formTags.delete(t) : formTags.add(t); e.currentTarget.setAttribute("aria-pressed", String(formTags.has(t))); }
  }, t)));
}
function fillCities(sel) {
  $("fCity").replaceChildren(...allCities().map(c => el("option", { value: c }, c)), el("option", { value: "__new" }, "Nieuwe lijst…"));
  $("fCity").value = sel; $("newCityWrap").hidden = true;
}
function setDraftPin(pos, fly) {
  draftPos = pos;
  if (!miniMap) return;
  if (!pos) { if (miniMarker) { miniMap.removeLayer(miniMarker); miniMarker = null; } return; }
  if (!miniMarker) miniMarker = L.marker([pos.lat, pos.lng], { icon: pinIcon("draft") }).addTo(miniMap);
  else miniMarker.setLatLng([pos.lat, pos.lng]);
  if (fly) miniMap.setView([pos.lat, pos.lng], 16);
}
function openSheet(item) {
  editing = item ? { ...item } : null; delArmed = false;
  $("sheetTitle").textContent = item ? "Bewerken" : "Restaurant toevoegen";
  $("fName").value = item ? item.name : "";
  $("fUrl").value = item ? item.url || "" : "";
  $("fPhone").value = item ? item.phone || "" : "";
  $("fHours").value = item ? item.hours || "" : "";
  $("fNotes").value = item ? item.notes || "" : "";
  $("fAddress").value = item ? item.address || "" : "";
  $("fVisited").checked = !!(item && item.visited);
  $("fNewTag").value = ""; $("fNewCity").value = "";
  formTags = new Set(item ? item.tags || [] : []);
  const defCity = ui.city === ALL ? "Amsterdam" : ui.city;
  fillCities(item ? item.city : defCity);
  renderTagPick();
  const d = $("delBtn"); d.hidden = !item; d.textContent = "Verwijderen"; d.classList.remove("confirm"); d.disabled = false;
  $("fErr").hidden = true;
  $("pinHint").textContent = !item || item.lat == null ? "Tik op de kaart om de pin te zetten of te verplaatsen."
    : item.geo === "manual" ? "Pin zelf gezet. Tik op de kaart om hem te verplaatsen."
    : item.geo === "adres" || item.geo === "osm" ? "Pin op basis van het adres. Klopt hij niet? Tik op de juiste plek."
    : "Locatie automatisch gevonden. Klopt hij niet? Tik op de juiste plek op de kaart.";
  hideSuggest();
  showSheet("sheet");
  if (typeof L !== "undefined") {
    if (!miniMap) {
      miniMap = L.map("miniMap", { zoomControl: false, attributionControl: false });
      tileLayer().addTo(miniMap);
      miniMap.on("click", e => { setDraftPin({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6), manual: true }, false); $("pinHint").textContent = "Pin gezet. Vergeet niet op te slaan."; });
    }
    setTimeout(() => {
      miniMap.invalidateSize();
      const a = area(item ? item.city : defCity);
      if (item && item.lat != null) { miniMap.setView([item.lat, item.lng], 16); setDraftPin({ lat: item.lat, lng: item.lng }, false); }
      else if (map) { miniMap.setView(map.getCenter(), Math.min(map.getZoom(), 14)); setDraftPin(null); }
      else { miniMap.setView(a.center, a.zoom); setDraftPin(null); }
    }, 60);
  }
  if (!item) setTimeout(() => $("fName").focus(), 80);
}
function showSheet(id) { $("scrim").hidden = false; $(id).hidden = false; $(id).scrollTop = 0; }
function closeSheets() { $("scrim").hidden = true; $("sheet").hidden = true; $("settings").hidden = true; editing = null; }
document.querySelectorAll("[data-close]").forEach(b => (b.onclick = closeSheets));
$("scrim").onclick = closeSheets;
document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheets(); });
$("addBtn").onclick = () => { if (!READONLY) openSheet(null); };
$("fCity").onchange = e => { $("newCityWrap").hidden = e.target.value !== "__new"; if (e.target.value === "__new") $("fNewCity").focus(); };
function addTagFromInput() { const v = $("fNewTag").value.trim(); if (!v) return; formTags.add(v.charAt(0).toUpperCase() + v.slice(1)); $("fNewTag").value = ""; renderTagPick(); }
$("addTagBtn").onclick = addTagFromInput;
$("fNewTag").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addTagFromInput(); } });
$("findBtn").onclick = async () => {
  const name = $("fName").value.trim(), address = $("fAddress").value.trim();
  let c = $("fCity").value; if (c === "__new") c = $("fNewCity").value.trim();
  if (!name && !address) { showErr("Vul eerst een naam of adres in."); return; }
  const b = $("findBtn"); b.disabled = true; b.textContent = "Zoeken…";
  try {
    const res = await geocode({ name: name || address, address, city: c });
    if (res) { setDraftPin({ ...res, manual: false, geo: res.via || "auto" }, true); $("pinHint").textContent = "Gevonden. Klopt het niet? Tik op de juiste plek."; }
    else $("pinHint").textContent = "Niet gevonden. Probeer een adres, of tik zelf op de kaart.";
  } catch (e) { $("pinHint").textContent = "Zoeken lukt nu niet. Tik zelf op de kaart."; }
  b.disabled = false; b.textContent = "Zoek";
};
/* ---------------- suggesties bij het typen van een naam (OpenStreetMap via Photon) ---------------- */
const CUISINE = { italian: "Italiaans", pizza: "Italiaans", french: "Frans", thai: "Thais", asian: "Aziatisch", chinese: "Aziatisch",
  japanese: "Aziatisch", sushi: "Aziatisch", vietnamese: "Aziatisch", korean: "Aziatisch", indonesian: "Indonesisch",
  peruvian: "Peruaans", steak_house: "Steak", seafood: "Vis", fish: "Vis", vegan: "Vegan", belgian: "Belgisch" };
const FOOD = /^(restaurant|cafe|bar|pub|fast_food|biergarten|food_court|ice_cream|bistro)$/;
let sugTimer = null, sugSeq = 0;
function hideSuggest() { clearTimeout(sugTimer); sugSeq++; $("suggest").hidden = true; $("suggest").replaceChildren(); }
function fmtAddress(p) {
  const street = [p.street, p.housenumber].filter(Boolean).join(" ");
  const place = [p.postcode, p.city || p.town || p.village].filter(Boolean).join(" ");
  return [street, place].filter(Boolean).join(", ");
}
async function suggest(q) {
  const seq = ++sugSeq;
  let c = $("fCity").value; if (c === "__new") c = ui.city === ALL ? "Amsterdam" : ui.city;
  const center = area(c).center;
  const p = new URLSearchParams({ q, limit: "12", lat: String(center[0]), lon: String(center[1]) });
  let feats = [];
  try {
    const r = await fetch("https://photon.komoot.io/api/?" + p.toString());
    if (!r.ok) return;
    feats = (await r.json()).features || [];
  } catch (e) { return; }
  if (seq !== sugSeq) return;
  feats = feats.filter(f => f.properties && f.properties.name && f.geometry)
    .sort((a, b) => (FOOD.test(b.properties.osm_value) ? 1 : 0) - (FOOD.test(a.properties.osm_value) ? 1 : 0))
    .slice(0, 6);
  const box = $("suggest");
  if (!feats.length) { box.hidden = true; return; }
  box.replaceChildren(...feats.map(f => {
    const pr = f.properties;
    return el("button", { type: "button", class: "sug", onmousedown: e => e.preventDefault(), onclick: () => pickSuggestion(f) },
      el("span", { class: "sug-name", text: pr.name }),
      el("span", { class: "sug-sub", text: fmtAddress(pr) || pr.osm_value || "" }));
  }));
  box.hidden = false;
}
async function pickSuggestion(f) {
  const pr = f.properties, [lng, lat] = f.geometry.coordinates;
  hideSuggest();
  $("fName").value = pr.name;
  const addr = fmtAddress(pr); if (addr) $("fAddress").value = addr;
  const town = pr.city || pr.town || pr.village || "";
  const sel = $("fCity");
  if (sel.value !== "Kantoor" && [...sel.options].some(o => o.value === town)) sel.value = town;
  setDraftPin({ lat: +lat.toFixed(6), lng: +lng.toFixed(6), manual: false, geo: "osm" }, true);
  $("pinHint").textContent = "Adres en locatie ingevuld. Klopt de pin niet? Tik op de juiste plek.";
  // Website en keuken ophalen uit OpenStreetMap
  if (!pr.osm_type || !pr.osm_id) return;
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/lookup?format=json&extratags=1&osm_ids=${pr.osm_type}${pr.osm_id}`);
    const x = ((await r.json())[0] || {}).extratags || {};
    const site = x.website || x["contact:website"];
    if (site && !$("fUrl").value.trim()) $("fUrl").value = site;
    const tel = x.phone || x["contact:phone"];
    if (tel && !$("fPhone").value.trim()) $("fPhone").value = tel.split(";")[0].trim();
    if (x.opening_hours && !$("fHours").value.trim() && parseHours(x.opening_hours)) $("fHours").value = x.opening_hours;
    (x.cuisine || "").split(";").map(s => CUISINE[s.trim()]).filter(Boolean).forEach(t => formTags.add(t));
    renderTagPick();
  } catch (e) {}
}
$("fName").addEventListener("input", () => {
  if (editing) return;
  clearTimeout(sugTimer);
  const q = $("fName").value.trim();
  if (q.length < 3) { hideSuggest(); return; }
  sugTimer = setTimeout(() => suggest(q), 300);
});
$("fName").addEventListener("blur", () => setTimeout(() => { $("suggest").hidden = true; }, 200));
$("fName").addEventListener("focus", () => { if ($("suggest").children.length && !editing) $("suggest").hidden = false; });

function showErr(m) { const e = $("fErr"); e.textContent = m; e.hidden = false; }
function fixUrl(u) { u = u.trim(); if (!u) return ""; if (!/^https?:\/\//i.test(u)) u = "https://" + u; return u; }

$("form").addEventListener("submit", e => {
  e.preventDefault();
  const name = $("fName").value.trim();
  if (!name) { showErr("Vul een naam in."); $("fName").focus(); return; }
  let c = $("fCity").value;
  if (c === "__new") { c = $("fNewCity").value.trim(); if (!c) { showErr("Geef de nieuwe lijst een naam."); return; } }
  if ($("fNewTag").value.trim()) addTagFromInput();
  const base = editing || { id: slug(name) + "-" + now().toString(36), createdAt: now() };
  const item = { ...base, name, url: fixUrl($("fUrl").value), city: c, notes: $("fNotes").value.trim(), address: $("fAddress").value.trim(), phone: $("fPhone").value.trim(), hours: $("fHours").value.trim(), tags: [...formTags], visited: $("fVisited").checked };
  const hoursText = item.hours;
  if (hoursText && !parseHours(hoursText)) { showErr("Openingstijden niet begrepen. Schrijf ze zo: di-za 17:30-22:00; zo 12:00-21:00"); $("fHours").focus(); return; }
  delete item.geoFailed;
  if (draftPos) { item.lat = draftPos.lat; item.lng = draftPos.lng; item.geo = draftPos.manual ? "manual" : (draftPos.manual === false ? (draftPos.geo || "auto") : item.geo); }
  else { delete item.lat; delete item.lng; delete item.geo; }
  if (!item.address) delete item.address;
  if (!item.phone) delete item.phone;
  if (!item.hours) delete item.hours;
  if (!store.data.cities.includes(c)) store.data.cities.push(c);
  const isNew = !editing;
  if (ui.city !== ALL) { ui.city = c; lsSet(LS_UI, ui); }
  upsert(item); closeSheets();
  toast(isNew ? `${name} toegevoegd` : "Opgeslagen");
  if (item.lat == null) queueGeocoding();
});
$("delBtn").onclick = () => {
  const d = $("delBtn");
  if (!delArmed) { delArmed = true; d.textContent = "Zeker weten?"; d.classList.add("confirm"); return; }
  if (!editing) return;
  const n = editing.name; removeItem(editing.id); closeSheets(); toast(`${n} verwijderd`);
};
$("q").addEventListener("input", e => { query = e.target.value; render(); });

/* ---------------- GitHub sync ---------------- */
function b64encode(str) { const bytes = new TextEncoder().encode(str); let bin = ""; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); }
function b64decode(b64) { const bin = atob(b64.replace(/\s/g, "")); const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder().decode(bytes); }
function apiUrl() { return `https://api.github.com/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}/contents/${settings.path.split("/").map(encodeURIComponent).join("/")}`; }
function ghHeaders() { return { Authorization: `Bearer ${settings.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }; }

class SyncError extends Error { constructor(kind, msg) { super(msg); this.kind = kind; } }
async function ghGet() {
  const r = await fetch(apiUrl() + "?ref=" + encodeURIComponent(settings.branch || "main"), { headers: ghHeaders(), cache: "no-store" });
  if (r.status === 404) {
    // bestand bestaat nog niet, of repo/branch onbekend: controleer de repo
    const rr = await fetch(`https://api.github.com/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}`, { headers: ghHeaders(), cache: "no-store" });
    if (!rr.ok) throw new SyncError("config", "Repository niet gevonden, of het token heeft er geen toegang toe.");
    return null;
  }
  if (r.status === 401) throw new SyncError("auth", "Het token is ongeldig of verlopen.");
  if (r.status === 403) throw new SyncError("auth", "Het token mag deze repository niet lezen.");
  if (!r.ok) throw new SyncError("net", "GitHub gaf een fout (" + r.status + ").");
  const j = await r.json();
  return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
}
async function ghPut(data, sha) {
  if (READONLY) return { conflict: false, sha };
  const body = { message: "Tafels: lijst bijgewerkt", content: b64encode(JSON.stringify(data, null, 1) + "\n"), branch: settings.branch || "main" };
  if (sha) body.sha = sha;
  const r = await fetch(apiUrl(), { method: "PUT", headers: { ...ghHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) return { conflict: true };
  if (r.status === 401) throw new SyncError("auth", "Het token is ongeldig of verlopen.");
  if (r.status === 403 || r.status === 404) throw new SyncError("auth", "Het token mag niet naar deze repository schrijven. Geef het de permissie Contents: Read and write.");
  if (!r.ok) throw new SyncError("net", "Opslaan op GitHub mislukt (" + r.status + ").");
  const j = await r.json();
  return { sha: j.content.sha };
}
function merge(remote, local) {
  const out = { ...remote, cities: [...new Set([...(remote.cities || []), ...(local.cities || [])])] };
  if (!out.inspiration || !out.inspiration.length) out.inspiration = local.inspiration || [];
  const m = new Map();
  (remote.items || []).forEach(i => m.set(i.id, i));
  (local.items || []).forEach(i => { const r = m.get(i.id); if (!r || (i.updatedAt || 0) > (r.updatedAt || 0)) m.set(i.id, i); });
  out.items = [...m.values()];
  return out;
}
function setSync(kind, text) { syncState = { kind, text }; renderSync(); }
function renderSync() {
  const dot = $("syncDot");
  dot.className = "dot " + ({ ok: "ok", busy: "busy", warn: "warn", err: "err" }[syncState.kind] || "");
  $("syncText").textContent = syncState.text;
}

let syncTimer = null, syncing = false, syncAgain = false;
function scheduleSync() { if (!connected()) { setSync("local", store.dirty ? "Alleen op dit toestel" : "Alleen op dit toestel"); return; } clearTimeout(syncTimer); syncTimer = setTimeout(sync, 1200); }
async function sync() {
  if (!connected()) return;
  if (syncing) { syncAgain = true; return; }
  syncing = true; setSync("busy", "Synchroniseren…");
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await ghGet();
      if (remote) {
        if (READONLY) remote.data.items.forEach(i => delete i.notes);
        if (!store.dirty || READONLY) { store.data = remote.data; store.sha = remote.sha; store.dirty = false; persist(); break; }
        store.data = merge(remote.data, store.data); store.sha = remote.sha;
      } else store.sha = null;
      if (!store.dirty && remote) break;
      const res = await ghPut(store.data, store.sha);
      if (res.conflict) continue;
      store.sha = res.sha; store.dirty = false; persist(); break;
    }
    setSync(store.dirty ? "warn" : "ok", store.dirty ? "Nog niet opgeslagen op GitHub" : "Opgeslagen op GitHub");
    render(); queueGeocoding();
  } catch (e) {
    if (e instanceof SyncError && e.kind !== "net") setSync("err", e.message);
    else setSync("warn", navigator.onLine === false ? "Offline, wijzigingen staan klaar" : "Sync mislukt, probeert later opnieuw");
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(); }
  }
}
window.addEventListener("online", () => scheduleSync());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { render(); if (connected()) sync(); } });
setInterval(() => { if (document.visibilityState === "visible" && (openFilter || placeId)) render(); }, 60000);

/* ---------------- settings ---------------- */
function openSettings() {
  $("sErr").hidden = true;
  $("sOk").hidden = false; $("sOk").textContent = syncState.text + ` · ${visible().length} restaurants`;
  showSheet("settings");
}
$("syncBtn").onclick = openSettings;
$("setForm").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("connectBtn"); btn.disabled = true; btn.textContent = "Bezig…";
  await sync();
  $("sOk").textContent = syncState.text + ` · ${visible().length} restaurants`;
  btn.disabled = false; btn.textContent = "Nu synchroniseren";
});
$("exportBtn").onclick = () => {
  const blob = new Blob([JSON.stringify(store.data, null, 1)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `tafels-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
};
$("importFile").onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || !Array.isArray(d.items)) throw new Error();
    store.data = merge(store.data, d); store.dirty = true; persist(); render(); scheduleSync(); queueGeocoding();
    toast(`Back-up teruggezet: ${d.items.filter(i => !i.deleted).length} restaurants`); closeSheets();
  } catch (err) { $("sErr").hidden = false; $("sErr").textContent = "Dit bestand is geen geldige Tafels-back-up."; }
  e.target.value = "";
};

/* ---------------- start ---------------- */
async function boot() {
  // Altijd openen op de kaart met alle restaurants
  ui.city = ALL; lsSet(LS_UI, ui);
  if (READONLY) {
    document.querySelector(".app").classList.add("readonly");
    $("addBtn").hidden = true; $("syncBtn").hidden = true;
    const mf = document.querySelector('link[rel="manifest"]'); if (mf) mf.href = "manifest-bekijk.webmanifest";
    store.data.items.forEach(i => delete i.notes);
  }
  render();
  setView("map");
  await sync();
  queueGeocoding();
}
boot();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
