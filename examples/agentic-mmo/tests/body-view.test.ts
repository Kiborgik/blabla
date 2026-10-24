import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createWorld } from '../core/engine.ts';
import { bodySelection, bodyViewContext, bodyViewDescription, worldBodyHref } from '../web/body-view.ts';
import { projectWorld } from '../web/live-world.ts';
import { DEFAULT_PREFERENCES, parsePreferences } from '../web/viewer-state.ts';
import { createWorldViewSession, DEFAULT_WORLD_CAMERA, parseWorldBody, saveWorldView } from '../web/world-view.ts';
import type { WorldViewIdentity, WorldCamera } from '../web/world-view.ts';
import { planDeploymentUpdate, restoreDeploymentPreferences } from '../web/deployment-update.ts';

void test('body selection preserves the exact Earth town but uses a separate civilization identity on Mars', () => {
  const state = createWorld(1701); const world = projectWorld(state); const before = structuredClone(world);
  const city = world.cities[2]!;
  const earth = bodySelection('earth', world, { selected: city.id, selectedCity: city.cityId ?? null });
  assert.equal(earth.selected, city.id); assert.equal(earth.selectedCity, city.cityId);
  assert.deepEqual(bodySelection('mars', world, earth), { selected: city.id, selectedCity: `mars:${city.id}` });
  assert.deepEqual(bodySelection('mars', { tiles: [], routes: [], cities: [] }, earth), { selected: 0, selectedCity: null });
  assert.deepEqual(world, before);
});

void test('Earth and Mars views retain independent cameras and selections across every source and genesis', () => {
  const identities: WorldViewIdentity[] = ['one', 'two'].flatMap(identity => (['local', 'shared'] as const).flatMap(source => ['earth', 'mars'].map(body => ({ source, identity, body }))));
  let saved = { ...DEFAULT_PREFERENCES };
  const cameras: WorldCamera[] = identities.map((identity, index) => ({ zoom: .5 + index / 5, x: index - 5, z: 5 - index, selected: index % 5, selectedCity: identity.body === 'earth' ? `town-${index}` : `mars:${index % 5}` }));
  identities.forEach((identity, index) => { saved = saveWorldView(saved, identity, cameras[index]!); });
  saved = parsePreferences(JSON.parse(JSON.stringify(saved)));
  const session = createWorldViewSession();
  identities.forEach((identity, index) => {
    const view = session.observe(saved, identity); assert.equal(view.restored, true); assert.equal(view.changed, true);
    for (const key of Object.keys(DEFAULT_WORLD_CAMERA) as Array<keyof WorldCamera>) assert.equal(view.preferences[key], cameras[index]![key]);
    assert.equal(view.preferences.worldBody, identity.body); assert.equal(view.preferences.worldSource, identity.source);
  });
  assert.equal(session.observe(saved, { source: 'local', identity: 'new-genesis', body: 'mars' }).restored, false);
});

void test('body preference parsing and URLs cannot turn an unknown body into an Earth camera or erase source history', () => {
  assert.equal(parseWorldBody('mars'), 'mars'); assert.equal(parseWorldBody('earth'), 'earth');
  for (const invalid of ['MARS', 'moon', '', null, {}, 1]) assert.equal(parseWorldBody(invalid), null);
  assert.equal(parsePreferences({ ...DEFAULT_PREFERENCES, worldBody: 'moon' }).worldBody, undefined);
  assert.equal(parsePreferences({ ...DEFAULT_PREFERENCES, worldBody: 'mars' }).worldBody, 'mars');
  const url = new URL(worldBodyHref('https://viewer.example/atlas?world=shared&other=keep#journey', 'mars'));
  assert.equal(url.searchParams.get('world'), 'shared'); assert.equal(url.searchParams.get('body'), 'mars');
  assert.equal(url.searchParams.get('other'), 'keep'); assert.equal(url.hash, '#journey'); assert.equal(url.origin, 'https://viewer.example');
});

void test('deployment carry retains both body views and selected body without transporting simulation state', () => {
  const earth = { source: 'local' as const, identity: 'immutable-private-genesis', body: 'earth' };
  const mars = { ...earth, body: 'mars' };
  let preferences = saveWorldView(DEFAULT_PREFERENCES, earth, { ...DEFAULT_WORLD_CAMERA, x: 8, selectedCity: 'town-3' });
  preferences = saveWorldView(preferences, mars, { ...DEFAULT_WORLD_CAMERA, z: -7, selectedCity: 'mars:2', selected: 2 });
  const current = { schemaVersion: 2 as const, version: '36', buildId: 'old', preparedAt: '2026-10-22T07:00:00Z' };
  const remote = { ...current, version: '37', buildId: 'new', preparedAt: '2026-10-22T09:00:00Z' };
  const plan = planDeploymentUpdate({ current, remote, url: 'https://viewer.example/?body=mars', now: Date.parse(remote.preparedAt), preferences: { ...preferences, state: { revision: 10 } }, stored: null });
  assert.ok(plan.carry); const restored = restoreDeploymentPreferences(remote.buildId, DEFAULT_PREFERENCES, plan.carry);
  assert.equal(restored.worldBody, 'mars'); assert.deepEqual(restored.worldViews, preferences.worldViews);
  assert.equal('state' in plan.carry.preferences, false); assert.doesNotMatch(plan.href ?? '', /immutable-private-genesis|town-3|mars%3A2/);
  assert.equal(createWorldViewSession().observe(restored, earth).preferences.x, 8);
  assert.equal(createWorldViewSession().observe(restored, mars).preferences.z, -7);
});

void test('body context is explicitly illustrative and never claims an unrecorded colony or local production', () => {
  const state = createWorld(1701); const before = structuredClone(state);
  assert.match(bodyViewDescription('earth', state), /recorded local development/);
  assert.match(bodyViewContext('mars', state), /No mission or colony records/);
  assert.match(bodyViewContext('mars', state), /Illustrative terrain/);
  assert.match(bodyViewDescription('mars', state), /visual context, not simulated geography, territory, ownership or resources/);
  assert.doesNotMatch(bodyViewContext('mars', state), /harvest|generat(?:es|ing)|owned territory/);
  assert.deepEqual(state, before);
});

void test('the actual body-switch handler only changes viewing, including for terminal worlds', () => {
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  const start = main.indexOf('function changeWorldBody('); const end = main.indexOf('\nfunction renderWorld(', start);
  assert.ok(start >= 0 && end > start);
  const source = stripTypeScriptTypes(main.slice(start, end));
  for (const worldSource of ['local', 'shared'] as const) for (const terminal of [false, true]) {
    const state = createWorld(1701);
    if (terminal) state.outcome = { kind: 'mars', winners: [0], round: state.round, reason: 'Synthetic terminal presentation fixture' };
    const before = structuredClone(state); const calls: string[] = [];
    const context = { worldBody: 'earth', worldSource, snapshot: { state }, mode: worldSource === 'local' ? 'local' : 'live', selectedRoute: 'old',
      savePreferences: () => calls.push('save'), quietCues: () => calls.push('quiet'), capabilityTree: { close: () => calls.push('close-tree') },
      setInspectionOpen: (open: boolean) => calls.push(`inspection:${open}`), inspectionCamera: { release: () => calls.push('release-camera') },
      observeWorldIdentity: () => calls.push('observe-identity'), projectWorld: (value: typeof state) => { assert.equal(value, state); return projectWorld(value); },
      renderWorld: () => calls.push('render'), renderConnection: () => calls.push('connection'),
      history: { state: null, replaceState: (_state: unknown, _unused: string, url: string) => calls.push(`url:${new URL(url).searchParams.get('body')}`) },
      window: { location: { href: `https://viewer.example/?world=${worldSource}` } }, worldBodyHref };
    runInNewContext(`${source}; changeWorldBody('mars'); changeWorldBody('mars');`, context);
    assert.equal(context.worldBody, 'mars'); assert.equal(context.selectedRoute, null);
    assert.equal(calls.filter(call => call === 'render').length, 1); assert.equal(calls.filter(call => call === 'save').length, 2);
    assert.ok(calls.includes('url:mars')); assert.deepEqual(state, before);
  }
});

void test('the actual capability input never projects Earth-only town work into a Mars body', () => {
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  const start = main.indexOf('function currentCapabilityInput('); const end = main.indexOf('\nfunction savePreferences(', start);
  assert.ok(start >= 0 && end > start);
  const source = stripTypeScriptTypes(main.slice(start, end));
  const state = createWorld(1701); const before = structuredClone(state); const calls: unknown[][] = [];
  const context = { worldBody: 'mars', mode: 'local', snapshot: { identity: 'immutable-world', state }, observedAt: 123,
    preferences: { selected: 0, selectedCity: state.cities[0]!.id }, catalogue: { marker: 'canonical' },
    projectCapabilities: (...args: unknown[]) => { calls.push(args); return { marker: 'exact-town' }; } };
  assert.equal(runInNewContext(`${source}; currentCapabilityInput();`, context), null);
  assert.equal(calls.length, 0);
  context.worldBody = 'earth';
  const result = runInNewContext(`${source}; currentCapabilityInput();`, context);
  assert.equal(result.runId, 'immutable-world'); assert.equal(result.civilizationName, state.civilizations[0]!.name);
  assert.equal(result.projection.marker, 'exact-town'); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [state, 0, state.cities[0]!.id, 123]); assert.deepEqual(state, before);
});

void test('compact body context counts only recorded sites and retains terminal flight and terrain truth in the accessible description', () => {
  const state = createWorld(1701);
  state.spaceflight = { ruleVersion: 1, civilizations: state.civilizations.map(() => ({ missionsLaunched: 0, activeMission: null, colony: null, lastDeparture: null, lastArrival: null, lastUpkeep: null, lastHabitatWork: null })) };
  const reserves = { food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 };
  state.spaceflight.civilizations[0]!.colony = { establishedRound: 10, stock: reserves, shortageRounds: 0 };
  state.spaceflight.civilizations[1]!.activeMission = { ruleVersion: 1, civId: 1, mission: 'settle', sourceCityId: state.cities[1]!.id, departureRound: 10, arrivalRound: 14, settlers: 3, launchCost: {}, cargo: {}, totalCost: {}, sourcePopulationBefore: 10, sourcePopulationAfter: 7, id: 'synthetic-flight', eventId: 'synthetic-departure', paid: {} };
  assert.equal(bodyViewContext('mars', state), 'Mars · 1 colony · 1 flight · Illustrative terrain');
  state.outcome = { kind: 'mars', winners: [0], round: 12, reason: 'Synthetic terminal presentation fixture' };
  const before = structuredClone(state);
  assert.equal(bodyViewContext('mars', state), 'Mars · 1 colony · 1 unfinished flight · Illustrative terrain');
  assert.match(bodyViewDescription('mars', state), /not invented local production/);
  assert.match(bodyViewDescription('mars', state), /no further arrivals will occur/);
  assert.doesNotMatch(bodyViewContext('mars', state), /arrives in|will arrive/);
  assert.deepEqual(state, before);
});

void test('actual body controls scope pressed state to buttons and update layout context before renderer construction', () => {
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  const start = main.indexOf('function renderBodyControls('); const end = main.indexOf('\nfunction renderWorld(', start);
  const source = stripTypeScriptTypes(main.slice(start, end));
  const nodes = new Map(['.observatory', '#body-context', '#body-context-description'].map(key => [key, { dataset: {} as Record<string, string>, textContent: '', hidden: false }]));
  const buttons = ['earth', 'mars'].map(body => ({ dataset: { body }, disabled: false, attributes: new Map<string, string>(), setAttribute(key: string, value: string) { this.attributes.set(key, value); } }));
  const state = createWorld(1701); const before = structuredClone(state);
  const context = { worldBody: 'earth', state, bodyViewContext, bodyViewDescription,
    element: (key: string) => { const node = nodes.get(key); assert.ok(node); return node; },
    document: { querySelectorAll: (selector: string) => { assert.equal(selector, '.body-switch [data-body]'); return buttons; } } };
  runInNewContext(`${source}; renderBodyControls(state);`, context);
  assert.equal(nodes.get('.observatory')!.dataset['body'], 'earth');
  assert.equal(nodes.get('#body-context')!.hidden, true);
  assert.equal(buttons[0]!.attributes.get('aria-pressed'), 'true');
  context.worldBody = 'mars';
  runInNewContext(`${source}; renderBodyControls(state);`, context);
  assert.equal(nodes.get('#body-context')!.hidden, false);
  assert.match(nodes.get('#body-context-description')!.textContent, /not simulated geography/);
  assert.equal(buttons[1]!.attributes.get('aria-pressed'), 'true');
  runInNewContext(`${source}; renderBodyControls(null);`, context);
  assert.ok(buttons.every(button => button.disabled));
  assert.equal(nodes.get('#body-context')!.textContent, '');
  assert.equal(nodes.get('#body-context')!.hidden, true);
  assert.deepEqual(state, before);
  assert.match(main.slice(end, end + 200), /renderBodyControls\(mode === 'sample'/);
  assert.match(main, /aria-describedby="body-context-description"/);
});

void test('short viewport styling collapses chronicle content without removing full Events access or floating status over body controls', () => {
  const css = readFileSync(new URL('../web/spectator-hud.css', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  const short = css.slice(css.indexOf('@media (max-width: 1000px) and (max-height: 570px)'));
  assert.match(css, /#app \.masthead \.mode \{ display: none; \}/);
  assert.doesNotMatch(css, /#app \.mode \{ position: absolute/);
  assert.match(short, /#app #major-event-list, #app #connection-story \{ display: none; \}/);
  assert.match(short, /max-height: 44px/);
  assert.doesNotMatch(short, /#app #events-open[^}]*display: none/);
  assert.match(main, /id="events-nav"[^>]*data-open-events/);
  assert.match(main, /class="world-calendar"/);
});
