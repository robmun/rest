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
const LS_DATA = "tafels.data.v1", LS_SET = "tafels.settings.v1", LS_UI = "tafels.ui.v1";

const $ = id => document.getElementById(id);
const now = () => Date.now();

/* ---------------- state ---------------- */
let store = { data: emptyData(), sha: null, dirty: false };
let settings = { owner: "robmun", repo: "rest", branch: "main", path: "restaurants.json", token: "" };
let ui = { city: null, view: "list" };
let query = "", activeTags = new Set(), visitFilter = null;
let editing = null, formTags = new Set(), delArmed = false, draftPos = null;
let syncState = { kind: "local", text: "Alleen op dit toestel" };

function emptyData() { return { version: 1, cities: BASE_CITIES.slice(), inspiration: [], items: [] }; }
function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

const cached = lsGet(LS_DATA); if (cached && cached.data) store = cached;
Object.assign(settings, lsGet(LS_SET) || {});
Object.assign(ui, lsGet(LS_UI) || {});
const connected = () => !!(settings.owner && settings.repo && settings.token);

/* Koppeling dubbel bewaren (localStorage + IndexedDB), zodat iOS hem niet kwijtraakt */
function idb() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open("tafels", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}
async function idbGet(key) {
  try { const db = await idb(); return await new Promise(res => { const q = db.transaction("kv").objectStore("kv").get(key); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); }
  catch (e) { return null; }
}
async function idbSet(key, val) {
  try { const db = await idb(); await new Promise(res => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(val, key); t.oncomplete = res; t.onerror = res; }); } catch (e) {}
}
function saveSettings() {
  lsSet(LS_SET, settings); idbSet("settings", settings);
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
}
async function restoreSettings() {
  if (connected()) { idbSet("settings", settings); return; }
  const s = await idbGet("settings");
  if (s && s.token) { Object.assign(settings, s); lsSet(LS_SET, settings); }
}

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

/* ---------------- filtering & list ---------------- */
function filtered() {
  const q = norm(query);
  return visible().filter(i => {
    if (i.city !== ui.city) return false;
    if (visitFilter === "yes" && !i.visited) return false;
    if (visitFilter === "no" && i.visited) return false;
    for (const t of activeTags) if (!(i.tags || []).includes(t)) return false;
    if (q && !norm([i.name, i.notes, i.address, (i.tags || []).join(" ")].join(" ")).includes(q)) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name, "nl", { sensitivity: "base" }));
}

function render() {
  const cities = allCities();
  if (!ui.city || !cities.includes(ui.city)) ui.city = cities[0];
  const vis = visible();
  $("cities").replaceChildren(...cities.map(c => el("button", {
    type: "button", "aria-pressed": String(c === ui.city),
    onclick: () => { ui.city = c; lsSet(LS_UI, ui); activeTags.clear(); render(); fitCity(); $("listView").scrollTop = 0; }
  }, c, el("span", { text: String(vis.filter(i => i.city === c).length) }))));

  const inCity = vis.filter(i => i.city === ui.city);
  const used = new Map(); inCity.forEach(i => (i.tags || []).forEach(t => used.set(t, (used.get(t) || 0) + 1)));
  const tagList = [...used.keys()].sort((a, b) => used.get(b) - used.get(a) || a.localeCompare(b, "nl"));
  $("filters").replaceChildren(
    el("button", { type: "button", class: "chip state", "aria-pressed": String(visitFilter === "yes"), onclick: () => { visitFilter = visitFilter === "yes" ? null : "yes"; render(); } }, "Geweest"),
    el("button", { type: "button", class: "chip state", "aria-pressed": String(visitFilter === "no"), onclick: () => { visitFilter = visitFilter === "no" ? null : "no"; render(); } }, "Nog proberen"),
    ...tagList.map(t => el("button", { type: "button", class: "chip", "aria-pressed": String(activeTags.has(t)), onclick: () => { activeTags.has(t) ? activeTags.delete(t) : activeTags.add(t); render(); } }, t))
  );

  const shown = filtered();
  $("count").textContent = shown.length === inCity.length ? `${inCity.length}` : `${shown.length}/${inCity.length}`;
  $("list").replaceChildren(...shown.map(card));
  const empty = $("empty");
  empty.hidden = !!shown.length;
  if (!shown.length) empty.textContent = inCity.length ? "Niets gevonden met deze filters." : `Nog geen restaurants in ${ui.city}. Tik op + om er een toe te voegen.`;

  const inspo = (store.data.inspiration || []).filter(x => (!x.city || x.city === ui.city) && safeUrl(x.url));
  $("inspo").hidden = !inspo.length;
  $("inspo").replaceChildren(el("h2", { text: "Inspiratie" }), ...inspo.map(x => el("a", { href: x.url, target: "_blank", rel: "noopener" }, x.label || x.url)));

  renderNotice();
  renderSync();
  if (map) renderMarkers();
}

function linkRow(i, inPopup) {
  const links = el("div", { class: "links" });
  const u = safeUrl(i.url);
  if (u) { const a = el("a", { href: u, target: "_blank", rel: "noopener" }, hostOf(u)); a.append(ARROW()); links.append(a); }
  const g = el("a", { href: mapsUrl(i), target: "_blank", rel: "noopener" }, "Google Maps"); g.append(ARROW()); links.append(g);
  if (!inPopup) {
    if (i.lat != null) links.append(el("button", { type: "button", onclick: () => showOnMap(i.id) }, "Op kaart"));
    else links.append(el("span", { class: "nopos", text: geoQueue.includes(i.id) ? "Locatie zoeken…" : "Geen locatie" }));
  } else {
    links.append(el("button", { type: "button", onclick: () => openSheet(byId(i.id)) }, "Bewerken"));
  }
  return links;
}

function card(i) {
  const main = el("button", { type: "button", class: "card-main", onclick: () => openSheet(i), "aria-label": "Bewerk " + i.name },
    el("div", { class: "name-row" }, el("span", { class: "name", text: i.name }), i.visited ? el("span", { class: "been", text: "Geweest" }) : null),
    i.notes ? el("p", { class: "notes", text: i.notes }) : null,
    (i.tags && i.tags.length) ? el("div", { class: "tags" }, i.tags.map(t => el("span", { class: "tag", text: t }))) : null
  );
  return el("li", { class: "card" }, main, linkRow(i, false));
}

function renderNotice() {
  const n = $("notice");
  if (!connected() && !lsGet("tafels.noticeDismissed")) {
    n.hidden = false;
    n.replaceChildren(
      el("span", { text: "Je lijst staat nu alleen op dit toestel. Koppel je GitHub-repository om hem veilig te bewaren en op al je apparaten te hebben." }),
      el("div", { class: "inline" },
        el("button", { type: "button", class: "solid", onclick: openSettings }, "Koppel GitHub"),
        el("button", { type: "button", onclick: () => { lsSet("tafels.noticeDismissed", true); renderNotice(); } }, "Later"))
    );
  } else n.hidden = true;
}

/* ---------------- map ---------------- */
let map = null, cluster = null, markers = new Map(), meMarker = null, lastFitCity = null;
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function tileLayer() {
  const style = darkQuery.matches ? "dark_all" : "rastertiles/voyager";
  return L.tileLayer(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, {
    maxZoom: 19, subdomains: "abcd",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  });
}
function pinIcon(cls) { return L.divIcon({ className: "", html: `<div class="pin ${cls}"><i></i></div>`, iconSize: [28, 28], iconAnchor: [14, 28], popupAnchor: [0, -26] }); }

function initMap() {
  if (map || typeof L === "undefined") return;
  const a = area(ui.city);
  map = L.map("map", { zoomControl: true, attributionControl: true }).setView(a.center, a.zoom);
  let tiles = tileLayer().addTo(map);
  darkQuery.addEventListener("change", () => { map.removeLayer(tiles); tiles = tileLayer().addTo(map); });
  cluster = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 40, spiderfyOnMaxZoom: true, disableClusteringAtZoom: 16 });
  map.addLayer(cluster);
  renderMarkers();
}
function popupFor(i) {
  return el("div", { class: "pop" },
    el("h3", { text: i.name }),
    i.notes ? el("p", { text: i.notes }) : null,
    (i.tags && i.tags.length) ? el("div", { class: "tags" }, i.tags.map(t => el("span", { class: "tag", text: t }))) : null,
    linkRow(i, true));
}
function renderMarkers() {
  if (!map) return;
  cluster.clearLayers(); markers.clear();
  const shown = filtered();
  const withPos = shown.filter(i => i.lat != null && i.lng != null);
  withPos.forEach(i => {
    const m = L.marker([i.lat, i.lng], { icon: pinIcon(i.visited ? "been" : ""), title: i.name });
    m.bindPopup(() => popupFor(byId(i.id) || i), { maxWidth: 280 });
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
  const pts = visible().filter(i => i.city === ui.city && i.lat != null).map(i => [i.lat, i.lng]);
  if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
  else { const a = area(ui.city); map.setView(a.center, a.zoom); }
  lastFitCity = ui.city; lastFitCount = pts.length;
}
function showOnMap(id) {
  setView("map");
  const i = byId(id); if (!i || i.lat == null) return;
  setTimeout(() => {
    const m = markers.get(id);
    if (m) cluster.zoomToShowLayer(m, () => m.openPopup());
    else map.setView([i.lat, i.lng], 16);
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
  $("listView").hidden = v !== "list"; $("mapView").hidden = v !== "map";
  $("tabList").setAttribute("aria-pressed", String(v === "list"));
  $("tabMap").setAttribute("aria-pressed", String(v === "map"));
  if (v === "map") {
    if (!map) { initMap(); map.on("locationfound", onLocated); map.on("locationerror", () => toast("Je locatie is niet beschikbaar. Sta locatie toe in je instellingen.")); }
    setTimeout(() => map && map.invalidateSize(), 30);
  }
}
$("tabList").onclick = () => setView("list");
$("tabMap").onclick = () => setView("map");

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

/* ---------------- geocoding (OpenStreetMap Nominatim) ---------------- */
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
async function geocode(i) {
  const a = area(i.city);
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
  visible().forEach(i => { if (i.lat == null && !i.geoFailed && !geoQueue.includes(i.id)) geoQueue.push(i.id); });
  runGeo();
}
async function runGeo() {
  if (geoRunning || !geoQueue.length) { updateGeoProgress(); return; }
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
          if (res) { cur.lat = res.lat; cur.lng = res.lng; cur.geo = "auto"; }
          else cur.geoFailed = true;
          cur.updatedAt = now(); store.dirty = true; persist();
        }
      } catch (e) { geoQueue.shift(); break; } // offline of geweigerd: later opnieuw
    }
    geoQueue.shift(); done++;
    if (done % 5 === 0 || !geoQueue.length) { render(); scheduleSync(); }
  }
  geoRunning = false; render(); updateGeoProgress(); scheduleSync();
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
  $("fNotes").value = item ? item.notes || "" : "";
  $("fAddress").value = item ? item.address || "" : "";
  $("fVisited").checked = !!(item && item.visited);
  $("fNewTag").value = ""; $("fNewCity").value = "";
  formTags = new Set(item ? item.tags || [] : []);
  fillCities(item ? item.city : ui.city);
  renderTagPick();
  const d = $("delBtn"); d.hidden = !item; d.textContent = "Verwijderen"; d.classList.remove("confirm"); d.disabled = false;
  $("fErr").hidden = true;
  $("pinHint").textContent = item && item.geo === "auto" ? "Locatie automatisch gevonden. Klopt hij niet? Tik op de juiste plek op de kaart." : "Tik op de kaart om de pin te zetten of te verplaatsen.";
  showSheet("sheet");
  if (typeof L !== "undefined") {
    if (!miniMap) {
      miniMap = L.map("miniMap", { zoomControl: false, attributionControl: false });
      tileLayer().addTo(miniMap);
      miniMap.on("click", e => { setDraftPin({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6), manual: true }, false); $("pinHint").textContent = "Pin gezet. Vergeet niet op te slaan."; });
    }
    setTimeout(() => {
      miniMap.invalidateSize();
      const a = area(item ? item.city : ui.city);
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
$("addBtn").onclick = () => openSheet(null);
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
    if (res) { setDraftPin({ ...res, manual: false }, true); $("pinHint").textContent = "Gevonden. Klopt het niet? Tik op de juiste plek."; }
    else $("pinHint").textContent = "Niet gevonden. Probeer een adres, of tik zelf op de kaart.";
  } catch (e) { $("pinHint").textContent = "Zoeken lukt nu niet. Tik zelf op de kaart."; }
  b.disabled = false; b.textContent = "Zoek";
};
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
  const item = { ...base, name, url: fixUrl($("fUrl").value), city: c, notes: $("fNotes").value.trim(), address: $("fAddress").value.trim(), tags: [...formTags], visited: $("fVisited").checked };
  delete item.geoFailed;
  if (draftPos) { item.lat = draftPos.lat; item.lng = draftPos.lng; item.geo = draftPos.manual ? "manual" : (draftPos.manual === false ? "auto" : item.geo); }
  else { delete item.lat; delete item.lng; delete item.geo; }
  if (!item.address) delete item.address;
  if (!store.data.cities.includes(c)) store.data.cities.push(c);
  const isNew = !editing;
  ui.city = c; lsSet(LS_UI, ui);
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
        if (!store.dirty) { store.data = remote.data; store.sha = remote.sha; persist(); break; }
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
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && connected()) sync(); });

/* ---------------- settings ---------------- */
function openSettings() {
  $("sOwner").value = settings.owner; $("sRepo").value = settings.repo;
  $("sBranch").value = settings.branch || "main"; $("sPath").value = settings.path || "restaurants.json";
  $("sToken").value = settings.token;
  $("sErr").hidden = true; $("sOk").hidden = true;
  if (connected()) { $("sOk").hidden = false; $("sOk").textContent = syncState.text; }
  $("disconnectBtn").hidden = !connected();
  showSheet("settings");
}
$("syncBtn").onclick = openSettings;
$("setForm").addEventListener("submit", async e => {
  e.preventDefault();
  const next = {
    owner: $("sOwner").value.trim(), repo: $("sRepo").value.trim(),
    branch: $("sBranch").value.trim() || "main", path: $("sPath").value.trim().replace(/^\/+/, "") || "restaurants.json",
    token: $("sToken").value.trim()
  };
  $("sErr").hidden = true; $("sOk").hidden = true;
  if (!next.owner || !next.repo || !next.token) { $("sErr").hidden = false; $("sErr").textContent = "Vul gebruikersnaam, repository en token in."; return; }
  const btn = $("connectBtn"); btn.disabled = true; btn.textContent = "Verbinden…";
  const prev = settings; settings = next;
  try {
    const remote = await ghGet();
    saveSettings();
    if (remote) {
      const merged = merge(remote.data, store.data);
      store.dirty = store.dirty || JSON.stringify(merged.items) !== JSON.stringify(remote.data.items);
      store.data = merged; store.sha = remote.sha;
    } else store.dirty = true;
    persist(); await sync();
    $("sOk").hidden = false; $("sOk").textContent = remote ? `Verbonden. ${visible().length} restaurants geladen.` : "Verbonden. Je lijst is als nieuw bestand opgeslagen.";
    $("disconnectBtn").hidden = false; render();
  } catch (err) {
    settings = prev;
    $("sErr").hidden = false; $("sErr").textContent = err.message || "Verbinden mislukt. Controleer je gegevens.";
  } finally { btn.disabled = false; btn.textContent = "Verbinden"; }
});
$("disconnectBtn").onclick = () => {
  settings = { ...settings, token: "" }; saveSettings();
  setSync("local", "Alleen op dit toestel"); closeSheets(); render(); toast("Ontkoppeld. Je lijst blijft op dit toestel.");
};
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
  await restoreSettings();
  render();
  setView(ui.view === "map" ? "map" : "list");
  if (connected()) await sync();
  else {
    setSync("local", "Alleen op dit toestel");
    if (!store.data.items.length) {
      // Eerste keer zonder koppeling: laad de startlijst als die naast de app staat
      try {
        const r = await fetch("data/restaurants.json", { cache: "no-store" });
        if (r.ok) { store.data = await r.json(); store.dirty = true; persist(); render(); }
      } catch (e) {}
    }
    queueGeocoding();
  }
}
boot();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
