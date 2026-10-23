import { advanceLocalSimulationAsync, disposeLocalSimulationWorker } from './local-simulation-client.ts';
import { localSimulationSnapshot } from './local-simulation.ts';
import { createLocalWorldStorage, type LocalCheckpointResult } from './local-world-storage.ts';
import { createWorldViewSession, parseWorldBody, parseWorldSource, worldSourceHref, worldViewKey, type WorldBody, type WorldSource } from './world-view.ts';
import { bodySelection, bodyViewContext, bodyViewDescription, worldBodyHref } from './body-view.ts';
import { projectMarsBody, marsSelectionId } from '../visuals/mars-body.ts';
import { createMarsBodyRenderer } from './mars-body-renderer.ts';
import { renderMarsBodyInspection } from './mars-body-inspection.ts';
import './spectator-hud.css';
import './mars-observation.css';
import { renderMarsObservation, worldJourney } from './mars-observation.ts';
import { civilizationSummary, developingTowns, renderDevelopingTowns, ongoingCommitments, renderOngoingCommitments, installedTownEvidence, spectatorChronicle, renderSpectatorChronicle, renderRecordedPolicyChoice, type SpectatorDestination } from './spectator-hud.ts';
import { projectTownTerritory } from '../visuals/territory-visuals.ts';
import { observedPastoralSites } from '../core/simulation/pastoral.ts';
import { townDevelopmentFacts } from '../visuals/wonder-visuals.ts';
import { exactNumber, numberPresentation } from './number-format.ts';
import { observedStrategicResources } from '../core/simulation/metals.ts';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import { createCapabilityTreeSheet, restoreCapabilityOpener, type CapabilityTreeInput } from './capability-tree.ts';
import { createCivicProgress } from './civic-progress.ts';
import { eventLogEntries, latestStoryEvent, renderEventLog } from './event-log.ts';
import { routeInspectionCity } from '../visuals/route-visuals.ts';
import { renderRouteCard, renderRouteList, retainedRoutePathInspection, routeInspectionIdentity } from './route-inspection.ts';
import { cityKey, retainedReceiptBuilding } from './city-selection.ts';
import { renderPastoralInspection, renderSettlementInspection, residentSupportForWorld, renderStrategicInspection } from './settlement-inspection.ts';
import { researchProgressPresentation } from './research-progress.ts';
import releaseData from '../public/version.json';
import changelog from '../public/changelog.json';
import { RESOURCE_IDS, TECHNOLOGIES } from '../core/content.ts';
import { createPreviewWorld, atlasCoordinateShift } from './atlas.ts';
import { mapContentWindow } from '../visuals/map-hierarchy.ts';
import { mapHierarchyObstacles } from './map-labels.ts';
import type { AtlasWorld } from './atlas.ts';
import { createAtlasRenderer } from './renderer.ts';
import type { AtlasRenderer } from './renderer.ts';
import { createFlatAtlasRenderer } from './flat-renderer.ts';
import { acceptsSnapshot, activityLabel, formatYear, parseWorldRead, projectWorld, uniqueCivilizations } from './live-world.ts';
import type { LiveSnapshot } from './live-world.ts';
import { parseRelease, releaseHistoryPage } from './viewer-state.ts';
import { createViewerUpdates, preferencesAfterUpdate } from './viewer-updates.ts';
import { createInspectionSession, inspectionAnchor } from './inspection-camera.ts';
import { eventVisual } from '../visuals/world-visuals.ts';
import type { RouteResultCue } from '../visuals/route-cues.ts';
import { createCueStream, renderDeltas, routeResultPresentation, visualIcon } from './world-cues.ts';
import { resourceGuide } from './viewer-appearance.ts';
import { mountViewerSettings } from './viewer-settings.ts';
import { civilizationIdentity } from '../visuals/visual-language.ts';
import type { Resource, WorldState } from '../core/types.ts';

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

function factionCrest(id: number): string {
  const identity = civilizationIdentity(id);
  return `<svg class="faction-crest" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${identity.path}"/></svg>`;
}

function readHistory(): unknown {
  try { return history.state as unknown; } catch { return null; }
}
let preferences = preferencesAfterUpdate(currentRelease.buildId, readStored(PREFERENCES_KEY), readHistory());
const worldView = createWorldViewSession();
let worldSource: WorldSource = preferences.worldSource ?? 'local';
let worldBody: WorldBody = parseWorldBody(new URL(window.location.href).searchParams.get('body')) ?? preferences.worldBody ?? 'earth';
preferences = { ...preferences, worldBody };
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('The spectator application mount is missing.');

app.innerHTML = `
  <header class="masthead">
    <a class="brand" href="#" aria-label="Civitas home"><span class="brand-mark" aria-hidden="true">C</span><span>CIVITAS</span></a>
    <nav class="top-nav" aria-label="World information"><span class="nav-active">Observer</span><button id="events-nav" class="events-nav" data-open-events type="button">Events</button><button id="journey-nav" class="text-button journey-nav" data-open-journey type="button" aria-haspopup="dialog" aria-controls="journey-dialog" disabled>Journey</button><button class="text-button about-button" type="button">About</button><button id="settings-open" class="text-button" type="button" aria-label="Viewer settings">Settings</button></nav>
    <div class="mode"><span class="status-dot"></span><span id="connection-label">CONNECTING</span><span class="mode-detail">View only</span></div>
  </header>
  <main class="observatory live-observatory">
    <div id="map" class="map"><div id="city-labels" class="city-labels"></div></div>
    <section class="world-heading" aria-label="Current world status"><div class="world-calendar"><span id="world-id" class="eyebrow">SHARED WORLD</span><h1 id="world-title">Connecting to the world</h1><p id="world-detail">Looking for the latest committed state.</p><span class="world-mode" hidden></span></div><div class="body-switch" role="group" aria-label="World body to observe" aria-describedby="body-context-description"><button type="button" data-body="earth" aria-pressed="true" disabled>Earth</button><button type="button" data-body="mars" aria-pressed="false" disabled>Mars</button></div><p id="body-context" class="body-context" hidden></p><span id="body-context-description" class="sr-only"></span></section>
    <button class="era-pill" id="journey-open" data-open-journey type="button" aria-haspopup="dialog" aria-controls="journey-dialog" aria-label="Inspect world history and Earth to Mars journey" disabled><span><strong id="era-name">Early settlements</strong><small id="era-detail">A GROWING WORLD</small></span></button>
    <aside class="civilization-panel panel" aria-label="Civilizations" hidden><h2 class="sr-only">Civilizations · Select to inspect</h2><div class="civilization-list"></div></aside>
    <aside class="inspection panel" aria-label="Civilization inspection" hidden></aside>
    <div class="map-tools" role="group" aria-label="Map camera"><button id="zoom-in" type="button" aria-label="Zoom in">+</button><button id="zoom-out" type="button" aria-label="Zoom out">−</button><button id="reset-camera" type="button" aria-label="Reset camera">Home</button></div>
    <div class="layer-controls" role="group" aria-label="Map layers"><button data-layer="borders" type="button" aria-pressed="${preferences.borders}">Borders</button><button data-layer="routes" type="button" aria-pressed="${preferences.routes}">Routes</button></div>
    <section class="chronicle panel" aria-label="World chronicle"><div class="chronicle-heading"><span class="eyebrow">WORLD CHRONICLE</span><button id="events-open" class="text-button" data-open-events type="button" hidden>All events</button></div><ol id="major-event-list" aria-label="Latest major events, newest first"></ol><div id="connection-story"><span id="chronicle-label" class="eyebrow">WORLD CONNECTION</span><strong id="event-title">Connecting to the world</strong><p id="event-detail">Waiting for the first recorded changes.</p><div id="event-deltas" class="story-deltas" tabindex="0" aria-label="Latest event amounts; scroll for all recorded amounts"></div></div></section>
    <div class="map-hint" id="map-hint">Drag to explore · Select a civilization or town</div>
    <div id="connection-actions" class="connection-actions"><button id="sample-open" type="button" hidden>View sample atlas</button><button id="live-open" type="button" hidden>Return to observatory</button><span id="render-mode"></span></div>
  </main>
  <footer class="footer"><span class="footer-status">Observe the world. No player orders.</span><div class="release-links"><button id="world-info-open" data-open-changelog type="button" aria-haspopup="dialog" aria-controls="history-dialog" aria-label="View changelog for version ${currentRelease.version}">v${currentRelease.version} · Changelog</button><a href="https://github.com/Kiborgik/blabla" target="_blank" rel="noopener noreferrer">Built with <strong>BlaBla</strong></a></div></footer>
  <dialog id="history-dialog" aria-labelledby="history-title"><div class="dialog-top"><span class="eyebrow">VIEWER UPDATES</span><button class="dialog-close" type="button" aria-label="Close update history">×</button></div><h2 id="history-title">Changelog</h2><p class="history-current">Current viewer <strong>v${currentRelease.version}</strong> · Newest first</p><nav class="history-pages" aria-label="Update history pages"><button id="history-newer" type="button">Newer</button><span id="history-range" role="status"></span><button id="history-older" type="button">Older</button></nav><div class="release-history"></div></dialog>
  <dialog id="about-dialog" aria-labelledby="about-title"><div class="dialog-top"><span class="eyebrow">A WORLD THAT KEEPS GROWING</span><button class="dialog-close" type="button" aria-label="Close world information">×</button></div><h2 id="about-title">The world, without us.</h2><p id="about-source" class="dialog-intro">Five civilizations. An observer-only world.</p><p id="about-world-record" class="history-current"></p><div class="about-body"><p>Settlements grow through research, construction, production and consenting trade. The applied world release determines which branches are available; inspect the tree for current requirements.</p><h3>Many ways forward</h3><p>The horizon includes scientific, cultural, economic, political and military success. Their systems arrive through future expansions; they are not all available today.</p><p>Fast choices shape slower projects and lasting commitments. The calendar has its own regular rhythm, with deliberate turning points as the world grows.</p><p>Viewer version ${currentRelease.version}. A connected view shows committed server state. It does not claim the agents are acting continuously. Sample mode is clearly labeled and never changes the shared world.</p><p>Development is organized with <a href="https://github.com/Kiborgik/blabla" target="_blank" rel="noopener noreferrer">BlaBla</a>.</p></div></dialog>
  <dialog id="events-dialog" aria-labelledby="events-title"><div class="dialog-top"><span class="eyebrow">THE WORLD STORY</span><button class="dialog-close" type="button" aria-label="Close recent events">×</button></div><h2 id="events-title">What changed</h2><p class="dialog-intro">Key events first. Filter by civilization or kind, then open a record for details.</p><button id="events-refresh" type="button" hidden>New events available · Refresh</button><ol id="event-list"></ol></dialog>
  <dialog id="capability-dialog"></dialog>
  <dialog id="settings-dialog" aria-labelledby="settings-title"><div class="dialog-top"><span class="eyebrow">YOUR VIEW</span><button class="dialog-close" type="button" aria-label="Close viewer settings">×</button></div><h2 id="settings-title">Viewer settings</h2><p class="dialog-intro">Changes only how you see the world.</p><div class="viewer-options"><label for="world-source">World to observe</label><select id="world-source"><option value="local">Food-budget world</option><option value="living">Previous living world · Read-only</option><option value="partnerships">Living partnerships · Read-only</option><option value="prior">Previous generated world · Read-only</option><option value="previous">First local world · Read-only</option><option value="shared">Native world archive</option></select><p>Choose which world to observe. The generated world runs with built-in rules and accelerated time, not live AI models. Previous local and native archive records are separate and are never overwritten by this world.</p><p id="local-save-status" role="status"></p><label for="viewer-theme">Theme</label><select id="viewer-theme"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select><p>System follows your device theme.</p><label for="viewer-effects">Effects</label><select id="viewer-effects" aria-describedby="effects-explanation system-motion-note"><option value="calm">Calm</option><option value="rich">Rich</option><option value="cinematic">Cinematic</option></select><p id="effects-explanation"></p><p id="system-motion-note" role="status" hidden>Your device requests reduced motion. Calm is active.</p></div><fieldset class="settings-layers"><legend>Map layers</legend><button data-layer="borders" type="button" aria-pressed="${preferences.borders}">Borders</button><button data-layer="routes" type="button" aria-pressed="${preferences.routes}">Routes</button></fieldset><p class="settings-note">Preferences are kept on this browser when storage is available. No change to agent choices or world speed.</p></dialog>
  <dialog id="resource-dialog" aria-labelledby="resource-title"><div class="dialog-top"><span class="eyebrow">RESOURCE GUIDE</span><button class="dialog-close" type="button" aria-label="Close resource guide">×</button></div><h2 id="resource-title">Resources</h2><p id="resource-explanation" class="dialog-intro">Select a resource in city details to learn more.</p><p class="resource-reading">The city panel shows the amount stored by the civilization. <strong>Made</strong> is production before food use and other costs. <strong>+</strong> and <strong>−</strong> show recorded gains and losses. <strong>Base / season</strong> is production capacity, not goods already made.</p></dialog>
  <dialog id="journey-dialog" aria-labelledby="journey-title"><div class="dialog-top"><span class="eyebrow">THE LONG JOURNEY</span><button class="dialog-close" type="button" aria-label="Close Earth and Mars journey">×</button></div><h2 id="journey-title">From hearths to another world</h2><p id="journey-caption" class="dialog-intro"></p><button id="journey-refresh" type="button" hidden>New records · Refresh</button><div id="journey-content"></div></dialog>
  <div id="update-notice" class="update-notice panel" hidden><p id="update-status" role="status"></p><button id="update-action" type="button" hidden>Update view</button></div>
`;

function element(selector: string): HTMLElement {
  const result = document.querySelector<HTMLElement>(selector);
  if (!result) throw new Error(`Missing spectator element: ${selector}`);
  return result;
}

element('#events-open').append(visualIcon('inspect'));
element('#journey-open').append(visualIcon('inspect'));

let atlas: AtlasRenderer | null = null;
let initialOverview = preferences.selectedCity === null && preferences.zoom === 1 && preferences.x === 0 && preferences.z === 0;
let selectedRoute: string | null = null;
let routeListPage = 0;
let mapFingerprint = '';
let civilizationFingerprint = '';
let chronicleFingerprint = '';
let chronicleIdentity = '';
let eventHistoryCaptured = false;
let eventHistoryRevision = -1;
let journeyRevision = -1;
let journeyIdentity = '';
let webgl = true;
let snapshot: LiveSnapshot | null = null;
let displayed: AtlasWorld = { tiles: [], cities: [], routes: [] };
let mode: 'loading' | 'local' | 'living' | 'partnerships' | 'prior' | 'previous' | 'unavailable' | 'live' | 'offline' | 'uninitialized' | 'sample' = 'loading';
const localWorldStorage = createLocalWorldStorage({
  read: key => localStorage.getItem(key), write: (key, value) => localStorage.setItem(key, value),
  ...(navigator.locks ? { withLock: (key: string, operation: () => LocalCheckpointResult) => navigator.locks.request(key, operation) } : {}),
});
const restoredLocal = await localWorldStorage.restore();
let localSaveMessage = restoredLocal.message;
let localSaveBlocked = restoredLocal.blocked;
let localEphemeral = restoredLocal.ephemeral;
let localSimulation = restoredLocal.run;
let localWasObserved = false;
const livingLocal = localWorldStorage.living();
const livingSaveMessage = livingLocal.message;
const livingSimulation = livingLocal.run;
const partnershipsLocal = localWorldStorage.partnerships();
const partnershipsSaveMessage = partnershipsLocal.message;
const partnershipsSimulation = partnershipsLocal.run;
const priorGenerated = localWorldStorage.priorGenerated();
const priorSaveMessage = priorGenerated.message;
const priorSimulation = priorGenerated.run;
const previousLocal = localWorldStorage.previous();
const previousSaveMessage = previousLocal.message;
const previousSimulation = previousLocal.run;
let localFrames = 0;
let localAdvancing = false;
let localStopped = false;
let localFailure = '';
let lastRead = '';
let observedAt = '';
const catalogue = capabilityCatalogue();
let inspectionFingerprint = '';
let pendingInspectionWork: string | undefined;
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
  if (!snapshot || mode === 'sample' || worldBody !== 'earth' || !observedAt) return null;
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
  preferences = worldView.capture(preferences, { ...preferences, ...inspectionCamera.savedCamera(atlas?.snapshot() ?? preferences) });
  try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences)); } catch { return; }
}

function observedWorldKey(): string {
  return worldViewKey({ source: worldSource, identity: snapshot?.identity ?? '', body: worldBody });
}

function clearObservedHistory(): void {
  eventHistoryCaptured = false; eventHistoryRevision = -1; journeyRevision = -1; journeyIdentity = '';
  chronicleIdentity = ''; chronicleFingerprint = ''; observedRouteResults = []; selectedRoute = null; routeListPage = 0;
  element('#events-dialog .dialog-intro').textContent = 'Waiting for committed world history.';
  element('#event-list').textContent = 'Waiting for committed world history.';
  element('#events-refresh').hidden = true;
  element('#journey-caption').textContent = 'Waiting for a world record.';
  element('#journey-content').textContent = 'No world record loaded.';
  element('#journey-refresh').hidden = true;
}

function observeWorldIdentity(next: LiveSnapshot, source: WorldSource): void {
  const prior = worldView.identity();
  if (prior && (prior.identity !== next.identity || prior.source !== source || prior.body !== worldBody)) savePreferences();
  const view = worldView.observe(preferences, { source, identity: next.identity, body: worldBody });
  if (!view.changed) return;
  clearObservedHistory();
  atlas?.dispose(); atlas = null; mapFingerprint = ''; inspectionFingerprint = '';
  inspectionCamera.release(); preferences = view.preferences; initialOverview = !view.restored;
}

function renderInspection(): void {
  const civ = uniqueCivilizations(displayed).find((entry) => entry.id === preferences.selected);
  const panel = element('.inspection');
  if (worldBody === 'mars' && snapshot && mode !== 'sample') {
    const observation = projectMarsBody(snapshot.state);
    const selected = observation.civilizations.find(entry => entry.id === preferences.selected);
    panel.hidden = !selected;
    if (!selected) return;
    const fingerprint = JSON.stringify(['mars', snapshot.identity, observation, selected.id]);
    if (fingerprint === inspectionFingerprint) return;
    const scroll = panel.scrollTop;
    const closeFocused = document.activeElement === panel.querySelector('.sheet-close');
    inspectionFingerprint = fingerprint;
    panel.innerHTML = `<button class="sheet-close" type="button" aria-label="Close Mars details">Close ×</button><div class="inspection-top"><span class="eyebrow">MARS RECORDS</span><span class="preview-tag">VIEW ONLY</span></div><div class="inspection-title"><h2>${escapeText(selected.name)}</h2></div><section class="mars-body-facts" aria-label="Recorded Mars settlement and mission"></section>`;
    renderMarsBodyInspection(element('.mars-body-facts'), observation, selected.id);
    panel.scrollTop = scroll;
    if (closeFocused) panel.querySelector<HTMLButtonElement>('.sheet-close')?.focus({ preventScroll: true });
    return;
  }
  const route = displayed.routes.find((entry) => entry.id === selectedRoute);
  panel.hidden = !civ && !route;
  if (route) {
    const fingerprint = JSON.stringify(['route', route, routeListPage, displayed.routes, mode]);
    if (fingerprint === inspectionFingerprint) return;
    const sameRoute = panel.dataset['routeId'] === routeInspectionIdentity(route);
    const pathDetails = panel.querySelector<HTMLDetailsElement>('.route-path-tiles');
    const pathInspection = retainedRoutePathInspection(panel.dataset['routeId'], route, pathDetails?.open ?? false, Number(pathDetails?.dataset['page'] ?? 0), panel.querySelector<HTMLDetailsElement>('.route-steam-terms')?.open ?? false);
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
  const development = snapshot && preferences.selectedCity ? townDevelopmentFacts(snapshot.state, preferences.selectedCity) : undefined;
  const pastoral = snapshot && actual ? observedPastoralSites(snapshot.state, actual.id) : undefined;
  const capabilities = state && actual && observedAt ? projectCapabilities(state, actual.id, preferences.selectedCity, observedAt) : null;
  const territory = state && capabilities ? projectTownTerritory(state, capabilities) : undefined;
  const localChoice = mode === 'local' ? localSimulation?.decisions.find(decision => decision.seat === civ.id) : undefined;
  const fingerprint = JSON.stringify([civ, actual, localChoice, cities, residentSupport, research, development, pastoral, territory, capabilities?.governance, capabilities?.decisions?.civic, capabilities?.rail, capabilities?.strategic, capabilities?.industrialEvidence, capabilities?.localPower, preferences.selectedCity, displayed.routes, routeListPage, mode, pendingInspectionWork]);
  if (fingerprint === inspectionFingerprint) return;
  const sameCity = inspectedCivilization === civ.id && inspectedCity === preferences.selectedCity;
  const previousScroll = sameCity && !pendingInspectionWork ? panel.scrollTop : 0;
  const selectedSection = pendingInspectionWork ? 'work' : sameCity ? panel.dataset['inspectionView'] ?? 'overview' : 'overview';
  const selectedWork = pendingInspectionWork ?? (sameCity ? panel.querySelector<HTMLElement>('.city-details')?.dataset['selectedWork'] ?? '' : '');
  const landElement = sameCity ? panel.querySelector<HTMLElement>('.territory-detail') : null;
  const retainedTerritory = { view: landElement?.dataset['landView'] ?? 'purchases', page: Number(landElement?.dataset['landPage'] ?? 0) };
  pendingInspectionWork = undefined;
  const activeViewIdentity = observedWorldKey();
  const oldDevelopment = panel.querySelector<HTMLDetailsElement>('.developing-towns');
  const retainedDevelopment = oldDevelopment?.dataset['worldIdentity'] === activeViewIdentity ? oldDevelopment : null;
  const focusedDevelopment = document.activeElement instanceof HTMLElement && retainedDevelopment?.contains(document.activeElement) ? document.activeElement : null;
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
  panel.innerHTML = `<button class="sheet-close" type="button" aria-label="Close civilization details">Close ×</button><div class="inspection-top"><span class="eyebrow">CIVILIZATION</span><span class="preview-tag">${mode === 'sample' ? 'SAMPLE' : mode === 'local' ? 'LOCAL' : mode === 'live' ? 'CONNECTED' : 'LAST KNOWN'}</span></div><div class="inspection-title"><span class="focus-symbol" aria-hidden="true">${factionCrest(civ.id)}</span><div><h2>${escapeText(civ.name)}</h2><p>${escapeText(cities.find(city => city.id === preferences.selectedCity)?.name ?? civ.character)}</p></div></div><details class="ambition" data-inspection-section="overview"><summary>Civilization aim</summary><p>${escapeText(civ.ambition)}</p></details>${actual ? `<dl class="resources resource-rail" data-inspection-section="overview" aria-label="Civilization Earth stores">${RESOURCE_IDS.map((resource) => `<div><dt><button class="resource-help" type="button" data-resource="${resource}" aria-label="${resourceGuide(resource).label}: ${exactNumber(actual.resources[resource])} stored. Inspect exact value and meaning."><span class="resource-amount">${numberPresentation(actual.resources[resource]).short}</span><span class="resource-name">${resourceGuide(resource).label}</span></button></dt><dd class="sr-only">${exactNumber(actual.resources[resource])} stored</dd></div>`).join('')}</dl><section class="research-detail" data-inspection-section="overview" aria-label="Research progress"></section><button class="capability-open" data-inspection-section="overview" data-open-capabilities type="button" aria-haspopup="dialog">Technology tree <span>Research &amp; buildings</span></button><section class="city-details" aria-label="Selected settlement"></section>` : `<div class="capital-detail"><span>Sample capital</span><strong>${escapeText(civ.capital)}</strong></div><p class="inspection-note">Illustrative data. No live decisions or deliveries.</p>`}`;
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
  const resources = panel.querySelector('.resources');
  panel.insertBefore(navigation, resources ?? panel.querySelector('.ambition'));
  const selectedCity = cities.find(city => city.id === preferences.selectedCity);
  const commitments = capabilities ? renderOngoingCommitments(ongoingCommitments(capabilities, selectedCity)) : null;
  if (commitments) panel.insertBefore(commitments, resources);
  if (capabilityOpener) capabilityOpener.append(visualIcon('inspect'));
  for (const resource of RESOURCE_IDS) {
    const entry = panel.querySelector<HTMLButtonElement>(`[data-resource="${resource}"]`);
    entry?.prepend(visualIcon(resource));
  }
  const researchSection = panel.querySelector<HTMLElement>('.research-detail');
  if (research && researchSection) {
    const record = document.createElement('details'); record.className = 'town-receipt research-records'; record.dataset['townDisclosure'] = 'research-records'; record.dataset['inspectionSection'] = 'overview';
    const recordSummary = document.createElement('summary'); recordSummary.textContent = 'Research record'; record.append(recordSummary);
    researchSection.replaceWith(record); record.append(researchSection);
    const heading = document.createElement('strong');
    heading.textContent = research.heading;
    heading.prepend(visualIcon('science'));
    researchSection.append(heading);
    if (research.progress) {
      const progress = document.createElement('p');
      progress.textContent = research.progress;
      progress.className = 'research-amount';
      if (technology && actual) {
        const meter = document.createElement('progress'); meter.className = 'research-meter'; meter.max = technology.cost; meter.value = Math.max(0, actual.researchProgress); meter.setAttribute('aria-label', `${technology.name}: ${research.progress}`); researchSection.append(meter);
      }
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
  if (capabilities && state) {
    const city = cities.find(candidate => candidate.id === preferences.selectedCity);
    const civic = createCivicProgress({ catalogue, projection: capabilities, ...(city ? { city } : {}), events: state.events });
    if (civic) panel.insertBefore(civic, capabilityOpener);
  }
  if (selectedCity) {
    const installed = installedTownEvidence(selectedCity);
    const record = document.createElement('details'); record.className = 'town-receipt installed-records'; record.dataset['townDisclosure'] = 'installed'; record.dataset['inspectionSection'] = 'overview';
    const summary = document.createElement('summary'); summary.textContent = `Buildings & improvements · ${installed.length}`;
    const note = document.createElement('p'); note.textContent = 'Installed at this town, not proof that every building is operating. The world stage does not describe every town.';
    const list = document.createElement('ul');
    for (const site of installed) { const row = document.createElement('li'); row.textContent = `${site.name}${site.tileId === null ? '' : ` · Tile ${site.tileId}`}`; list.append(row); }
    record.append(summary, note, list); panel.insertBefore(record, panel.querySelector('.research-records') ?? capabilityOpener);
  }
  if (localChoice) panel.insertBefore(renderRecordedPolicyChoice(localChoice), panel.querySelector('.city-details'));
  if (pastoral) renderPastoralInspection(panel, pastoral);
  if (snapshot && actual) renderStrategicInspection(panel, observedStrategicResources(snapshot.state, actual.id));
  const settlement = panel.querySelector<HTMLElement>('.city-details');
  if (settlement) renderSettlementInspection(settlement, cities, preferences.selectedCity, selectCity, residentSupport, selectedWork, development, territory, retainedTerritory, () => {
    chooseSection('work');
    panel.scrollTop = 0;
  }, capabilities?.rail, capabilities?.localPower);
  const overview = settlement?.querySelector<HTMLElement>('.town-overview');
  if (overview) panel.insertBefore(overview, panel.querySelector('.city-details'));
  const aim = panel.querySelector('.ambition'); if (aim) panel.append(aim);
  if (state) {
    const towns = developingTowns(state, { archived: mode !== 'local' });
    const developmentList = retainedDevelopment ?? document.createElement('details');
    developmentList.className = 'developing-towns'; developmentList.dataset['inspectionSection'] = 'overview'; developmentList.dataset['worldIdentity'] = activeViewIdentity;
    let summary = developmentList.querySelector('summary');
    if (!summary) { summary = document.createElement('summary'); developmentList.append(summary); }
    summary.textContent = `${state.outcome || mode !== 'local' ? 'Recorded unfinished towns' : 'Developing towns'} · ${towns.length}`;
    let host = developmentList.querySelector<HTMLElement>('.developing-towns-list');
    if (!host) { host = document.createElement('div'); host.className = 'developing-towns-list'; developmentList.append(host); }
    panel.append(developmentList);
    focusedDevelopment?.focus({ preventScroll: true });
    renderDevelopingTowns(host, towns, id => selectCity(id), activeViewIdentity);
  }
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
  if (!atlas || !inspectionCamera.active()) return;
  const route = displayed.routes.find((entry) => entry.id === selectedRoute);
  if (route && routeInspectionCity(route) === null) return;
  const map = element('#map').getBoundingClientRect();
  const sheet = element('.inspection').getBoundingClientRect();
  if (!sheet.height || !map.height) return;
  const heading = element('.world-heading').getBoundingClientRect();
  const tools = element('.map-tools').getBoundingClientRect();
  const window = narrowLayout.matches ? null : mapContentWindow(map.width, map.height, mapHierarchyObstacles(element('#map')));
  atlas.frameCity(preferences.selectedCity ?? '', window ? { x: (window.left + window.width / 2) / map.width, y: (window.top + window.height / 2) / map.height } : inspectionAnchor(map, heading.bottom, sheet.top, tools.left));
}

function setInspectionOpen(open: boolean): void {
  const closedRoute = !open ? selectedRoute : null;
  if (closedRoute) { selectedRoute = null; atlas?.selectRoute(null); renderInspection(); }
  element('.observatory').dataset['inspection'] = String(open);
  if (open && atlas) {
    inspectionCamera.begin(atlas.snapshot());
    frameInspection();
  } else {
    const restore = inspectionCamera.end();
    if (restore) atlas?.restoreCamera(restore);
  }
  atlas?.select(preferences.selectedCity ?? '');
  if (!open) {
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
  if (worldBody !== 'earth') changeWorldBody('earth');
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

function selectCity(id: string, workId?: string): void {
  if (worldBody !== 'earth') changeWorldBody('earth');
  const fromRoute = selectedRoute !== null;
  const city = displayed.cities.find((entry) => cityKey(entry) === id);
  if (!city) return;
  selectedRoute = null;
  atlas?.selectRoute(null);
  preferences = { ...preferences, selected: city.id, selectedCity: id };
  for (const row of document.querySelectorAll<HTMLElement>('[data-civ]')) row.setAttribute('aria-pressed', String(Number(row.dataset['civ']) === city.id));
  atlas?.select(id);
  pendingInspectionWork = workId;
  renderInspection();
  setInspectionOpen(true);
  if (fromRoute) {
    const heading = element('.inspection').querySelector<HTMLElement>('.city-details h3, h2');
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }
  savePreferences();
}

function navigateStory(destination: SpectatorDestination): void {
  if (destination.kind === 'route') selectRoute(destination.id);
  else if (destination.kind === 'city') selectCity(destination.id);
  else selectCivilization(destination.id);
}

function selectCivilization(id: number): void {
  if (worldBody === 'mars') { selectMarsCivilization(marsSelectionId(id)); return; }
  const city = displayed.cities.find((entry) => entry.id === id && cityKey(entry) === preferences.selectedCity)
    ?? displayed.cities.find((entry) => entry.id === id);
  if (city) selectCity(cityKey(city));
}

function selectMarsCivilization(id: string): void {
  if (!snapshot || worldBody !== 'mars') return;
  const civilization = projectMarsBody(snapshot.state).civilizations.find(entry => marsSelectionId(entry.id) === id);
  if (!civilization) return;
  preferences = { ...preferences, selected: civilization.id, selectedCity: id };
  selectedRoute = null;
  for (const row of document.querySelectorAll<HTMLElement>('[data-civ]')) row.setAttribute('aria-pressed', String(Number(row.dataset['civ']) === civilization.id));
  atlas?.select(id); renderInspection(); setInspectionOpen(true); savePreferences();
}

function changeWorldBody(body: WorldBody): void {
  if (body === worldBody || !snapshot || mode === 'sample') return;
  savePreferences(); quietCues(); capabilityTree.close(); setInspectionOpen(false); inspectionCamera.release();
  worldBody = body; selectedRoute = null;
  observeWorldIdentity(snapshot, worldSource);
  renderWorld(projectWorld(snapshot.state)); renderConnection(); savePreferences();
  try { history.replaceState(history.state as unknown, '', worldBodyHref(window.location.href, body)); } catch {}
}

function renderBodyControls(state: WorldState | null): void {
  element('.observatory').dataset['body'] = worldBody;
  for (const button of document.querySelectorAll<HTMLButtonElement>('.body-switch [data-body]')) {
    button.disabled = !state;
    button.setAttribute('aria-pressed', String(button.dataset['body'] === worldBody));
  }
  element('#body-context').textContent = state ? bodyViewContext(worldBody, state) : '';
  element('#body-context').hidden = !state || worldBody === 'earth';
  element('#body-context-description').textContent = state ? bodyViewDescription(worldBody, state) : '';
}

function renderWorld(world: AtlasWorld, retainCoordinates = false): void {
  renderBodyControls(mode === 'sample' ? null : snapshot?.state ?? null);
  const shift = retainCoordinates && worldBody === 'earth' ? atlasCoordinateShift(displayed, world) : null;
  displayed = world;
  if (!world.routes.some((route) => route.id === selectedRoute)) selectedRoute = null;
  preferences = { ...preferences, ...bodySelection(worldBody, world, preferences) };
  const mars = worldBody === 'mars' && snapshot && mode !== 'sample' ? projectMarsBody(snapshot.state) : null;
  const civs = uniqueCivilizations(world);
  element('.civilization-panel').hidden = civs.length === 0;
  const summaries = new Map(civs.map(civ => {
    const colony = mars?.civilizations.find(entry => entry.id === civ.id);
    return [civ.id, colony ? `${colony.status.replaceAll('-', ' ')} · ${colony.population} on Mars` : snapshot && mode !== 'sample' ? civilizationSummary(snapshot.state, civ.id) : 'Sample civilization'];
  }));
  const focusedCiv = document.activeElement instanceof HTMLElement ? document.activeElement.dataset['civ'] : undefined;
  const listFingerprint = JSON.stringify(civs.map(({ id, name, character, color, symbol }) => ({ id, name, character, color, symbol, summary: summaries.get(id) })));
  if (listFingerprint !== civilizationFingerprint) {
  element('.civilization-list').innerHTML = civs.map((civ) => `<button class="civilization-row" data-civ="${civ.id}" type="button" style="--civ-color:${escapeText(civ.color)}" aria-pressed="${civ.id === preferences.selected}"><span class="civ-emblem" aria-hidden="true">${factionCrest(civ.id)}</span><span><strong>${escapeText(civ.name)}</strong><small>${escapeText(summaries.get(civ.id) ?? civ.character)}</small></span></button>`).join('');
  for (const row of document.querySelectorAll<HTMLElement>('[data-civ]')) row.addEventListener('click', () => selectCivilization(Number(row.dataset['civ'])));
  civilizationFingerprint = listFingerprint;
  if (focusedCiv) document.querySelector<HTMLButtonElement>(`[data-civ="${focusedCiv}"]`)?.focus({ preventScroll: true });
  }
  for (const row of document.querySelectorAll<HTMLElement>('[data-civ]')) row.setAttribute('aria-pressed', String(Number(row.dataset['civ']) === preferences.selected));
  const fingerprint = JSON.stringify([worldBody, mars ?? world]);
  if (fingerprint !== mapFingerprint) {
    savePreferences();
    if (shift && (shift.x || shift.z)) {
      preferences = { ...preferences, x: preferences.x + shift.x, z: preferences.z + shift.z };
      const framing = inspectionCamera.active(); inspectionCamera.release();
      if (framing) inspectionCamera.begin(preferences);
    }
    atlas?.dispose();
    atlas = null;
    element('#city-labels').replaceChildren();
    try {
      if (!webgl) throw new Error('Use the supported 2D map');
      atlas = mars ? createMarsBodyRenderer(element('#map'), element('#city-labels'), mars, preferences, selectMarsCivilization, 'webgl')
        : createAtlasRenderer(element('#map'), element('#city-labels'), world, preferences, selectCity, selectRoute);
    } catch {
      webgl = false;
      element('#map').querySelector('canvas')?.remove();
      element('#city-labels').replaceChildren();
      atlas = mars ? createMarsBodyRenderer(element('#map'), element('#city-labels'), mars, preferences, selectMarsCivilization, 'flat')
        : createFlatAtlasRenderer(element('#map'), world, preferences, selectCity, selectRoute);
    }
    if (initialOverview && (mars || world.tiles.length)) { atlas.reset(); initialOverview = false; savePreferences(); }
    mapFingerprint = fingerprint;
    viewerSettings.refresh();
  }
  atlas?.selectRoute(selectedRoute);
  element('#render-mode').textContent = `${webgl ? '3D' : '2D'} ${mars ? 'Mars view' : 'map'}`;
  element('#render-mode').title = mars ? 'Recorded missions and colonies; red terrain is visual context, not simulated geography' : 'The same committed geography in a supported map renderer';
  renderInspection();
  if (capabilityDialog?.open) {
    const input = currentCapabilityInput();
    if (input) capabilityTree.observe(input);
  }
  frameInspection();
}

function renderConnection(): void {
  const state = mode === 'sample' ? null : snapshot?.state;
  const journey = state ? worldJourney(state) : null;
  renderBodyControls(state ?? null);
  element('#map-hint').textContent = worldBody === 'mars' ? 'Drag to explore · Select a recorded colony or mission' : 'Drag to explore · Select a civilization or town';
  const labels = { loading: 'Connecting', local: localStopped ? 'Local simulation stopped' : state?.outcome ? 'World complete' : localEphemeral ? 'This-tab world' : 'Food-budget world', living: 'Previous living world', partnerships: 'Living partnerships', prior: 'Previous generated world', previous: 'First local world', unavailable: 'Saved world unavailable', live: 'Native world archive', offline: 'Connection lost', uninitialized: 'Waiting for world', sample: 'Sample atlas' };
  element('#connection-label').textContent = labels[mode];
  element('.world-mode').textContent = `${labels[mode]}${mode === 'local' && localEphemeral ? ' · Not saved' : ''}`;
  element('.world-mode').hidden = mode === 'local' && !!journey?.outcome && !localEphemeral && !localStopped;
  element('.mode').dataset['connection'] = mode;
  element('.mode-detail').textContent = mode === 'local' ? localEphemeral ? 'Not saved' : 'Built-in policies' : 'Read only';
  const sourceNotice = worldSource === 'living' ? livingSaveMessage : worldSource === 'partnerships' ? partnershipsSaveMessage : worldSource === 'prior' ? priorSaveMessage : worldSource === 'previous' ? previousSaveMessage : worldSource === 'local' ? localSaveMessage : 'Native world archive · Read-only committed records.';
  element('#local-save-status').textContent = sourceNotice;
  element('.footer-status').textContent = mode === 'local' ? localSaveMessage : mode === 'living' ? 'Previous living world · Read-only snapshot' : mode === 'partnerships' ? 'Living partnerships · Read-only snapshot' : mode === 'prior' ? 'Previous generated world · Read-only snapshot' : mode === 'previous' ? 'First local world · Read-only snapshot' : mode === 'sample' ? 'Illustrative atlas · Not a simulation' : mode === 'unavailable' ? 'Original save preserved · Choose a world in Settings' : 'Native world archive · Observer only';
  element('#about-source').textContent = mode === 'local' ? state?.outcome ? `This generated world is complete and no longer advances. Its civilizations used built-in rules, not live AI-model play.${localEphemeral ? ' This tab’s progress is not saved.' : ' Checkpoint status is shown in the footer.'}` : `Five civilizations make automatic choices with built-in rules. This generated world runs in your browser with accelerated time, not live AI-model play. It pauses while this tab is hidden.${localEphemeral ? ' This tab’s new progress is not saved.' : ' Browser checkpoints are saved periodically.'}` : mode === 'living' || mode === 'partnerships' || mode === 'prior' || mode === 'previous' ? 'The original local world is a read-only snapshot. It does not resume its old policy, migrate, or overwrite the original save.' : mode === 'unavailable' ? sourceNotice : mode === 'sample' ? 'An illustrative map, not a running world. No player orders.' : 'This view reads committed native-world records. It does not claim that AI models are acting continuously. No player orders.';
  element('#about-world-record').textContent = state ? `Seed ${state.seed} · Round ${state.round} · Revision ${state.revision} · Release ${state.releaseId}${mode === 'local' && localFailure ? ` · Stopped: ${localFailure}` : ''}` : 'No world record loaded.';
  element('#world-id').textContent = mode === 'sample' ? 'ILLUSTRATIVE MAP' : 'WORLD CALENDAR';
  element('#world-id').title = state ? `Seed ${state.seed} · Revision ${state.revision}` : '';
  element('#world-title').textContent = state ? formatYear(state.year) : mode === 'unavailable' ? 'Saved world unavailable' : mode === 'sample' ? 'A possible beginning' : mode === 'uninitialized' ? 'Waiting for the first hearths' : mode === 'offline' ? 'The world is out of reach' : 'Connecting to the world';
  element('#world-detail').textContent = state ? journey?.outcome ? journey.roundLabel : `Round ${state.round} · ${mode === 'local' ? localEphemeral ? 'This tab only' : 'Accelerated time' : mode === 'living' || mode === 'partnerships' || mode === 'prior' || mode === 'previous' ? 'Read-only snapshot' : mode === 'live' ? 'Native archive' : 'Last known'}` : mode === 'unavailable' ? sourceNotice : mode === 'sample' ? 'Sample geography and decorative routes. This is not a running world.' : mode === 'uninitialized' ? 'The server is ready, but its world has not been started. Checking again automatically.' : mode === 'offline' ? 'No verified world data is available. Reconnecting automatically.' : 'Looking for the latest committed state.';
  element('#world-detail').title = state ? `${activityLabel(state)}${lastRead ? ` · Last verified read ${lastRead}` : ''}` : '';
  element('#era-name').textContent = journey?.headline ?? 'Early settlements';
  element('#era-detail').textContent = journey?.outcome ? `${journey.outcome.winners.join(', ')} · Round ${journey.outcome.round}` : state ? 'WORLD STAGE · JOURNEY' : mode === 'sample' ? 'SAMPLE VIEW' : 'OBSERVER';
  element('#era-name').title = state ? `Applied release ${state.releaseId}` : '';
  for (const opener of document.querySelectorAll<HTMLButtonElement>('[data-open-journey]')) opener.disabled = !state;
  if (dialogs.get('journey')?.open) {
    if (journeyRevision < 0 && state) renderJourney();
    else element('#journey-refresh').hidden = !state || (observedWorldKey() === journeyIdentity && state.revision <= journeyRevision);
  }
  const event = state ? latestStoryEvent(state.events) : undefined;
  const story = event && state ? eventLogEntries([event], { civilizations: state.civilizations, receipts: observedRouteResults })[0] : undefined;
  const receipt = observedRouteResults.find((cue) => cue.eventId === event?.id);
  const routeResult = receipt ? routeResultPresentation(receipt) : null;
  const visual = event ? eventVisual(event) : null;
  element('#chronicle-label').textContent = story ? `${story.category} · ${story.deltas.some(delta => delta.kind === 'production') ? 'Before costs' : `Round ${story.round}`}` : mode === 'sample' ? 'SAMPLE VIEW' : 'WORLD CONNECTION';
  element('#event-title').textContent = story?.title ?? (mode === 'sample' ? 'A sample, not a simulation.' : state ? 'No major changes in recent history.' : 'The story will appear here.');
  element('#event-detail').textContent = story?.summary ?? (mode === 'sample' ? 'These cities and routes illustrate the atlas. Return to observatory to watch committed changes.' : state ? 'Research, construction and other major changes appear here. Open Events for routine records.' : 'This page only reads. Agent actions, discoveries and world events will be shown after they are committed.');
  const icon = story?.icon ?? routeResult?.icon ?? visual?.icon;
  if (icon) element('#event-title').prepend(visualIcon(icon));
  renderDeltas(element('#event-deltas'), story?.deltas ?? routeResult?.deltas ?? visual?.deltas ?? []);
  element('#event-detail').hidden = !story?.summary || !!story.deltas.length;
  element('#events-open').hidden = !state?.events.length;
  const stories = state ? spectatorChronicle(state) : [];
  const nextChronicle = JSON.stringify(stories);
  const nextChronicleIdentity = observedWorldKey();
  if (nextChronicleIdentity !== chronicleIdentity || nextChronicle !== chronicleFingerprint && !element('#major-event-list').contains(document.activeElement)) {
    renderSpectatorChronicle(element('#major-event-list'), stories, navigateStory, nextChronicleIdentity);
    chronicleFingerprint = nextChronicle;
    chronicleIdentity = nextChronicleIdentity;
  }
  element('#connection-story').hidden = stories.length > 0;
  element('#sample-open').hidden = snapshot !== null || mode === 'sample' || mode === 'loading';
  element('#live-open').hidden = mode !== 'sample';
  for (const button of document.querySelectorAll<HTMLButtonElement>('.map-tools button, .layer-controls button')) button.disabled = atlas === null || button.hasAttribute('data-layer') && worldBody === 'mars';
  renderInspection();
  if (dialogs.get('events')?.open && !eventHistoryCaptured) renderEventHistory();
  if (dialogs.get('events')?.open && snapshot) element('#events-refresh').hidden = snapshot.state.revision <= eventHistoryRevision;
}

function quietCues(): void {
  atlas?.clearEvents();
  if (snapshot) eventCues.observe({ identity: observedWorldKey(), revision: snapshot.state.revision, mode: 'history', events: snapshot.state.events, routes: displayed.routes }, 0);
}

function showSample(): void {
  savePreferences(); worldView.release(); worldBody = 'earth';
  clearObservedHistory();
  capabilityTree.close();
  quietCues();
  atlas?.dispose(); atlas = null; mapFingerprint = ''; inspectionCamera.release();
  preferences = { ...preferences, selectedCity: null, selected: 0, zoom: 1, x: 0, z: 0 }; initialOverview = true;
  mode = 'sample';
  renderWorld(createPreviewWorld());
  renderConnection();
}

function sampleActive(): boolean { return mode === 'sample'; }
function localActive(): boolean { return worldSource !== 'shared'; }

async function saveLocalSimulation(): Promise<void> {
  if (!localWasObserved || localSaveBlocked || localEphemeral) return;
  const previous = localSimulation;
  const saved = await localWorldStorage.save(() => localSimulation);
  if (saved.run && (!localSimulation || localSimulationSnapshot(saved.run).identity === localSimulationSnapshot(localSimulation).identity
    && saved.run.steps >= localSimulation.steps && saved.run.state.revision >= localSimulation.state.revision)) localSimulation = saved.run;
  localSaveMessage = saved.message; localEphemeral = saved.ephemeral; localSaveBlocked = saved.blocked;
  if (mode === 'local' && !document.hidden && localSimulation !== previous) observeLocalSimulation();
  else renderConnection();
}

function observeLocalSimulation(): void {
  const run = mode === 'living' ? livingSimulation : mode === 'partnerships' ? partnershipsSimulation : mode === 'prior' ? priorSimulation : mode === 'previous' ? previousSimulation : localSimulation;
  if (!run) return;
  if (mode === 'local') localWasObserved = true;
  const next = localSimulationSnapshot(run);
  observeWorldIdentity(next, mode === 'living' ? 'living' : mode === 'partnerships' ? 'partnerships' : mode === 'prior' ? 'prior' : mode === 'previous' ? 'previous' : 'local');
  snapshot = next;
  observedAt = run.timestamp;
  lastRead = '';
  const world = projectWorld(snapshot.state);
  const quiet = worldBody === 'mars' || mode === 'living' || mode === 'partnerships' || mode === 'prior' || mode === 'previous' || document.hidden || dialogs.get('events')?.open || dialogs.get('journey')?.open || capabilityDialog?.open;
  const cues = eventCues.observe({ identity: observedWorldKey(), revision: snapshot.state.revision, mode: quiet ? 'history' : 'live', events: snapshot.state.events, routes: world.routes }, element('#map').clientWidth < 700 ? 1 : 3);
  if (cues.routeResults.length) observedRouteResults = [...cues.routeResults, ...observedRouteResults].slice(0, 3);
  renderWorld(world, true);
  if (!quiet) atlas?.showEvents(cues.events);
  renderConnection();
}

function changeWorldSource(source: WorldSource): void {
  savePreferences(); worldView.release(); quietCues(); worldSource = source; worldBody = preferences.worldBody ?? worldBody;
  clearObservedHistory(); capabilityTree.close(); setInspectionOpen(false); inspectionCamera.release();
  atlas?.dispose(); atlas = null; mapFingerprint = ''; inspectionFingerprint = ''; chronicleFingerprint = '';
  displayed = { tiles: [], cities: [], routes: [] }; snapshot = null; selectedRoute = null; observedRouteResults = [];
  element('.civilization-panel').hidden = true; element('#city-labels').replaceChildren();
  preferences = { ...preferences, worldSource: source }; savePreferences();
  try { history.replaceState(history.state as unknown, '', worldSourceHref(window.location.href, source)); } catch {}
  const picker = document.querySelector<HTMLSelectElement>('#world-source'); if (picker) picker.value = source;
  if ((source === 'local' && !localSimulation) || (source === 'living' && !livingSimulation) || (source === 'partnerships' && !partnershipsSimulation) || (source === 'prior' && !priorSimulation) || (source === 'previous' && !previousSimulation)) { mode = 'unavailable'; renderConnection(); }
  else if (source === 'local' || source === 'living' || source === 'partnerships' || source === 'prior' || source === 'previous') { mode = source; observeLocalSimulation(); if (source === 'local') void saveLocalSimulation(); }
  else { mode = 'loading'; renderConnection(); void readWorld(); }
}

let reading = false;
async function readWorld(): Promise<void> {
  if (reading || localActive() || sampleActive()) return;
  reading = true;
  try {
    const response = await fetch('/api/world', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const value: unknown = await response.json();
    if (localActive() || sampleActive()) return;
    const read = parseWorldRead(value);
    if (read.kind === 'live' && response.ok && acceptsSnapshot(snapshot, read.snapshot)) {
      const retainCoordinates = snapshot?.identity === read.snapshot.identity && mode !== 'sample';
      if (snapshot?.identity !== read.snapshot.identity) { selectedRoute = null; routeListPage = 0; observedRouteResults = []; }
      observeWorldIdentity(read.snapshot, 'shared');
      snapshot = read.snapshot;
      mode = 'live';
      observedAt = new Date().toISOString();
      lastRead = new Date(observedAt).toLocaleTimeString('en-GB', { timeZone: 'UTC', hour12: false }) + ' UTC';
      const world = projectWorld(snapshot.state);
      const quiet = worldBody === 'mars' || document.hidden || dialogs.get('events')?.open || dialogs.get('journey')?.open || capabilityDialog?.open;
      const cues = eventCues.observe({ identity: observedWorldKey(), revision: snapshot.state.revision, mode: quiet ? 'history' : 'live', events: snapshot.state.events, routes: world.routes }, element('#map').clientWidth < 700 ? 1 : 3);
      if (cues.routeResults.length) observedRouteResults = [...cues.routeResults, ...observedRouteResults].slice(0, 3);
      renderWorld(world, retainCoordinates);
      if (!quiet) atlas?.showEvents(cues.events);
    } else { mode = read.kind === 'uninitialized' ? 'uninitialized' : 'offline'; }
  } catch { if (!localActive() && !sampleActive()) mode = 'offline'; }
  finally { reading = false; renderConnection(); }
}

for (const [id, factor] of [['#zoom-in', 1.2], ['#zoom-out', 1 / 1.2]] as const) element(id).addEventListener('click', () => { atlas?.zoom(factor); frameInspection(); savePreferences(); });
element('#reset-camera').addEventListener('click', () => { setInspectionOpen(false); inspectionCamera.release(); atlas?.reset(); savePreferences(); });
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
  if (element('.observatory').dataset['inspection'] === 'true' && atlas) {
    inspectionCamera.begin(atlas.snapshot()); frameInspection();
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
for (const button of document.querySelectorAll<HTMLButtonElement>('.body-switch [data-body]')) button.addEventListener('click', () => { const body = parseWorldBody(button.dataset['body']); if (body) changeWorldBody(body); });
element('#sample-open').addEventListener('click', showSample);
element('#live-open').addEventListener('click', () => changeWorldSource(worldSource));

const dialogs = new Map<string, HTMLDialogElement>();
for (const [name, selector] of [['changelog', '#history-dialog'], ['about', '#about-dialog'], ['events', '#events-dialog'], ['settings', '#settings-dialog'], ['resource', '#resource-dialog'], ['journey', '#journey-dialog']]) {
  if (!name || !selector) continue;
  const dialog = document.querySelector<HTMLDialogElement>(selector);
  if (!dialog) throw new Error('A spectator dialog is missing');
  dialogs.set(name, dialog);
}
let releaseHistoryIndex = 0;
function renderReleaseHistory(): void {
  const page = releaseHistoryPage(changelog, releaseHistoryIndex);
  releaseHistoryIndex = page.page;
  element('.release-history').innerHTML = page.entries.map((entry, index) => `<details class="release-entry" ${index === 0 ? 'open' : ''}><summary><span class="release-version">v${escapeText(entry.version)}</span><strong>${escapeText(entry.title)}</strong></summary><time datetime="${escapeText(entry.date)}">${escapeText(entry.date)}</time><ul>${entry.changes.map(change => `<li>${escapeText(change)}</li>`).join('')}</ul></details>`).join('');
  element('#history-range').textContent = page.total ? `${page.start + 1}–${page.end} of ${page.total}` : 'No updates recorded';
  const newer = element('#history-newer');
  const older = element('#history-older');
  if (!(newer instanceof HTMLButtonElement) || !(older instanceof HTMLButtonElement)) throw new Error('Update history navigation is missing');
  newer.disabled = page.page === 0;
  older.disabled = page.page + 1 === page.pages;
}
function renderEventHistory(): void {
  const current = mode === 'sample' ? null : snapshot;
  const events = current?.state.events;
  eventHistoryCaptured = events !== undefined;
  eventHistoryRevision = current?.state.revision ?? -1;
  element('#events-refresh').hidden = true;
  element('#events-dialog .dialog-intro').textContent = current
    ? `Revision ${current.state.revision} · Captured view. New records appear after Refresh.`
    : 'Waiting for committed world history.';
  if (events && current) renderEventLog(element('#event-list'), events, {
    civilizations: current.state.civilizations, receipts: observedRouteResults,
  });
  else element('#event-list').textContent = 'Waiting for committed world history.';
}
function renderJourney(preserveInspection = false): void {
  const current = mode === 'sample' ? null : snapshot;
  const refresh = preserveInspection && observedWorldKey() === journeyIdentity
    ? { scrollHost: element('#journey-dialog'), scrollTop: element('#journey-dialog').scrollTop } : undefined;
  journeyRevision = current?.state.revision ?? -1; journeyIdentity = current ? observedWorldKey() : '';
  element('#journey-refresh').hidden = true;
  element('#journey-caption').textContent = current ? `${worldJourney(current.state).roundLabel} · Captured ${worldSource === 'living' ? 'previous living' : worldSource === 'partnerships' ? 'Living partnerships' : worldSource === 'prior' ? 'previous generated' : worldSource === 'previous' ? 'first local' : worldSource === 'shared' ? 'native archive' : 'generated world'} view. ${current.state.outcome ? 'Final world records.' : 'New records appear after Refresh.'}` : 'Waiting for a world record.';
  if (current) renderMarsObservation(element('#journey-content'), current.state, preferences.selected, id => { closeDialog(); selectCity(id); }, refresh);
  else element('#journey-content').textContent = 'No world record loaded.';
}
function syncDialog(): void {
  const active = window.location.hash.slice(1);
  for (const [name, dialog] of dialogs) {
    if (name === active && !dialog.open) {
      if (name === 'events') { quietCues(); renderEventHistory(); }
      if (name === 'journey') { quietCues(); renderJourney(); }
      if (name === 'changelog') { releaseHistoryIndex = 0; renderReleaseHistory(); }
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
let releaseHistoryOpener: HTMLButtonElement | null = null;
let journeyOpener: HTMLButtonElement | null = null;
function closeDialog(): void {
  const name = window.location.hash.slice(1);
  const dialog = dialogs.get(name);
  dialog?.close();
  if (name === 'events') { eventHistoryCaptured = false; eventHistoryOpener?.focus({ preventScroll: true }); }
  if (name === 'changelog') releaseHistoryOpener?.focus({ preventScroll: true });
  if (name === 'journey') (journeyOpener?.getClientRects().length ? journeyOpener : element(narrowLayout.matches ? '#journey-nav' : '#journey-open')).focus({ preventScroll: true });
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
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open-changelog]')) button.addEventListener('click', () => { releaseHistoryOpener = button; window.location.hash = 'changelog'; });
for (const [id, step] of [['history-newer', -1], ['history-older', 1]] as const) element(`#${id}`).addEventListener('click', () => {
  releaseHistoryIndex += step;
  renderReleaseHistory();
  const historyDialog = element('#history-dialog');
  historyDialog.scrollTop = 0;
  const heading = element('#history-title');
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
});
for (const button of document.querySelectorAll<HTMLButtonElement>('.about-button')) button.addEventListener('click', () => { window.location.hash = 'about'; });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open-events]')) button.addEventListener('click', () => { eventHistoryOpener = button; window.location.hash = 'events'; });
element('#events-refresh').addEventListener('click', () => { renderEventHistory(); const heading = element('#events-dialog h2'); heading.tabIndex = -1; heading.focus({ preventScroll: true }); });
element('#settings-open').addEventListener('click', () => { window.location.hash = 'settings'; });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-open-journey]')) button.addEventListener('click', () => { journeyOpener = button; window.location.hash = 'journey'; });
element('#journey-refresh').addEventListener('click', () => { renderJourney(true); const heading = element('#journey-title'); heading.tabIndex = -1; heading.focus({ preventScroll: true }); });
for (const dialog of dialogs.values()) {
  dialog.querySelector('button')?.addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); closeDialog(); });
  dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(); });
}
window.addEventListener('hashchange', syncDialog);
syncDialog();
window.addEventListener('pagehide', (event) => { quietCues(); savePreferences(); void saveLocalSimulation(); if (!event.persisted) disposeLocalSimulationWorker(); });
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
    preferences: () => worldView.capture(preferences, { ...preferences, ...inspectionCamera.savedCamera(atlas?.snapshot() ?? preferences) }),
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
window.addEventListener('visibilitychange', () => { if (document.hidden) quietCues(); else { if (mode === 'local') observeLocalSimulation(); void readWorld(); void deploymentUpdates.check(); } });
renderConnection();
if (new URL(window.location.href).searchParams.get('sample') === '1') showSample();
else changeWorldSource(parseWorldSource(new URL(window.location.href).searchParams.get('world')) ?? worldSource);
void deploymentUpdates.check();

element('#world-source').addEventListener('change', (event) => {
  const source = parseWorldSource((event.target as HTMLSelectElement).value);
  if (source) changeWorldSource(source);
});
async function tickLocalObservatory(): Promise<void> {
  if (mode !== 'local' || document.hidden || localStopped || localSaveBlocked || localAdvancing || !localSimulation || localSimulation.state.outcome) return;
  localAdvancing = true;
  const prior = localSimulation;
  try {
    const prepared = await localWorldStorage.prepareCurrentRelease(() => mode === 'local' && !document.hidden && !localStopped ? localSimulation : null);
    localSaveMessage = prepared.message; localEphemeral = prepared.ephemeral; localSaveBlocked = prepared.blocked;
    if (mode !== 'local' || document.hidden || localStopped || localSaveBlocked || localSimulation !== prior || !prepared.run) { renderConnection(); return; }
    localSimulation = prepared.run;
    if (localSimulation.state.outcome) { observeLocalSimulation(); return; }
    const advancing = localSimulation;
    const next = await advanceLocalSimulationAsync(advancing, 2);
    if (mode !== 'local' || document.hidden || localStopped || localSaveBlocked || localSimulation !== advancing) return;
    if (localSimulationSnapshot(localSimulation).identity === localSimulationSnapshot(next).identity && next.steps >= localSimulation.steps && next.state.revision >= localSimulation.state.revision) localSimulation = next;
    if (mode === 'local' && !document.hidden) observeLocalSimulation();
    localFrames += 1;
    if (localFrames % 6 === 0 || localSimulation.state.outcome) void saveLocalSimulation();
  } catch (error) { localStopped = true; localFailure = error instanceof Error ? error.message : 'The local step could not be recorded.'; renderConnection(); }
  finally { localAdvancing = false; }
}
window.setInterval(() => { void tickLocalObservatory(); }, 1200);
