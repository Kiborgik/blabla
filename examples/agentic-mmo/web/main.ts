import { exactNumber, numberPresentation } from './number-format.ts';
import { observedStrategicResources } from '../core/simulation/metals.ts';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import { createCapabilityTreeSheet, restoreCapabilityOpener, type CapabilityTreeInput } from './capability-tree.ts';
import { eventLogEntries, latestStoryEvent, renderEventLog } from './event-log.ts';
import { routeInspectionCity } from '../visuals/route-visuals.ts';
import { renderRouteCard, renderRouteList, retainedRoutePathInspection, routeInspectionIdentity } from './route-inspection.ts';
import { cityKey, resolveCitySelection, retainedReceiptBuilding } from './city-selection.ts';
import { renderSettlementInspection, residentSupportForWorld, renderStrategicInspection } from './settlement-inspection.ts';
import { researchProgressPresentation } from './research-progress.ts';
import releaseData from '../public/version.json';
import changelog from '../public/changelog.json';
import { RESOURCE_IDS, TECHNOLOGIES } from '../core/content.ts';
import { createPreviewWorld } from './atlas.ts';
import type { AtlasWorld } from './atlas.ts';
import { createAtlasRenderer } from './renderer.ts';
import type { AtlasRenderer } from './renderer.ts';
import { createFlatAtlasRenderer } from './flat-renderer.ts';
import { acceptsSnapshot, activityLabel, capabilityName, formatYear, parseWorldRead, projectWorld, uniqueCivilizations } from './live-world.ts';
import type { LiveSnapshot } from './live-world.ts';
import { parseRelease } from './viewer-state.ts';
import { createViewerUpdates, preferencesAfterUpdate } from './viewer-updates.ts';
import { createInspectionSession, inspectionAnchor } from './inspection-camera.ts';
import { eventVisual } from '../visuals/world-visuals.ts';
import type { RouteResultCue } from '../visuals/route-cues.ts';
import { createCueStream, renderDeltas, routeResultPresentation, visualIcon } from './world-cues.ts';
import { resourceGuide } from './viewer-appearance.ts';
import { mountViewerSettings } from './viewer-settings.ts';
import type { Resource } from '../core/types.ts';

const PREFERENCES_KEY = 'civitas:viewer:v1';
const RELOAD_KEY = 'civitas:attempted-deployments';
const release = parseRelease(releaseData);
if (!release) throw new Error('The bundled deployment manifest is invalid.');
const currentRelease = release;

function readStored(key: string): unknown {
  try {
    const stored = localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as unknown) : null;
  } catch { return null; }
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function readHistory(): unknown {
  try { return history.state as unknown; } catch { return null; }
}
let preferences = preferencesAfterUpdate(currentRelease.buildId, readStored(PREFERENCES_KEY), readHistory());
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('The spectator application mount is missing.');

app.innerHTML = `
  <header class="masthead">
    <a class="brand" href="#" aria-label="Civitas home"><span class="brand-mark" aria-hidden="true">C</span><span>CIVITAS<small>A WORLD OF ITS OWN</small></span></a>
    <nav class="top-nav" aria-label="World information"><span class="nav-active">The world</span><button id="events-nav" class="events-nav" data-open-events type="button">Events</button><button class="text-button about-button" type="button">About</button><button id="settings-open" class="text-button" type="button" aria-label="Viewer settings">Settings</button></nav>
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
    <section class="chronicle panel" aria-label="Latest world event"><div><span id="chronicle-label" class="eyebrow">WORLD CONNECTION</span><strong id="event-title">A shared story is taking shape.</strong><p id="event-detail">This page reads the world. It cannot issue orders.</p><div id="event-deltas" class="story-deltas" tabindex="0" aria-label="Latest event amounts; scroll for all recorded amounts"></div><button id="events-open" class="text-button" data-open-events type="button" hidden>Recent events</button></div></section>
    <div class="map-hint" id="map-hint">Drag to explore · Use + and − to zoom · Tap a city or route</div>
    <div id="connection-actions" class="connection-actions"><button id="sample-open" type="button" hidden>View sample atlas</button><button id="live-open" type="button" hidden>Return to live world</button><span id="render-mode"></span></div>
  </main>
  <footer class="footer"><span class="footer-status">A shared world. An open future.</span><div class="release-links"><button id="world-info-open" type="button" aria-label="About this world and viewer version">v${currentRelease.version}</button><button id="changelog-open" type="button">Changelog</button><a href="https://github.com/Kiborgik/blabla" target="_blank" rel="noopener noreferrer">Built with <strong>BlaBla</strong></a></div></footer>
  <dialog id="history-dialog" aria-labelledby="history-title"><div class="dialog-top"><span class="eyebrow">THE WORLD KEEPS GROWING</span><button class="dialog-close" type="button" aria-label="Close update history">×</button></div><h2 id="history-title">What changed</h2><div class="release-history">${changelog.map((entry, index) => `<details class="release-entry" ${index === 0 ? 'open' : ''}><summary><span class="release-version">v${escapeText(entry.version)}</span> <strong>${escapeText(entry.title)}</strong></summary><time datetime="${escapeText(entry.date)}">${escapeText(entry.date)}</time><ul>${entry.changes.map((change) => `<li>${escapeText(change)}</li>`).join('')}</ul></details>`).join('')}</div></dialog>
  <dialog id="about-dialog" aria-labelledby="about-title"><div class="dialog-top"><span class="eyebrow">A WORLD THAT KEEPS GROWING</span><button class="dialog-close" type="button" aria-label="Close world information">×</button></div><h2 id="about-title">The world, without us.</h2><p class="dialog-intro">Five AI civilizations. A sixth AI World Director. Humans watch the story unfold.</p><div class="about-body"><p>Settlements grow through research, construction, production and consenting trade. The applied world release determines which branches are available; inspect the tree for current requirements.</p><h3>Many ways forward</h3><p>The horizon includes scientific, cultural, economic, political and military success. Their systems arrive through future expansions; they are not all available today.</p><p>Fast choices shape slower projects and lasting commitments. The calendar has its own regular rhythm, with deliberate turning points as the world grows.</p><p>Viewer version ${currentRelease.version}. A connected view shows committed server state. It does not claim the agents are acting continuously. Sample mode is clearly labeled and never changes the shared world.</p><p>Development is organized with <a href="https://github.com/Kiborgik/blabla" target="_blank" rel="noopener noreferrer">BlaBla</a>.</p></div></dialog>
  <dialog id="events-dialog" aria-labelledby="events-title"><div class="dialog-top"><span class="eyebrow">THE WORLD STORY</span><button class="dialog-close" type="button" aria-label="Close recent events">×</button></div><h2 id="events-title">What changed</h2><p class="dialog-intro">Key events first. Filter by civilization or kind, then open a record for details.</p><button id="events-refresh" type="button" hidden>New events available · Refresh</button><ol id="event-list"></ol></dialog>
  <dialog id="capability-dialog"></dialog>
  <dialog id="settings-dialog" aria-labelledby="settings-title"><div class="dialog-top"><span class="eyebrow">YOUR VIEW</span><button class="dialog-close" type="button" aria-label="Close viewer settings">×</button></div><h2 id="settings-title">Viewer settings</h2><p class="dialog-intro">Changes only how you see the world.</p><div class="viewer-options"><label for="viewer-theme">Theme</label><select id="viewer-theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select><p>System follows your device theme.</p><label for="viewer-effects">Effects</label><select id="viewer-effects" aria-describedby="effects-explanation system-motion-note"><option value="calm">Calm</option><option value="rich">Rich</option><option value="cinematic">Cinematic</option></select><p id="effects-explanation"></p><p id="system-motion-note" role="status" hidden>Your device requests reduced motion. Calm is active.</p></div><fieldset class="settings-layers"><legend>Map layers</legend><button data-layer="borders" type="button" aria-pressed="${preferences.borders}">Borders</button><button data-layer="routes" type="button" aria-pressed="${preferences.routes}">Routes</button></fieldset><p class="settings-note">Preferences are kept on this browser when storage is available. No change to agent choices or world speed.</p></dialog>
  <dialog id="resource-dialog" aria-labelledby="resource-title"><div class="dialog-top"><span class="eyebrow">RESOURCE GUIDE</span><button class="dialog-close" type="button" aria-label="Close resource guide">×</button></div><h2 id="resource-title">Resources</h2><p id="resource-explanation" class="dialog-intro">Select a resource in city details to learn more.</p><p class="resource-reading">The city panel shows the amount stored by the civilization. <strong>Made</strong> is production before food use and other costs. <strong>+</strong> and <strong>−</strong> show recorded gains and losses. <strong>Base / season</strong> is production capacity, not goods already made.</p></dialog>
  <div id="update-notice" class="update-notice panel" hidden><p id="update-status" role="status"></p><button id="update-action" type="button" hidden>Update view</button></div>
`;

function element(selector: string): HTMLElement {
  const result = document.querySelector<HTMLElement>(selector);
  if (!result) throw new Error(`Missing spectator element: ${selector}`);
  return result;
}

let atlas: AtlasRenderer | null = null;
let selectedRoute: string | null = null;
let routeListPage = 0;
let mapFingerprint = '';
let civilizationFingerprint = '';
let eventHistoryCaptured = false;
let eventHistoryRevision = -1;
let webgl = true;
let snapshot: LiveSnapshot | null = null;
let displayed: AtlasWorld = { tiles: [], cities: [], routes: [] };
let mode: 'loading' | 'live' | 'offline' | 'uninitialized' | 'sample' = 'loading';
let lastRead = '';
let observedAt = '';
const catalogue = capabilityCatalogue();
let inspectionFingerprint = '';
let inspectedCivilization = -1;
let inspectedCity: string | null = null;
const narrowLayout = window.matchMedia('(max-width: 1000px)');
const inspectionCamera = createInspectionSession();
const eventCues = createCueStream();
let observedRouteResults: RouteResultCue[] = [];
const settingsDialog = document.querySelector<HTMLDialogElement>('#settings-dialog');
if (!settingsDialog) throw new Error('Viewer settings dialog is missing');
const viewerSettings = mountViewerSettings(settingsDialog, () => preferences, (value) => {
  preferences = { ...preferences, ...value, paused: value.effects === 'calm' };
  savePreferences();
}, (moving) => atlas?.setMotion(moving));

const capabilityDialog = document.querySelector<HTMLDialogElement>('#capability-dialog');
if (!capabilityDialog) throw new Error('The capability tree dialog is missing');
const capabilityTree = createCapabilityTreeSheet(capabilityDialog, (id) => {
  selectCity(id);
  const input = currentCapabilityInput();
  if (input) capabilityTree.observe(input);
}, () => {
  restoreCapabilityOpener(() => element('.inspection').hidden ? null : element('.inspection').querySelector<HTMLButtonElement>('[data-open-capabilities]'), () => setInspectionOpen(true));
});

function currentCapabilityInput(): CapabilityTreeInput | null {
  if (!snapshot || mode === 'sample' || !observedAt) return null;
  const civilization = snapshot.state.civilizations.find(candidate => candidate.id === preferences.selected);
  if (!civilization) return null;
  return {
    runId: snapshot.identity, civilizationName: civilization.name,
    towns: snapshot.state.cities.filter(city => city.civId === civilization.id).map(city => ({ id: city.id, name: city.name })),
    catalogue,
    researchEvents: snapshot.state.events.filter(event => event.type === 'settlement-production' && event.actor === civilization.id).slice(-1),
    projection: projectCapabilities(snapshot.state, civilization.id, preferences.selectedCity, observedAt),
  };
}

function savePreferences(): void {
  preferences = { ...preferences, ...inspectionCamera.savedCamera(atlas?.snapshot() ?? preferences) };
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch { return; }
}

function renderInspection(): void {
  const civ = uniqueCivilizations(displayed).find((entry) => entry.id === preferences.selected);
  const panel = element('.inspection');
  const route = displayed.routes.find((entry) => entry.id === selectedRoute);
  panel.hidden = !civ && !route;
  if (route) {
    const fingerprint = JSON.stringify(['route', route, routeListPage, displayed.routes, mode]);
    if (fingerprint === inspectionFingerprint) return;
    const sameRoute = panel.dataset['routeId'] === routeInspectionIdentity(route);
    const pathDetails = panel.querySelector<HTMLDetailsElement>('.route-path-tiles');
    const pathInspection = retainedRoutePathInspection(panel.dataset['routeId'], route, pathDetails?.open ?? false, Number(pathDetails?.dataset['page'] ?? 0));
    const scroll = sameRoute ? panel.scrollTop : 0;
    const focused = document.activeElement instanceof HTMLElement ? document.activeElement.dataset['routeFocus'] : undefined;
    inspectionFingerprint = fingerprint;
    panel.dataset['routeId'] = routeInspectionIdentity(route);
    panel.replaceChildren();
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sheet-close route-close';
    close.textContent = 'Close ×';
    close.dataset['routeFocus'] = 'close';
    close.setAttribute('aria-label', 'Close trade route details');
    panel.append(close);
    renderRouteCard(panel, route, selectCity, pathInspection);
    renderRouteList(panel, displayed.routes, selectedRoute, routeListPage, selectRoute, selectRoutePage);
    if (sameRoute && focused) [...panel.querySelectorAll<HTMLElement>('[data-route-focus]')].find((node) => node.dataset['routeFocus'] === focused)?.focus({ preventScroll: true });
    panel.scrollTop = scroll;
    return;
  }
  delete panel.dataset['routeId'];
  if (!civ) return;
  const state = mode === 'sample' ? null : snapshot?.state;
  const actual = state?.civilizations.find((entry) => entry.id === civ.id);
  const cities = state?.cities.filter((city) => city.civId === civ.id) ?? [];
  const residentSupport = residentSupportForWorld(state ?? null, cities);
  const technology = TECHNOLOGIES.find(candidate => candidate.id === actual?.researchTarget);
  const research = actual && state ? researchProgressPresentation({
    unlockedFeatures: state.unlockedFeatures, civilizationId: actual.id, events: state.events,
    project: technology ? { name: technology.name, cost: technology.cost, progress: actual.researchProgress } : null,
  }) : null;
  panel.style.setProperty('--civ-color', civ.color);
  const fingerprint = JSON.stringify([civ, actual, cities, residentSupport, research, preferences.selectedCity, displayed.routes, routeListPage, mode]);
  if (fingerprint === inspectionFingerprint) return;
  const sameCity = inspectedCivilization === civ.id && inspectedCity === preferences.selectedCity;
  const previousScroll = sameCity ? panel.scrollTop : 0;
  const selectedSection = sameCity ? panel.dataset['inspectionView'] ?? 'overview' : 'overview';
  const selectedWork = sameCity ? panel.querySelector<HTMLElement>('.city-details')?.dataset['selectedWork'] ?? '' : '';
  const focusedInspection = sameCity && document.activeElement instanceof HTMLElement ? document.activeElement.dataset['inspectionFocus'] : undefined;
  const expandedBuildings = new Set([...panel.querySelectorAll<HTMLElement>('.building-card')].filter((card) => sameCity && card.querySelector<HTMLDetailsElement>('details')?.open).map((card) => card.dataset['building']));
  const focusedRoute = document.activeElement instanceof HTMLElement ? document.activeElement.dataset['routeFocus'] : undefined;
  const closeFocused = panel.querySelector('.sheet-close') === document.activeElement;
  const treeFocused = panel.querySelector('[data-open-capabilities]') === document.activeElement;
  const focusedResource = document.activeElement instanceof HTMLElement ? document.activeElement.dataset['resource'] : undefined;
  const focusedCity = document.activeElement instanceof HTMLElement ? document.activeElement.dataset['citySelect'] : undefined;
  const focusedSummary = document.activeElement instanceof HTMLElement && document.activeElement.matches('.operation-receipt > summary')
    ? document.activeElement.closest<HTMLElement>('.building-card')?.dataset['building'] : undefined;
  const expandedTown = new Set([...panel.querySelectorAll<HTMLDetailsElement>('[data-town-disclosure]')].filter(node => sameCity && node.open).map(node => node.dataset['townDisclosure']));
  const focusedTown = sameCity && document.activeElement instanceof HTMLElement && document.activeElement.matches('.town-receipt > summary')
    ? document.activeElement.parentElement?.dataset['townDisclosure'] : undefined;
  const focusedReceipt = retainedReceiptBuilding(inspectedCity, preferences.selectedCity, focusedSummary);
  inspectionFingerprint = fingerprint;
  inspectedCivilization = civ.id;
  inspectedCity = preferences.selectedCity;
  panel.innerHTML = `<button class="sheet-close" type="button" aria-label="Close civilization details">Close ×</button><div class="inspection-top"><span class="eyebrow">CIVILIZATION IN FOCUS</span><span class="preview-tag">${mode === 'sample' ? 'SAMPLE' : mode === 'live' ? 'COMMITTED' : 'LAST KNOWN'}</span></div><div class="inspection-title"><span class="focus-symbol" aria-hidden="true">${escapeText(civ.symbol)}</span><div><h2>${escapeText(civ.name)}</h2><p>${escapeText(cities.find(city => city.id === preferences.selectedCity)?.name ?? civ.character)}</p></div></div><details class="ambition" data-inspection-section="overview"><summary>Civilization aim</summary><p>${escapeText(civ.ambition)}</p></details>${actual ? `<dl class="resources resource-rail" data-inspection-section="overview" aria-label="Civilization stored resources">${RESOURCE_IDS.map((resource) => `<div><dt><button class="resource-help" type="button" data-resource="${resource}" aria-label="${resourceGuide(resource).label}: ${exactNumber(actual.resources[resource])} stored. Inspect exact value and meaning."><span class="resource-amount">${numberPresentation(actual.resources[resource]).short}</span><span class="resource-name">${resourceGuide(resource).label}</span></button></dt><dd class="sr-only">${exactNumber(actual.resources[resource])} stored</dd></div>`).join('')}</dl><section class="research-detail" data-inspection-section="overview" aria-label="Research progress"></section><button class="capability-open" data-inspection-section="overview" data-open-capabilities type="button" aria-haspopup="dialog">Research &amp; buildings <span>Full tree · Options now</span></button><section class="city-details" aria-label="Selected settlement"></section>` : `<div class="capital-detail"><span>Sample capital</span><strong>${escapeText(civ.capital)}</strong></div><p class="inspection-note">Illustrative data. No live decisions or deliveries.</p>`}`;
  const capabilityOpener = panel.querySelector('[data-open-capabilities]');
  if (capabilityOpener) panel.insertBefore(capabilityOpener, panel.querySelector('.city-details'));
  const navigation = document.createElement('div'); navigation.className = 'inspection-sections'; navigation.setAttribute('role', 'group'); navigation.setAttribute('aria-label', 'Town inspection sections');
  const chooseSection = (name: string): void => {
    panel.dataset['inspectionView'] = name;
    for (const section of panel.querySelectorAll<HTMLElement>('[data-inspection-section]')) section.hidden = section.dataset['inspectionSection'] !== name;
    for (const button of navigation.querySelectorAll<HTMLButtonElement>('button')) button.setAttribute('aria-pressed', String(button.dataset['inspectionFocus'] === name));
    if (narrowLayout.matches) frameInspection();
  };
  for (const [name, label] of [['overview', 'Town'], ['work', 'Work'], ['routes', 'Routes']]) {
    if (!name || !label) continue; const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset['inspectionFocus'] = name; button.addEventListener('click', () => { chooseSection(name); panel.scrollTop = 0; }); navigation.append(button);
  }
  panel.insertBefore(navigation, panel.querySelector('.research-detail') ?? panel.querySelector('.ambition')); 
  for (const resource of RESOURCE_IDS) {
    const entry = panel.querySelector<HTMLButtonElement>(`[data-resource="${resource}"]`);
    entry?.prepend(visualIcon(resource));
  }
  const researchSection = panel.querySelector<HTMLElement>('.research-detail');
  if (research && researchSection) {
    const heading = document.createElement('strong');
    heading.textContent = research.heading;
    heading.prepend(visualIcon('science'));
    researchSection.append(heading);
    if (research.progress) {
      const progress = document.createElement('p');
      progress.textContent = `${research.progress} · ${research.remaining ?? ''}`;
      researchSection.append(progress);
    }
    const details = document.createElement('details');
    details.className = 'town-receipt'; details.dataset['townDisclosure'] = 'research';
    const summary = document.createElement('summary'); summary.textContent = 'How research advances';
    const explanation = document.createElement('p'); explanation.textContent = research.explanation;
    details.append(summary, explanation);
    if (research.lastOutput) {
      const output = document.createElement('p'); output.textContent = research.lastOutput.label;
      const qualifier = document.createElement('p'); qualifier.textContent = research.outputExplanation;
      details.append(output, qualifier);
    }
    researchSection.append(details);
  }
  if (snapshot && actual) renderStrategicInspection(panel, observedStrategicResources(snapshot.state, actual.id));
  const settlement = panel.querySelector<HTMLElement>('.city-details');
  if (settlement) renderSettlementInspection(settlement, cities, preferences.selectedCity, selectCity, residentSupport, selectedWork);
  const overview = settlement?.querySelector<HTMLElement>('.town-overview');
  if (overview) panel.insertBefore(overview, panel.querySelector('.research-detail'));
  const aim = panel.querySelector('.ambition'); if (aim) panel.append(aim);
  for (const disclosure of panel.querySelectorAll<HTMLDetailsElement>('[data-town-disclosure]')) {
    disclosure.open = expandedTown.has(disclosure.dataset['townDisclosure']);
    if (disclosure.dataset['townDisclosure'] === focusedTown) disclosure.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
  }
  for (const card of panel.querySelectorAll<HTMLElement>('.building-card')) {
    const receipt = card.querySelector<HTMLDetailsElement>('details');
    if (receipt && expandedBuildings.has(card.dataset['building'])) receipt.open = true;
    if (card.dataset['building'] === focusedReceipt) receipt?.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true });
  }
  const routes = document.createElement('section'); routes.dataset['inspectionSection'] = 'routes';
  renderRouteList(routes, displayed.routes.filter(candidate => candidate.from === preferences.selectedCity || candidate.to === preferences.selectedCity), selectedRoute, routeListPage, selectRoute, selectRoutePage);
  if (!routes.childElementCount) routes.textContent = 'No recorded routes for this town.';
  panel.append(routes); chooseSection(selectedSection);
  if (focusedInspection) [...panel.querySelectorAll<HTMLElement>('[data-inspection-focus]')].find(node => node.dataset['inspectionFocus'] === focusedInspection)?.focus({ preventScroll: true });
  if (focusedRoute) [...panel.querySelectorAll<HTMLElement>('[data-route-focus]')].find((node) => node.dataset['routeFocus'] === focusedRoute)?.focus({ preventScroll: true });
  panel.scrollTop = previousScroll;
  if (focusedCity) [...panel.querySelectorAll<HTMLButtonElement>('[data-city-select]')].find((button) => button.dataset['citySelect'] === focusedCity)?.focus({ preventScroll: true });
  if (closeFocused) panel.querySelector<HTMLButtonElement>('.sheet-close')?.focus();
  if (treeFocused) panel.querySelector<HTMLButtonElement>('[data-open-capabilities]')?.focus({ preventScroll: true });
  if (RESOURCE_IDS.some((resource) => resource === focusedResource)) panel.querySelector<HTMLButtonElement>(`[data-resource="${focusedResource}"]`)?.focus({ preventScroll: true });
}

function frameInspection(): void {
  if (!atlas || !narrowLayout.matches || !inspectionCamera.active()) return;
  const route = displayed.routes.find((entry) => entry.id === selectedRoute);
  if (route && routeInspectionCity(route) === null) return;
  const map = element('#map').getBoundingClientRect();
  const sheet = element('.inspection').getBoundingClientRect();
  if (!sheet.height || !map.height) return;
  const heading = element('.world-heading').getBoundingClientRect();
  const tools = element('.map-tools').getBoundingClientRect();
  atlas.frameCity(preferences.selectedCity ?? '', inspectionAnchor(map, heading.bottom, sheet.top, tools.left));
}

function setInspectionOpen(open: boolean): void {
  const closedRoute = !open ? selectedRoute : null;
  if (closedRoute) { selectedRoute = null; atlas?.selectRoute(null); renderInspection(); }
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
  if (closedRoute && !narrowLayout.matches) {
    const row = [...document.querySelectorAll<HTMLElement>('[data-route-focus]')].find((node) => node.dataset['routeFocus'] === `route:${closedRoute}`);
    (row ?? document.querySelector<HTMLButtonElement>(`[data-civ="${preferences.selected}"]`))?.focus({ preventScroll: true });
  }
  savePreferences();
}

function selectRoutePage(page: number): void {
  routeListPage = page;
  renderInspection();
  element('.inspection').querySelector<HTMLButtonElement>('.route-list > button')?.focus({ preventScroll: true });
}

function selectRoute(id: string): void {
  const route = displayed.routes.find((entry) => entry.id === id);
  if (!route) return;
  const city = displayed.cities.find((entry) => cityKey(entry) === routeInspectionCity(route));
  if (city) {
    preferences = { ...preferences, selected: city.id, selectedCity: cityKey(city) };
    atlas?.select(cityKey(city));
    for (const row of document.querySelectorAll<HTMLElement>('[data-civ]')) row.setAttribute('aria-pressed', String(Number(row.dataset['civ']) === city.id));
  }
  selectedRoute = id;
  atlas?.selectRoute(id);
  renderInspection();
  setInspectionOpen(true);
  element('.inspection').querySelector<HTMLButtonElement>('.route-close')?.focus({ preventScroll: true });
}

function selectCity(id: string): void {
  const fromRoute = selectedRoute !== null;
  const city = displayed.cities.find((entry) => cityKey(entry) === id);
  if (!city) return;
  selectedRoute = null;
  atlas?.selectRoute(null);
  preferences = { ...preferences, selected: city.id, selectedCity: id };
  for (const row of document.querySelectorAll<HTMLElement>('[data-civ]')) row.setAttribute('aria-pressed', String(Number(row.dataset['civ']) === city.id));
  atlas?.select(id);
  renderInspection();
  setInspectionOpen(true);
  if (fromRoute) {
    const heading = element('.inspection').querySelector<HTMLElement>('.city-details h3, h2');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }
  savePreferences();
}

function selectCivilization(id: number): void {
  const city = displayed.cities.find((entry) => entry.id === id && cityKey(entry) === preferences.selectedCity)
    ?? displayed.cities.find((entry) => entry.id === id);
  if (city) selectCity(cityKey(city));
}

function renderWorld(world: AtlasWorld): void {
  displayed = world;
  if (!world.routes.some((route) => route.id === selectedRoute)) selectedRoute = null;
  preferences = { ...preferences, ...resolveCitySelection(world, preferences) };
  const civs = uniqueCivilizations(world);
  element('.civilization-panel').hidden = civs.length === 0;
  const listFingerprint = JSON.stringify(civs.map(({ id, name, character, color, symbol }) => ({ id, name, character, color, symbol })));
  if (listFingerprint !== civilizationFingerprint) {
  element('.civilization-list').innerHTML = civs.map((civ) => `<button class="civilization-row" data-civ="${civ.id}" type="button" style="--civ-color:${escapeText(civ.color)}" aria-pressed="${civ.id === preferences.selected}"><span class="civ-emblem" aria-hidden="true">${escapeText(civ.symbol)}</span><span><strong>${escapeText(civ.name)}</strong><small>${escapeText(civ.character)}</small></span></button>`).join('');
  for (const row of document.querySelectorAll<HTMLElement>('[data-civ]')) row.addEventListener('click', () => selectCivilization(Number(row.dataset['civ'])));
  civilizationFingerprint = listFingerprint;
  }
  for (const row of document.querySelectorAll<HTMLElement>('[data-civ]')) row.setAttribute('aria-pressed', String(Number(row.dataset['civ']) === preferences.selected));
  const fingerprint = JSON.stringify(world);
  if (fingerprint !== mapFingerprint) {
    savePreferences();
    atlas?.dispose();
    atlas = null;
    element('#city-labels').replaceChildren();
    try {
      if (!webgl) throw new Error('Use the supported 2D map');
      atlas = createAtlasRenderer(element('#map'), element('#city-labels'), world, preferences, selectCity, selectRoute);
    } catch {
      webgl = false;
      element('#map').querySelector('canvas')?.remove();
      element('#city-labels').replaceChildren();
      atlas = createFlatAtlasRenderer(element('#map'), world, preferences, selectCity, selectRoute);
    }
    mapFingerprint = fingerprint;
    viewerSettings.refresh();
  }
  atlas?.selectRoute(selectedRoute);
  element('#render-mode').textContent = webgl ? '3D map' : '2D map';
  element('#render-mode').title = 'The same committed geography in a supported map renderer';
  renderInspection();
  if (capabilityDialog?.open) {
    const input = currentCapabilityInput();
    if (input) capabilityTree.observe(input);
  }
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
  const event = state ? latestStoryEvent(state.events) : undefined;
  const story = event && state ? eventLogEntries([event], { civilizations: state.civilizations, receipts: observedRouteResults })[0] : undefined;
  const receipt = observedRouteResults.find((cue) => cue.eventId === event?.id);
  const routeResult = receipt ? routeResultPresentation(receipt) : null;
  const visual = event ? eventVisual(event) : null;
  element('#chronicle-label').textContent = story ? `${story.category} · ${story.deltas.some(delta => delta.kind === 'production') ? 'Before costs' : `Round ${story.round}`}` : mode === 'sample' ? 'SAMPLE VIEW' : 'WORLD CONNECTION';
  element('#event-title').textContent = story?.title ?? (mode === 'sample' ? 'A sample, not a simulation.' : 'The story will appear here.');
  element('#event-detail').textContent = story?.summary ?? (mode === 'sample' ? 'These cities and routes illustrate the atlas. Return to live world to watch committed changes.' : 'This page only reads. Agent actions, discoveries and world events will be shown after they are committed.');
  const icon = story?.icon ?? routeResult?.icon ?? visual?.icon;
  if (icon) element('#event-title').prepend(visualIcon(icon));
  renderDeltas(element('#event-deltas'), story?.deltas ?? routeResult?.deltas ?? visual?.deltas ?? []);
  element('#event-detail').hidden = !story?.summary || !!story.deltas.length;
  element('#events-open').hidden = !state?.events.length;
  element('#sample-open').hidden = snapshot !== null || mode === 'sample' || mode === 'loading';
  element('#live-open').hidden = mode !== 'sample';
  for (const button of document.querySelectorAll<HTMLButtonElement>('.map-tools button, .layer-controls button')) button.disabled = atlas === null;
  renderInspection();
  if (dialogs.get('events')?.open && !eventHistoryCaptured) renderEventHistory();
  if (dialogs.get('events')?.open && snapshot) element('#events-refresh').hidden = snapshot.state.revision <= eventHistoryRevision;
}

function quietCues(): void {
  atlas?.clearEvents();
  if (snapshot) eventCues.observe({ identity: snapshot.identity, revision: snapshot.state.revision, mode: 'history', events: snapshot.state.events, routes: displayed.routes }, 0);
}

function showSample(): void {
  capabilityTree.close();
  quietCues();
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
      if (snapshot?.identity !== read.snapshot.identity) { selectedRoute = null; routeListPage = 0; observedRouteResults = []; }
      snapshot = read.snapshot;
      mode = 'live';
      observedAt = new Date().toISOString();
      lastRead = new Date(observedAt).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC';
      const world = projectWorld(snapshot.state);
      const quiet = document.hidden || dialogs.get('events')?.open || capabilityDialog?.open;
      const cues = eventCues.observe({ identity: snapshot.identity, revision: snapshot.state.revision, mode: quiet ? 'history' : 'live', events: snapshot.state.events, routes: world.routes }, element('#map').clientWidth < 700 ? 1 : 3);
      if (cues.routeResults.length) observedRouteResults = [...cues.routeResults, ...observedRouteResults].slice(0, 3);
      renderWorld(world);
      if (!quiet) atlas?.showEvents(cues.events);
    } else { mode = read.kind === 'uninitialized' ? 'uninitialized' : 'offline'; }
  } catch { if (!sampleActive()) mode = 'offline'; }
  finally { reading = false; renderConnection(); }
}

for (const [id, factor] of [['#zoom-in', 1.2], ['#zoom-out', 1 / 1.2]] as const) element(id).addEventListener('click', () => { atlas?.zoom(factor); frameInspection(); savePreferences(); });
element('#reset-camera').addEventListener('click', () => { inspectionCamera.release(); atlas?.reset(); savePreferences(); });
let mapPointer: { id: number; x: number; y: number } | null = null;
element('#map').addEventListener('pointerdown', (event) => {
  if (event.target instanceof Element && event.target.closest('.flat-city, .city-label, .flat-route, .route-map-label')) return;
  mapPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
}, { capture: true });
element('#map').addEventListener('pointermove', (event) => {
  if (mapPointer?.id === event.pointerId && Math.hypot(event.clientX - mapPointer.x, event.clientY - mapPointer.y) > 5) inspectionCamera.release();
}, { capture: true });
for (const type of ['pointerup', 'pointercancel']) element('#map').addEventListener(type, () => { mapPointer = null; }, { capture: true });
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
  for (const control of document.querySelectorAll<HTMLButtonElement>(`[data-layer="${layer}"]`)) control.setAttribute('aria-pressed', String(visible));
  atlas?.setLayer(layer, visible);
  preferences = { ...preferences, [layer]: visible };
  savePreferences();
});
element('#sample-open').addEventListener('click', showSample);
element('#live-open').addEventListener('click', () => {
  atlas?.dispose(); atlas = null; mapFingerprint = ''; displayed = { tiles: [], cities: [], routes: [] };
  element('.civilization-panel').hidden = true;
  mode = 'loading'; renderConnection(); void readWorld();
});

const dialogs = new Map<string, HTMLDialogElement>();
for (const [name, selector] of [['changelog', '#history-dialog'], ['about', '#about-dialog'], ['events', '#events-dialog'], ['settings', '#settings-dialog'], ['resource', '#resource-dialog']]) {
  if (!name || !selector) continue;
  const dialog = document.querySelector<HTMLDialogElement>(selector);
  if (!dialog) throw new Error('A spectator dialog is missing');
  dialogs.set(name, dialog);
}
function renderEventHistory(): void {
  const events = snapshot?.state.events;
  eventHistoryCaptured = events !== undefined;
  eventHistoryRevision = snapshot?.state.revision ?? -1;
  element('#events-refresh').hidden = true;
  element('#events-dialog .dialog-intro').textContent = snapshot
    ? `Revision ${snapshot.state.revision} · Captured view. New records appear after Refresh.`
    : 'Waiting for committed world history.';
  if (events && snapshot) renderEventLog(element('#event-list'), events, {
    civilizations: snapshot.state.civilizations, receipts: observedRouteResults,
  });
  else element('#event-list').textContent = 'Waiting for committed world history.';
}
function syncDialog(): void {
  const active = window.location.hash.slice(1);
  for (const [name, dialog] of dialogs) {
    if (name === active && !dialog.open) {
      if (name === 'events') { quietCues(); renderEventHistory(); }
      dialog.showModal();
    }
    if (name !== active && dialog.open) {
      dialog.close();
      if (name === 'events') eventHistoryCaptured = false;
    }
  }
}
let helpResource: Resource | null = null;
let eventHistoryOpener: HTMLButtonElement | null = null;
function closeDialog(): void {
  const name = window.location.hash.slice(1);
  const dialog = dialogs.get(name);
  dialog?.close();
  if (name === 'events') { eventHistoryCaptured = false; eventHistoryOpener?.focus({ preventScroll: true }); }
  history.replaceState(history.state as unknown, '', `${location.pathname}${location.search}`);
  if (helpResource) document.querySelector<HTMLButtonElement>(`[data-resource="${helpResource}"]`)?.focus({ preventScroll: true });
  helpResource = null;
}
element('.inspection').addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest('.sheet-close')) setInspectionOpen(false);
  const treeOpener = event.target.closest<HTMLButtonElement>('[data-open-capabilities]');
  if (treeOpener) {
    const input = currentCapabilityInput();
    if (input) { quietCues(); capabilityTree.open(input, treeOpener); }
    return;
  }
  const resource = event.target.closest<HTMLElement>('[data-resource]')?.dataset['resource'];
  const known = RESOURCE_IDS.find((id) => id === resource);
  if (!known) return;
  helpResource = known;
  const guide = resourceGuide(known);
  element('#resource-title').replaceChildren(visualIcon(known), document.createTextNode(guide.label));
  const value = snapshot?.state.civilizations.find(civ => civ.id === preferences.selected)?.resources[known];
  element('#resource-explanation').textContent = `${value === undefined ? '' : `${exactNumber(value)} ${guide.label} stored. `}${guide.explanation}`;
  window.location.hash = 'resource';
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !document.querySelector('dialog[open]')) setInspectionOpen(false);
});
element('#world-info-open').addEventListener('click', () => { window.location.hash = 'about'; });
element('#changelog-open').addEventListener('click', () => { window.location.hash = 'changelog'; });
for (const button of document.querySelectorAll<HTMLButtonElement>('.about-button')) button.addEventListener('click', () => { window.location.hash = 'about'; });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open-events]')) button.addEventListener('click', () => { eventHistoryOpener = button; window.location.hash = 'events'; });
element('#events-refresh').addEventListener('click', () => { renderEventHistory(); const heading = element('#events-dialog h2'); heading.tabIndex = -1; heading.focus({ preventScroll: true }); });
element('#settings-open').addEventListener('click', () => { window.location.hash = 'settings'; });
for (const dialog of dialogs.values()) {
  dialog.querySelector('button')?.addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(); });
}
window.addEventListener('hashchange', syncDialog);
syncDialog();
window.addEventListener('pagehide', () => { quietCues(); savePreferences(); });
window.setInterval(savePreferences, 2000);

function mountDeploymentUpdates(): ReturnType<typeof createViewerUpdates> {
  return createViewerUpdates({
    current: currentRelease,
    fetchRelease: async () => {
      const response = await fetch(new URL('version.json', document.baseURI), { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error('Viewer manifest is unavailable');
      return await response.json() as unknown;
    },
    now: () => Date.now(), href: () => window.location.href,
    preferences: () => ({ ...preferences, ...inspectionCamera.savedCamera(atlas?.snapshot() ?? preferences) }),
    attempts: { read: () => sessionStorage.getItem(RELOAD_KEY), write: (value) => sessionStorage.setItem(RELOAD_KEY, value) },
    readHistory: () => history.state as unknown,
    replaceHistory: (state, href) => history.replaceState(state, '', href),
    savePreferences: (value) => { preferences = value; localStorage.setItem(PREFERENCES_KEY, JSON.stringify(value)); },
    navigate: (href, reload) => { if (reload) window.location.reload(); else window.location.replace(href); },
    notice: (notice) => {
      element('#update-notice').hidden = notice === null;
      element('#update-status').textContent = notice?.message ?? '';
      const action = element('#update-action');
      action.hidden = !notice?.action;
      action.textContent = notice?.action === 'check' ? 'Try again' : 'Update view';
    },
  });
}
let deploymentUpdates = mountDeploymentUpdates();
element('#update-action').addEventListener('click', () => deploymentUpdates.act());
window.addEventListener('pagehide', () => deploymentUpdates.dispose());
window.addEventListener('pageshow', (event) => {
  if (event.persisted) { deploymentUpdates = mountDeploymentUpdates(); void deploymentUpdates.check(); }
});
window.setInterval(() => { void readWorld(); }, 5000);
window.setInterval(() => { void deploymentUpdates.check(); }, 30000);
window.addEventListener('visibilitychange', () => { if (document.hidden) quietCues(); else { void readWorld(); void deploymentUpdates.check(); } });
renderConnection();
if (new URL(window.location.href).searchParams.get('sample') === '1') showSample();
else void readWorld();
void deploymentUpdates.check();
