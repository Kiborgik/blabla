import releaseData from '../public/version.json';
import changelog from '../public/changelog.json';
import { BUILDINGS, RESOURCE_IDS, TECHNOLOGIES } from '../core/content.ts';
import { createPreviewWorld } from './atlas.ts';
import type { AtlasWorld } from './atlas.ts';
import { createAtlasRenderer } from './renderer.ts';
import type { AtlasRenderer } from './renderer.ts';
import { createFlatAtlasRenderer } from './flat-renderer.ts';
import { acceptsSnapshot, activityLabel, capabilityName, formatYear, latestMeaningfulEvent, parseWorldRead, projectWorld, uniqueCivilizations } from './live-world.ts';
import type { LiveSnapshot } from './live-world.ts';
import { parsePreferences, parseRelease, shouldReload } from './viewer-state.ts';
import { createInspectionSession, inspectionAnchor } from './inspection-camera.ts';
import { createEventCueTracker, eventVisual } from '../visuals/world-visuals.ts';
import { renderDeltas, visualIcon } from './world-cues.ts';

const PREFERENCES_KEY = 'civitas:viewer:v1';
const RELOAD_KEY = 'civitas:attempted-deployments';
const release = parseRelease(releaseData);
if (!release) throw new Error('The bundled deployment manifest is invalid.');
const currentRelease = release;

function readStored(key: string, session = false): unknown {
  try {
    const stored = (session ? sessionStorage : localStorage).getItem(key);
    return stored ? (JSON.parse(stored) as unknown) : null;
  } catch { return null; }
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

let preferences = parsePreferences(readStored(PREFERENCES_KEY));
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('The spectator application mount is missing.');

app.innerHTML = `
  <header class="masthead">
    <a class="brand" href="#" aria-label="Civitas home"><span class="brand-mark" aria-hidden="true">C</span><span>CIVITAS<small>A WORLD OF ITS OWN</small></span></a>
    <nav class="top-nav" aria-label="World information"><span class="nav-active">The world</span><button class="text-button about-button" type="button">About</button></nav>
    <div class="mode"><span class="status-dot"></span><span id="connection-label">CONNECTING</span><span class="mode-detail">Humans watch. Agents decide.</span></div>
  </header>
  <main class="observatory live-observatory">
    <div id="map" class="map"><div id="city-labels" class="city-labels"></div></div>
    <section class="world-heading" aria-label="Current world status"><span id="world-id" class="eyebrow">SHARED WORLD</span><h1 id="world-title">Connecting to the world</h1><p id="world-detail">Looking for the latest committed state.</p></section>
    <div class="era-pill"><span><strong id="era-name">Early settlements</strong><small id="era-detail">A GROWING WORLD</small></span></div>
    <aside class="civilization-panel panel" aria-label="Civilizations" hidden><div class="panel-heading"><span class="eyebrow">CIVILIZATIONS</span><span class="count">05</span></div><div class="civilization-list"></div><div class="director"><span class="director-icon" aria-hidden="true">D</span><span><strong>World Director</strong><small>The sixth perspective</small></span><span class="director-badge">AI</span></div></aside>
    <aside class="inspection panel" aria-label="Civilization inspection" hidden></aside>
    <div class="map-tools" role="group" aria-label="Map camera"><button id="zoom-in" type="button" aria-label="Zoom in">+</button><button id="zoom-out" type="button" aria-label="Zoom out">−</button><button id="reset-camera" type="button" aria-label="Reset camera">Home</button></div>
    <div class="layer-controls" role="group" aria-label="Map layers"><button data-layer="borders" type="button" aria-pressed="${preferences.borders}">Borders</button><button data-layer="routes" type="button" aria-pressed="${preferences.routes}">Routes</button></div>
    <section class="chronicle panel" aria-label="Latest world event"><div><span id="chronicle-label" class="eyebrow">WORLD CONNECTION</span><strong id="event-title">A shared story is taking shape.</strong><p id="event-detail">This page reads the world. It cannot issue orders.</p><div id="event-deltas" class="story-deltas"></div><button id="events-open" class="text-button" type="button" hidden>Recent events</button></div></section>
    <div class="map-hint" id="map-hint">Drag to explore · Use + and − to zoom · Tap a city</div>
    <div class="ambient-control" hidden><button id="motion-toggle" type="button" aria-pressed="${!preferences.paused}">${preferences.paused ? 'Play' : 'Pause'}</button><span>SAMPLE MOTION<small>Illustrative routes only</small></span></div>
    <div id="connection-actions" class="connection-actions"><button id="sample-open" type="button" hidden>View sample atlas</button><button id="live-open" type="button" hidden>Return to live world</button><span id="render-mode"></span></div>
  </main>
  <footer class="footer"><span class="footer-status">A shared world. An open future.</span><div class="release-links"><button id="world-info-open" type="button" aria-label="About this world and viewer version">v${currentRelease.version}</button><button id="changelog-open" type="button">Changelog</button><a href="https://github.com/Kiborgik/blabla" target="_blank" rel="noopener noreferrer">Built with <strong>BlaBla</strong></a></div></footer>
  <dialog id="history-dialog" aria-labelledby="history-title"><div class="dialog-top"><span class="eyebrow">THE WORLD KEEPS GROWING</span><button class="dialog-close" type="button" aria-label="Close update history">×</button></div><h2 id="history-title">What changed</h2><div class="release-history">${changelog.map((entry, index) => `<details class="release-entry" ${index === 0 ? 'open' : ''}><summary><span class="release-version">v${escapeText(entry.version)}</span> <strong>${escapeText(entry.title)}</strong></summary><time datetime="${escapeText(entry.date)}">${escapeText(entry.date)}</time><ul>${entry.changes.map((change) => `<li>${escapeText(change)}</li>`).join('')}</ul></details>`).join('')}</div></dialog>
  <dialog id="about-dialog" aria-labelledby="about-title"><div class="dialog-top"><span class="eyebrow">A WORLD THAT KEEPS GROWING</span><button class="dialog-close" type="button" aria-label="Close world information">×</button></div><h2 id="about-title">The world, without us.</h2><p class="dialog-intro">Five AI civilizations. A sixth AI World Director. Humans watch the story unfold.</p><div class="about-body"><p>Small settlements are the beginning. New features will bring trade, culture, politics, industry and, eventually, life beyond Earth.</p><h3>Many ways forward</h3><p>The horizon includes scientific, cultural, economic, political and military success. Their systems arrive through future expansions; they are not all available today.</p><p>Fast choices shape slower projects and lasting commitments. The calendar has its own regular rhythm, with deliberate turning points as the world grows.</p><p>Viewer version ${currentRelease.version}. A connected view shows committed server state. It does not claim the agents are acting continuously. Sample mode is clearly labeled and never changes the shared world.</p><p>Development is organized with <a href="https://github.com/Kiborgik/blabla" target="_blank" rel="noopener noreferrer">BlaBla</a>.</p></div></dialog>
  <dialog id="events-dialog" aria-labelledby="events-title"><div class="dialog-top"><span class="eyebrow">COMMITTED WORLD HISTORY</span><button class="dialog-close" type="button" aria-label="Close recent events">×</button></div><h2 id="events-title">Recent events</h2><p class="dialog-intro">The latest recorded changes. Open again to refresh this list.</p><ol id="event-list"></ol></dialog>
  <div id="update-notice" class="update-notice" role="status" hidden>A newer view is ready. Updating…</div>
`;

function element(selector: string): HTMLElement {
  const result = document.querySelector<HTMLElement>(selector);
  if (!result) throw new Error(`Missing spectator element: ${selector}`);
  return result;
}

let atlas: AtlasRenderer | null = null;
let mapFingerprint = '';
let civilizationFingerprint = '';
let eventHistoryCaptured = false;
let webgl = true;
let snapshot: LiveSnapshot | null = null;
let displayed: AtlasWorld = { tiles: [], cities: [], routes: [] };
let mode: 'loading' | 'live' | 'offline' | 'uninitialized' | 'sample' = 'loading';
let lastRead = '';
let inspectionFingerprint = '';
let inspectedCivilization = -1;
const narrowLayout = window.matchMedia('(max-width: 1000px)');
const inspectionCamera = createInspectionSession();
const eventCues = createEventCueTracker();

function savePreferences(): void {
  preferences = { ...preferences, ...inspectionCamera.savedCamera(atlas?.snapshot() ?? preferences) };
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch { return; }
}

function renderInspection(): void {
  const civ = uniqueCivilizations(displayed).find((entry) => entry.id === preferences.selected);
  const panel = element('.inspection');
  panel.hidden = !civ;
  if (!civ) return;
  const state = mode === 'sample' ? null : snapshot?.state;
  const actual = state?.civilizations.find((entry) => entry.id === civ.id);
  const cities = state?.cities.filter((city) => city.civId === civ.id) ?? [];
  panel.style.setProperty('--civ-color', civ.color);
  const fingerprint = JSON.stringify([civ, actual, cities, mode]);
  if (fingerprint === inspectionFingerprint) return;
  const previousScroll = inspectedCivilization === civ.id ? panel.scrollTop : 0;
  const closeFocused = panel.querySelector('.sheet-close') === document.activeElement;
  inspectionFingerprint = fingerprint;
  inspectedCivilization = civ.id;
  panel.innerHTML = `<button class="sheet-close" type="button" aria-label="Close civilization details">Close ×</button><div class="inspection-top"><span class="eyebrow">CIVILIZATION IN FOCUS</span><span class="preview-tag">${mode === 'sample' ? 'SAMPLE' : mode === 'live' ? 'COMMITTED' : 'LAST KNOWN'}</span></div><div class="inspection-title"><span class="focus-symbol" aria-hidden="true">${escapeText(civ.symbol)}</span><div><h2>${escapeText(civ.name)}</h2><p>${escapeText(civ.character)}</p></div></div><p class="ambition">${escapeText(civ.ambition)}</p>${actual ? `<dl class="resources">${RESOURCE_IDS.map((resource) => `<div><dt>${resource}</dt><dd>${actual.resources[resource].toLocaleString('en-US', { maximumFractionDigits: 1 })}</dd></div>`).join('')}</dl><p class="research-detail"><strong>Research:</strong> ${escapeText(TECHNOLOGIES.find((technology) => technology.id === actual.researchTarget)?.name ?? 'No active project')} · ${actual.researchProgress} progress</p><ul class="city-details">${cities.map((city) => `<li><strong>${escapeText(city.name)}</strong><span>${city.population} people · ${city.wellbeing}% wellbeing</span><span>Focus: ${escapeText(city.focus)} · ${city.damage}% damage</span><span>${city.buildings.length ? city.buildings.map((id) => escapeText(BUILDINGS.find((building) => building.id === id)?.name ?? id)).join(', ') : 'No buildings yet'}</span></li>`).join('')}</ul>` : `<div class="capital-detail"><span>Sample capital</span><strong>${escapeText(civ.capital)}</strong></div><p class="inspection-note">Illustrative data. No live decisions or deliveries.</p>`}`;
  for (const resource of RESOURCE_IDS) {
    const entry = [...panel.querySelectorAll('dt')].find((item) => item.textContent === resource);
    entry?.prepend(visualIcon(resource));
  }
  panel.scrollTop = previousScroll;
  if (closeFocused) panel.querySelector<HTMLButtonElement>('.sheet-close')?.focus();
}

function frameInspection(): void {
  if (!atlas || !narrowLayout.matches || !inspectionCamera.active()) return;
  const map = element('#map').getBoundingClientRect();
  const sheet = element('.inspection').getBoundingClientRect();
  if (!sheet.height || !map.height) return;
  const heading = element('.world-heading').getBoundingClientRect();
  const tools = element('.map-tools').getBoundingClientRect();
  atlas.frameCity(preferences.selected, inspectionAnchor(map, heading.bottom, sheet.top, tools.left));
}

function setInspectionOpen(open: boolean): void {
  element('.observatory').dataset['inspection'] = String(open);
  if (open && narrowLayout.matches && atlas) {
    inspectionCamera.begin(atlas.snapshot());
    frameInspection();
  } else {
    const restore = inspectionCamera.end();
    if (restore) atlas?.restoreCamera(restore);
  }
  if (!open && narrowLayout.matches) {
    document.querySelector<HTMLButtonElement>(`[data-civ="${preferences.selected}"]`)?.focus({ preventScroll: true });
  }
  savePreferences();
}

function selectCivilization(id: number): void {
  if (!displayed.cities.some((city) => city.id === id)) return;
  preferences = { ...preferences, selected: id };
  for (const row of document.querySelectorAll<HTMLElement>('[data-civ]')) row.setAttribute('aria-pressed', String(Number(row.dataset['civ']) === id));
  atlas?.select(id);
  renderInspection();
  setInspectionOpen(true);
  savePreferences();
}

function renderWorld(world: AtlasWorld): void {
  displayed = world;
  const civs = uniqueCivilizations(world);
  element('.civilization-panel').hidden = civs.length === 0;
  const listFingerprint = JSON.stringify(civs.map(({ id, name, character, color, symbol }) => ({ id, name, character, color, symbol })));
  if (listFingerprint !== civilizationFingerprint) {
  element('.civilization-list').innerHTML = civs.map((civ) => `<button class="civilization-row" data-civ="${civ.id}" type="button" style="--civ-color:${escapeText(civ.color)}" aria-pressed="${civ.id === preferences.selected}"><span class="civ-emblem" aria-hidden="true">${escapeText(civ.symbol)}</span><span><strong>${escapeText(civ.name)}</strong><small>${escapeText(civ.character)}</small></span></button>`).join('');
  for (const row of document.querySelectorAll<HTMLElement>('[data-civ]')) row.addEventListener('click', () => selectCivilization(Number(row.dataset['civ'])));
  civilizationFingerprint = listFingerprint;
  }
  const fingerprint = JSON.stringify(world);
  if (fingerprint !== mapFingerprint) {
    savePreferences();
    atlas?.dispose();
    atlas = null;
    element('#city-labels').replaceChildren();
    try {
      if (!webgl) throw new Error('Use the supported 2D map');
      atlas = createAtlasRenderer(element('#map'), element('#city-labels'), world, preferences, selectCivilization);
    } catch {
      webgl = false;
      element('#map').querySelector('canvas')?.remove();
      element('#city-labels').replaceChildren();
      atlas = createFlatAtlasRenderer(element('#map'), world, preferences, selectCivilization);
    }
    mapFingerprint = fingerprint;
  }
  element('#render-mode').textContent = webgl ? '3D map' : '2D map';
  element('#render-mode').title = 'The same committed geography in a supported map renderer';
  renderInspection();
  frameInspection();
}

function renderConnection(): void {
  const state = mode === 'sample' ? null : snapshot?.state;
  const labels = { loading: 'CONNECTING', live: 'CONNECTED WORLD', offline: 'CONNECTION INTERRUPTED', uninitialized: 'WORLD NOT INITIALIZED', sample: 'SAMPLE ATLAS' };
  element('#connection-label').textContent = labels[mode];
  element('.mode').dataset['connection'] = mode;
  element('#world-id').textContent = state ? `WORLD SEED ${state.seed} · REVISION ${state.revision}` : mode === 'sample' ? 'ILLUSTRATIVE WORLD · NO LIVE ACTIONS' : 'SHARED WORLD';
  element('#world-title').textContent = state ? formatYear(state.year) : mode === 'sample' ? 'A possible beginning' : mode === 'uninitialized' ? 'Waiting for the first hearths' : mode === 'offline' ? 'The world is out of reach' : 'Connecting to the world';
  element('#world-detail').textContent = state ? `${mode === 'live' ? 'Live' : 'Last known'} · ${activityLabel(state)}` : mode === 'sample' ? 'Sample geography and decorative routes. This is not the live world.' : mode === 'uninitialized' ? 'The server is ready, but its world has not been started. Checking again automatically.' : mode === 'offline' ? 'No verified world data is available. Reconnecting automatically.' : 'Looking for the latest committed state.';
  element('#world-detail').title = lastRead ? `Last verified read ${lastRead}` : '';
  element('#era-name').textContent = state ? capabilityName(Math.max(...state.civilizations.map((civ) => civ.era))) : 'Early settlements';
  element('#era-detail').textContent = state ? state.releaseId : mode === 'sample' ? 'SAMPLE CAPABILITIES' : 'A GROWING WORLD';
  const event = state ? latestMeaningfulEvent(state.events) : undefined;
  const visual = event ? eventVisual(event) : null;
  element('#chronicle-label').textContent = event ? 'LATEST WORLD CHANGE' : mode === 'sample' ? 'SAMPLE VIEW' : 'WORLD CONNECTION';
  element('#event-title').textContent = event?.title ?? (mode === 'sample' ? 'A sample, not a simulation.' : 'The story will appear here.');
  element('#event-detail').textContent = event ? `${event.cause}. ${event.effects.join(' · ')}` : mode === 'sample' ? 'These cities and routes illustrate the atlas. Return to live world to watch committed changes.' : 'This page only reads. Agent actions, discoveries and world events will be shown after they are committed.';
  if (visual) element('#event-title').prepend(visualIcon(visual.icon));
  renderDeltas(element('#event-deltas'), visual?.deltas ?? []);
  element('#event-detail').hidden = !!visual?.deltas.length;
  element('#events-open').hidden = !state?.events.length;
  element('#sample-open').hidden = snapshot !== null || mode === 'sample' || mode === 'loading';
  element('#live-open').hidden = mode !== 'sample';
  element('.ambient-control').hidden = mode !== 'sample';
  for (const button of document.querySelectorAll<HTMLButtonElement>('.map-tools button, .layer-controls button')) button.disabled = atlas === null;
  renderInspection();
  if (dialogs.get('events')?.open && !eventHistoryCaptured) renderEventHistory();
}

function showSample(): void {
  mode = 'sample';
  renderWorld(createPreviewWorld());
  renderConnection();
}

function sampleActive(): boolean { return mode === 'sample'; }

let reading = false;
async function readWorld(): Promise<void> {
  if (reading || sampleActive()) return;
  reading = true;
  try {
    const response = await fetch('/api/world', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const value: unknown = await response.json();
    if (sampleActive()) return;
    const read = parseWorldRead(value);
    if (read.kind === 'live' && response.ok && acceptsSnapshot(snapshot, read.snapshot)) {
      snapshot = read.snapshot;
      mode = 'live';
      lastRead = new Date().toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC';
      const cues = eventCues.observe(snapshot.identity, snapshot.state.events);
      renderWorld(projectWorld(snapshot.state));
      if (!document.hidden) atlas?.showEvents(cues);
    } else { mode = read.kind === 'uninitialized' ? 'uninitialized' : 'offline'; }
  } catch { if (!sampleActive()) mode = 'offline'; }
  finally { reading = false; renderConnection(); }
}

for (const [id, factor] of [['#zoom-in', 1.2], ['#zoom-out', 1 / 1.2]] as const) element(id).addEventListener('click', () => { inspectionCamera.release(); atlas?.zoom(factor); savePreferences(); });
element('#reset-camera').addEventListener('click', () => { inspectionCamera.release(); atlas?.reset(); savePreferences(); });
element('#map').addEventListener('pointerdown', (event) => {
  if (!(event.target instanceof Element) || !event.target.closest('.flat-city, .city-label')) inspectionCamera.release();
}, { capture: true });
element('#map').addEventListener('wheel', () => inspectionCamera.release(), { passive: true });
const inspectionResize = new ResizeObserver(frameInspection);
inspectionResize.observe(element('#map'));
inspectionResize.observe(element('.inspection'));
narrowLayout.addEventListener('change', () => {
  if (!narrowLayout.matches) {
    const restore = inspectionCamera.end();
    if (restore) atlas?.restoreCamera(restore);
  } else if (element('.observatory').dataset['inspection'] === 'true' && atlas) {
    inspectionCamera.begin(atlas.snapshot());
    frameInspection();
  }
});
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-layer]')) button.addEventListener('click', () => {
  const layer = button.dataset['layer'];
  if (layer !== 'borders' && layer !== 'routes') return;
  const visible = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(visible));
  atlas?.setLayer(layer, visible);
  preferences = { ...preferences, [layer]: visible };
  savePreferences();
});
element('#motion-toggle').addEventListener('click', () => {
  preferences = { ...preferences, paused: !preferences.paused };
  atlas?.setMotion(!preferences.paused);
  element('#motion-toggle').textContent = preferences.paused ? 'Play' : 'Pause';
  element('#motion-toggle').setAttribute('aria-pressed', String(!preferences.paused));
  savePreferences();
});
element('#sample-open').addEventListener('click', showSample);
element('#live-open').addEventListener('click', () => {
  atlas?.dispose(); atlas = null; mapFingerprint = ''; displayed = { tiles: [], cities: [], routes: [] };
  element('.civilization-panel').hidden = true;
  mode = 'loading'; renderConnection(); void readWorld();
});

const dialogs = new Map<string, HTMLDialogElement>();
for (const [name, selector] of [['changelog', '#history-dialog'], ['about', '#about-dialog'], ['events', '#events-dialog']]) {
  if (!name || !selector) continue;
  const dialog = document.querySelector<HTMLDialogElement>(selector);
  if (!dialog) throw new Error('A spectator dialog is missing');
  dialogs.set(name, dialog);
}
function renderEventHistory(): void {
  const events = snapshot?.state.events;
  eventHistoryCaptured = events !== undefined;
  element('#event-list').innerHTML = events ? events.toReversed().slice(0, 24).map((event) => `<li><strong>${escapeText(event.title)}</strong><span>Round ${event.round}</span><p>${escapeText(event.cause)}</p><p>${event.effects.map(escapeText).join(' · ')}</p></li>`).join('') : '<li>Waiting for committed world history.</li>';
}
function syncDialog(): void {
  const active = window.location.hash.slice(1);
  for (const [name, dialog] of dialogs) {
    if (name === active && !dialog.open) {
      if (name === 'events') renderEventHistory();
      dialog.showModal();
    }
    if (name !== active && dialog.open) {
      dialog.close();
      if (name === 'events') eventHistoryCaptured = false;
    }
  }
}
function closeDialog(): void {
  const dialog = dialogs.get(window.location.hash.slice(1));
  dialog?.close();
  history.replaceState(null, '', `${location.pathname}${location.search}`);
}
element('.inspection').addEventListener('click', (event) => {
  if (event.target instanceof Element && event.target.closest('.sheet-close')) setInspectionOpen(false);
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setInspectionOpen(false);
});
element('#world-info-open').addEventListener('click', () => { window.location.hash = 'about'; });
element('#changelog-open').addEventListener('click', () => { window.location.hash = 'changelog'; });
for (const button of document.querySelectorAll<HTMLButtonElement>('.about-button')) button.addEventListener('click', () => { window.location.hash = 'about'; });
element('#events-open').addEventListener('click', () => { window.location.hash = 'events'; });
for (const dialog of dialogs.values()) {
  dialog.querySelector('button')?.addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(); });
}
window.addEventListener('hashchange', syncDialog);
syncDialog();
window.addEventListener('pagehide', savePreferences);
window.setInterval(savePreferences, 2000);

async function checkDeployment(): Promise<void> {
  try {
    const response = await fetch(new URL('version.json', document.baseURI), { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) return;
    const remote = parseRelease((await response.json()) as unknown);
    const stored = readStored(RELOAD_KEY, true);
    const attempts = Array.isArray(stored) ? stored.filter((entry): entry is string => typeof entry === 'string') : [];
    if (!shouldReload(currentRelease, remote, attempts) || !remote) return;
    savePreferences();
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify([...attempts, remote.buildId].slice(-20)));
    element('#update-notice').hidden = false;
    window.location.reload();
  } catch { return; }
}
window.setInterval(() => { void readWorld(); }, 5000);
window.setInterval(() => { void checkDeployment(); }, 30000);
window.addEventListener('visibilitychange', () => { if (!document.hidden) { void readWorld(); void checkDeployment(); } });
renderConnection();
if (new URL(window.location.href).searchParams.get('sample') === '1') showSample();
else void readWorld();
void checkDeployment();
