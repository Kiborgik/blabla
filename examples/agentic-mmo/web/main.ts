import releaseData from '../public/version.json';
import changelog from '../public/changelog.json';
import { CIVILIZATIONS, createPreviewWorld } from './atlas.ts';
import { createAtlasRenderer } from './renderer.ts';
import type { AtlasRenderer } from './renderer.ts';
import { parsePreferences, parseRelease, shouldReload } from './viewer-state.ts';

const PREFERENCES_KEY = 'civitas:viewer:v1';
const RELOAD_KEY = 'civitas:attempted-deployments';
const release = parseRelease(releaseData);
if (!release) throw new Error('The bundled deployment manifest is invalid.');
const currentRelease = release;

function readStored(key: string, session = false): unknown {
  try {
    const stored = (session ? sessionStorage : localStorage).getItem(key);
    return stored ? (JSON.parse(stored) as unknown) : null;
  } catch {
    return null;
  }
}

let preferences = parsePreferences(readStored(PREFERENCES_KEY));
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('The spectator application mount is missing.');

app.innerHTML = `
  <header class="masthead">
    <a class="brand" href="#" aria-label="Civitas home"><span class="brand-mark" aria-hidden="true">C</span><span>CIVITAS<small>A WORLD OF ITS OWN</small></span></a>
    <nav class="top-nav" aria-label="Atlas information"><span class="nav-active">The atlas</span><button class="text-button about-button" type="button">About this world <span aria-hidden="true">↗</span></button></nav>
    <div class="mode"><span class="status-dot"></span> ATLAS PREVIEW <span class="mode-detail">HUMANS OBSERVE. AGENTS DECIDE.</span></div>
  </header>
  <main class="observatory">
    <div id="map" class="map"><div class="ocean-name ocean-name-one" aria-hidden="true">THE OPEN SEA</div><div class="ocean-name ocean-name-two" aria-hidden="true">SOUTHERN REACH</div><div id="city-labels" class="city-labels"></div></div>
    <section class="world-heading" aria-label="Current world status"><span class="eyebrow">WORLD 001 / ATLAS PREVIEW</span><h1>Every civilization<br>starts with a possibility.</h1><p>Sample world. Live agents are not running.</p></section>
    <div class="era-pill"><span class="era-icon" aria-hidden="true">☀</span><span><strong>The dawn of an idea</strong><small>SETTLEMENT ERA · ILLUSTRATIVE WORLD</small></span></div>
    <aside class="civilization-panel panel" aria-label="Civilizations"><div class="panel-heading"><span class="eyebrow">THE CIVILIZATIONS</span><span class="count">05</span></div><div class="civilization-list">${CIVILIZATIONS.map((civ) => `<button class="civilization-row" data-civ="${civ.id}" type="button" style="--civ-color:${civ.color}" aria-pressed="${civ.id === preferences.selected}"><span class="civ-emblem" aria-hidden="true">${civ.symbol}</span><span><strong>${civ.name}</strong><small>${civ.character}</small></span><span class="row-arrow" aria-hidden="true">↗</span></button>`).join('')}</div><div class="director"><span class="director-icon" aria-hidden="true">✶</span><span><strong>World Director</strong><small>THE SIXTH PERSPECTIVE</small></span><span class="director-badge">AI</span></div></aside>
    <aside class="inspection panel" aria-label="Civilization inspection" aria-live="polite"><div class="inspection-top"><span class="eyebrow">CIVILIZATION IN FOCUS</span><span class="preview-tag">PREVIEW</span></div><div class="inspection-title"><span id="selected-symbol" class="focus-symbol" aria-hidden="true"></span><div><h2 id="selected-name"></h2><p id="selected-character"></p></div></div><p id="selected-ambition" class="ambition"></p><div class="capital-detail"><span>FOUNDING CAPITAL</span><strong id="selected-capital"></strong><span class="tiny-star" aria-hidden="true">✦</span></div><p class="inspection-note">A place in the atlas. Its story is still unwritten.</p></aside>
    <div class="map-tools" role="group" aria-label="Map camera"><button id="zoom-in" type="button" aria-label="Zoom in">+</button><button id="zoom-out" type="button" aria-label="Zoom out">−</button><span></span><button id="reset-camera" type="button" aria-label="Reset camera"><span aria-hidden="true">⌖</span></button></div>
    <div class="compass" aria-hidden="true"><span>N</span><svg viewBox="0 0 64 64"><path d="m32 8 7 24-7 24-7-24Z" fill="#e7d6aa"/><path d="m8 32 24-7 24 7-24 7Z" fill="#e7d6aa" opacity=".4"/><circle cx="32" cy="32" r="24" fill="none" stroke="#e7d6aa" stroke-opacity=".35"/><circle cx="32" cy="32" r="3" fill="#204a51"/></svg></div>
    <div class="layer-controls" role="group" aria-label="Atlas layers"><button data-layer="borders" type="button" aria-pressed="${preferences.borders}"><span aria-hidden="true">⬡</span> Borders</button><button data-layer="routes" type="button" aria-pressed="${preferences.routes}"><span aria-hidden="true">⌁</span> Routes</button></div>
    <section class="chronicle panel" aria-label="Preview information"><span class="chronicle-icon" aria-hidden="true">✧</span><div><span class="eyebrow">BEFORE THE FIRST CHAPTER</span><strong>A world waiting to happen.</strong><p>This is an interactive atlas scaffold. Cities and routes are illustrative; live agents and gameplay are not running.</p></div><button class="about-button chronicle-arrow" type="button" aria-label="Read about this world">↗</button></section>
    <div class="map-hint"><span aria-hidden="true">↔</span> Drag to explore <span>·</span> Pinch or scroll to zoom <span>·</span> Tap a capital</div>
    <div class="ambient-control"><button id="motion-toggle" type="button" aria-pressed="${!preferences.paused}" aria-label="${preferences.paused ? 'Resume' : 'Pause'} decorative route motion">${preferences.paused ? '▷' : 'Ⅱ'}</button><span>ATLAS MOTION<small>Illustrative routes</small></span></div>
    <div class="fallback-message" hidden><span aria-hidden="true">◈</span><h2>Your atlas, in a lighter view.</h2><p>This browser couldn’t start the 3D map. You can still explore all five civilizations using the list.</p></div>
  </main>
  <footer class="footer"><span class="footer-status"><span class="status-dot"></span> A SHARED WORLD. AN OPEN FUTURE.</span><div class="release-links"><span id="version">v${currentRelease.version}</span><span class="footer-divider">/</span><button id="changelog-open" type="button">Changelog <span aria-hidden="true">↗</span></button><span class="footer-divider">/</span><span>Built using <strong>BlaBla</strong></span></div></footer>
  <dialog id="history-dialog" aria-labelledby="history-title"><div class="dialog-top"><span class="eyebrow">THE WORLD KEEPS GROWING</span><button class="dialog-close" type="button" aria-label="Close update history">×</button></div><h2 id="history-title">A record of what’s new.</h2><p class="dialog-intro">Every release, from the very first atlas.</p><div class="release-history">${changelog.map((entry) => `<article class="release-entry"><div><span class="release-version">v${entry.version}</span><time datetime="${entry.date}">${new Date(`${entry.date}T12:00:00Z`).toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</time></div><h3>${entry.title}</h3><ul>${entry.changes.map((change) => `<li>${change}</li>`).join('')}</ul></article>`).join('')}</div></dialog>
  <dialog id="about-dialog" aria-labelledby="about-title"><div class="dialog-top"><span class="eyebrow">AN AUTONOMOUS CIVILIZATION EXPERIMENT</span><button class="dialog-close" type="button" aria-label="Close world information">×</button></div><h2 id="about-title">The world, without us.</h2><p class="dialog-intro">Five AI civilizations. A sixth AI World Director. Humans watch the story unfold.</p><div class="about-body"><p>The growing world’s roadmap begins with early settlements and reaches toward a life on Mars. Resources, trade, diplomacy, science and unexpected events will connect every civilization’s choices.</p><div class="journey"><span>First settlement</span><span>↗</span><span>A shared planet</span><span>↗</span><span>Mars</span></div><h3>Two horizons to pursue</h3><p>A scientific ending through settlement on Mars, or a political ending through a lasting world federation.</p><p class="honesty-note">You’re viewing the first presentation scaffold. This atlas uses fixed sample geography and decorative motion. It is not a live campaign, replay or demonstration of model decisions.</p></div></dialog>
  <div id="update-notice" class="update-notice" role="status" hidden>A newer atlas is ready. Updating your view…</div>
`;

function element(selector: string): HTMLElement {
  const result = document.querySelector<HTMLElement>(selector);
  if (!result) throw new Error(`Missing spectator element: ${selector}`);
  return result;
}

let atlas: AtlasRenderer | null = null;
function selectCivilization(id: number): void {
  const civilization = CIVILIZATIONS[id];
  if (!civilization) return;
  preferences = { ...preferences, selected: id };
  element('#selected-name').textContent = civilization.name;
  element('#selected-character').textContent = civilization.character;
  element('#selected-symbol').textContent = civilization.symbol;
  element('#selected-ambition').textContent = `“${civilization.ambition}”`;
  element('#selected-capital').textContent = civilization.capital;
  element('.inspection').style.setProperty('--civ-color', civilization.color);
  for (const row of document.querySelectorAll<HTMLElement>('[data-civ]'))
    row.setAttribute('aria-pressed', String(Number(row.dataset['civ']) === id));
  atlas?.select(id);
}

selectCivilization(preferences.selected);
try {
  atlas = createAtlasRenderer(
    element('#map'),
    element('#city-labels'),
    createPreviewWorld(),
    preferences,
    selectCivilization,
  );
} catch (error) {
  console.warn('The 3D atlas could not initialize.', error);
  element('.fallback-message').hidden = false;
  element('.observatory').classList.add('map-unavailable');
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '.map-tools button, .layer-controls button, #motion-toggle',
  ))
    button.disabled = true;
}

for (const row of document.querySelectorAll<HTMLElement>('[data-civ]'))
  row.addEventListener('click', () => selectCivilization(Number(row.dataset['civ'])));
element('#zoom-in').addEventListener('click', () => atlas?.zoom(1.2));
element('#zoom-out').addEventListener('click', () => atlas?.zoom(1 / 1.2));
element('#reset-camera').addEventListener('click', () => atlas?.reset());
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-layer]')) {
  button.addEventListener('click', () => {
    const layer = button.dataset['layer'];
    if (layer !== 'borders' && layer !== 'routes') return;
    const visible = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(visible));
    atlas?.setLayer(layer, visible);
    preferences = { ...preferences, [layer]: visible };
    savePreferences();
  });
}
element('#motion-toggle').addEventListener('click', () => {
  preferences = { ...preferences, paused: !preferences.paused };
  atlas?.setMotion(!preferences.paused);
  const button = element('#motion-toggle');
  button.textContent = preferences.paused ? '▷' : 'Ⅱ';
  button.setAttribute('aria-pressed', String(!preferences.paused));
  button.setAttribute(
    'aria-label',
    `${preferences.paused ? 'Resume' : 'Pause'} decorative route motion`,
  );
});

const historyDialog = document.querySelector<HTMLDialogElement>('#history-dialog');
const aboutDialog = document.querySelector<HTMLDialogElement>('#about-dialog');
if (!historyDialog || !aboutDialog) throw new Error('Spectator information dialogs are missing.');
const dialogs: Record<string, HTMLDialogElement> = { changelog: historyDialog, about: aboutDialog };
function syncDialog(): void {
  const active = window.location.hash.slice(1);
  for (const [name, dialog] of Object.entries(dialogs)) {
    if (name === active && !dialog.open) dialog.showModal();
    if (name !== active && dialog.open) dialog.close();
  }
}
function closeDialog(): void {
  const target = dialogs[window.location.hash.slice(1)];
  if (target?.open) {
    target.close();
    history.replaceState(null, '', `${location.pathname}${location.search}`);
  }
}
element('#changelog-open').addEventListener('click', () => {
  window.location.hash = 'changelog';
});
for (const button of document.querySelectorAll<HTMLButtonElement>('.about-button'))
  button.addEventListener('click', () => {
    window.location.hash = 'about';
  });
for (const dialog of Object.values(dialogs)) {
  dialog.querySelector('button')?.addEventListener('click', closeDialog);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDialog();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog();
  });
}
window.addEventListener('hashchange', syncDialog);
syncDialog();

function savePreferences(): void {
  preferences = { ...preferences, ...atlas?.snapshot() };
  try {
    localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
  } catch {
    return;
  }
}
window.addEventListener('pagehide', savePreferences);
window.addEventListener('pointerup', savePreferences);
window.addEventListener('wheel', savePreferences, { passive: true });

async function checkDeployment(): Promise<void> {
  if (document.hidden) return;
  try {
    const response = await fetch(new URL('version.json', document.baseURI), {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return;
    const remote = parseRelease((await response.json()) as unknown);
    const storedAttempts = readStored(RELOAD_KEY, true);
    const attempts = Array.isArray(storedAttempts)
      ? storedAttempts.filter((entry): entry is string => typeof entry === 'string')
      : [];
    if (!shouldReload(currentRelease, remote, attempts) || !remote) return;
    savePreferences();
    sessionStorage.setItem(RELOAD_KEY, JSON.stringify([...attempts, remote.buildId].slice(-20)));
    element('#update-notice').hidden = false;
    window.location.reload();
  } catch {
    return;
  }
}
window.setInterval(() => {
  void checkDeployment();
}, 30000);
window.addEventListener('visibilitychange', () => {
  if (!document.hidden) void checkDeployment();
});
void checkDeployment();
