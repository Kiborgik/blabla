import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyRelease, createWorld } from '../core/engine.ts';
import { BUILDINGS, PUBLIC_PROJECT_RECIPES, TECHNOLOGIES } from '../core/content.ts';
import { RELEASES } from '../core/release.ts';
import { executeAction, applyDirectorEvent } from '../core/simulation/commands.ts';
import { installBuilding } from '../core/simulation/construction.ts';
import { completeResearch } from '../core/simulation/research.ts';
import { executeTradeAction, resolveTrade } from '../core/simulation/trade.ts';
import { executePublicProjectAction, resolvePublicProjects } from '../core/simulation/public-projects.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import type { GameEvent, WorldState } from '../core/types.ts';
import { eventLogEntries } from '../web/event-log.ts';
import { storyLanguage } from '../web/story-language.ts';
import { spectatorChronicle } from '../web/spectator-hud.ts';

const epoch = '2026-10-16T00:00:00.000Z';
let baseline: WorldState | undefined;
function world(): WorldState {
  if (!baseline) {
    baseline = createWorld(1701, epoch);
    for (const release of RELEASES) {
      if (!release.compatibleFrom.includes(baseline.releaseId)) continue;
      const next = applyRelease(baseline, { expectedRevision: baseline.revision, expectedFromReleaseId: baseline.releaseId, targetReleaseId: release.id, timestamp: epoch });
      assert.ok(next.ok, next.error); baseline = next.state;
    }
  }
  return structuredClone(baseline);
}
function language(state: WorldState, event: GameEvent) {
  const row = eventLogEntries([event], { civilizations: state.civilizations })[0]; assert.ok(row);
  const before = structuredClone({ state, event, row });
  const result = storyLanguage(state, event, row);
  assert.deepEqual({ state, event, row }, before);
  return result;
}
function record(events: GameEvent[], type: string): GameEvent {
  const event = events.findLast(item => item.type === type); assert.ok(event, type); return event;
}
function trade() {
  const state = world(); const events: GameEvent[] = [];
  executeTradeAction(state, 0, { type: 'propose-trade', partner: 1, recipeId: 'harvest-for-materials', sourceCityId: 'city-0', recipientCityId: 'city-1' }, events);
  const offer = state.tradeOffers?.at(-1); assert.ok(offer);
  executeTradeAction(state, 1, { type: 'respond-trade', offerId: offer.id, accept: true }, events);
  const route = state.routes.at(-1); assert.ok(route?.agreement);
  return { state, events, offer, route };
}

void test('real trade phases read as offers, agreement, historical blockage and delivered cargo without current-route inference', () => {
  const { state, events, route, offer } = trade();
  const proposal = record(events, 'trade-proposed'); const accepted = record(events, 'trade-accepted');
  assert.equal(proposal.detail, offer.id);
  assert.match(language(state, proposal).title, new RegExp(state.civilizations[0]!.name));
  assert.match(language(state, proposal).consequence, /Agreement was still needed.*No cargo delivered/);
  assert.doesNotMatch(JSON.stringify(language(state, proposal)), /offer-|route-|immutable|Recipe/);
  assert.match(language(state, accepted).consequence, /No cargo delivered.*round/);
  state.round = route.agreement!.nextDeliveryRound;
  state.civilizations[0]!.resources.food = 0;
  resolveTrade(state, events);
  const blocked = record(events, 'trade-blocked');
  state.civilizations[0]!.resources.food = 100;
  state.round = route.agreement!.nextDeliveryRound;
  resolveTrade(state, events);
  const delivered = record(events, 'trade-delivered');
  const blockage = language(state, blocked);
  assert.match(blockage.cause, /Food.*0.*needed then/);
  assert.match(blockage.consequence, /No cargo delivered/);
  assert.doesNotMatch(blockage.cause, /currently|still short/);
  const delivery = language(state, delivered);
  const total = delivered.effects[0]!.split(' ')[0];
  assert.match(delivery.consequence, new RegExp(`${total} cargo exchanged`));
  state.routes = []; state.tradeOffers = []; state.events = [];
  assert.deepEqual(language(state, delivered), delivery);
  assert.deepEqual(language(state, blocked), blockage);
});

void test('real joint repair results use exact recorded outcomes, damage and paid contributions after projects are pruned', () => {
  for (const outcome of ['completed', 'failed', 'no-work-needed'] as const) {
    const { state, events, route } = trade();
    const recipe = PUBLIC_PROJECT_RECIPES[0]; assert.ok(recipe);
    for (const id of [0, 1]) {
      state.civilizations[id]!.technologies.push(recipe.requiredTechnology);
      state.cities.find(city => city.civId === id)!.buildings.push(recipe.requiredBuilding);
      for (const resource of ['materials', 'energy', 'credits'] as const) state.civilizations[id]!.resources[resource] = 100;
    }
    route.damage = 42.75;
    executePublicProjectAction(state, 0, { type: 'propose-public-project', routeId: route.id, recipeId: recipe.id }, events);
    const project = state.publicProjects?.[0]; assert.ok(project);
    executePublicProjectAction(state, 1, { type: 'respond-public-project', projectId: project.id, accept: true }, events);
    const committed = state.publicProjects?.[0]; assert.ok(committed?.status === 'committed');
    assert.match(language(state, record(events, 'public-project-committed')).consequence, /No supplies paid.*No repair or cargo/);
    state.round = committed.dueRound;
    if (outcome === 'failed') state.civilizations[0]!.resources.materials = 0;
    if (outcome === 'no-work-needed') route.damage = 0;
    resolvePublicProjects(state, events);
    const event = record(events, `public-project-${outcome}`); const receipt = event.publicProjectResult; assert.ok(receipt);
    event.effects.push('Route damage 999 → 0', 'Proposer paid: materials 999');
    const display = language(state, event);
    assert.match(display.consequence, /No cargo delivered/);
    assert.doesNotMatch(display.consequence, /999/);
    assert.ok(display.consequence.includes(`${receipt.damageBefore} → ${receipt.damageAfter}`));
    if (outcome === 'completed') assert.match(display.consequence, /paid.*Materials/);
    else assert.match(display.consequence, /No supplies paid/);
    if (outcome === 'failed') assert.match(display.cause, /needed then/);
    if (outcome === 'no-work-needed') assert.match(display.cause, /already repaired then/);
    state.routes = []; state.publicProjects = []; state.events = [];
    assert.deepEqual(language(state, event), display);
    const noDamage = structuredClone(event); noDamage.publicProjectResult!.damageBefore = null; noDamage.publicProjectResult!.damageAfter = null;
    assert.match(language(state, noDamage).consequence, /Damage was not recorded/);
  }
});

void test('a real coastal storm and later town repair retain distinct local consequences without inventing a causal link', () => {
  const state = world(); const city = state.cities[0]!;
  const site = state.tiles.find(tile => tile.id === city.tileId)!;
  const shore = state.tiles.find(tile => hexDistance(site, tile) === 1 && !state.cities.some(town => town.tileId === tile.id)); assert.ok(shore);
  shore.terrain = 'ocean';
  const events: GameEvent[] = [];
  applyDirectorEvent(state, 'coastal-storm', city.civId, events);
  executeAction(state, city.civId, { type: 'repair-city', cityId: city.id }, events);
  const storm = record(events, 'coastal-storm'); const repair = record(events, 'city-repaired');
  const stormText = language(state, storm); const repairText = language(state, repair);
  assert.match(stormText.title, new RegExp(city.name));
  assert.match(stormText.cause, /coast/);
  assert.match(stormText.consequence, /Damage 0 → 18/);
  assert.match(stormText.consequence, /Wellbeing/);
  assert.match(repairText.consequence, /Damage 18 → 0/);
  assert.match(repairText.consequence, /Materials/);
  assert.doesNotMatch(repairText.cause, /storm|cargo/);
  state.cities = state.cities.filter(town => town.id !== city.id);
  state.cities[0]!.tileId = city.tileId;
  const unknown = language(state, storm);
  assert.doesNotMatch(unknown.title + unknown.cause, new RegExp(state.cities[0]!.name));
  assert.match(unknown.title, /recorded town/i);
  assert.match(unknown.consequence, /Damage 0 → 18/);
});

void test('regional gathering and migration keep real shared-stock changes and do not become cargo or population growth', () => {
  const { state, events, route } = trade();
  state.round = route.agreement!.nextDeliveryRound; resolveTrade(state, events);
  applyDirectorEvent(state, 'trade-fair', 0, events);
  const fair = language(state, record(events, 'trade-fair'));
  assert.match(fair.cause, /earlier delivery/);
  assert.match(fair.consequence, /Food.*Materials.*Credits.*Culture/);
  assert.match(fair.consequence, /No new shipment/);
  state.directorCooldown = 0;
  const source = state.cities[0]!; source.damage = 40; source.population = 6;
  const site = state.tiles.find(tile => tile.owner === 0 && tile.id !== source.tileId && tile.terrain !== 'ocean' && tile.terrain !== 'mountain'); assert.ok(site);
  state.cities.push({ ...structuredClone(source), id: 'city-destination', name: 'Safe Harbour', tileId: site.id, damage: 0, wellbeing: 70, population: 2, housing: { ruleVersion: 1, baseCapacity: 6, establishedRound: 0, origin: 'founded' } });
  applyDirectorEvent(state, 'internal-migration', 0, events);
  const move = language(state, record(events, 'internal-migration'));
  assert.match(move.cause, /Safe Harbour/);
  assert.match(move.consequence, /People 6 → 4.*People 2 → 4/);
  assert.match(move.consequence, /No new residents/);
});

void test('real founding, discovery and construction explain what changed without turning capacity into goods', () => {
  const state = world(); const events: GameEvent[] = [];
  const source = state.cities[0]!;
  const site = state.tiles.find(tile => tile.owner === 0 && tile.id !== source.tileId && tile.terrain !== 'ocean' && tile.terrain !== 'mountain'); assert.ok(site);
  executeAction(state, 0, { type: 'settle', tileId: site.id, sourceCityId: source.id }, events);
  const founded = language(state, record(events, 'settlement-founded'));
  assert.match(founded.cause, new RegExp(source.name));
  assert.match(founded.consequence, /residents/);
  assert.doesNotMatch(JSON.stringify(founded), /city-|released expansion/);
  const tech = TECHNOLOGIES.find(item => item.id === 'agriculture')!;
  completeResearch(state, 0, tech, events);
  const discovery = language(state, record(events, 'research-completed'));
  assert.match(discovery.title, new RegExp(tech.name)); assert.match(discovery.cause, /Science/);
  const farm = BUILDINGS.find(item => item.id === 'farm')!;
  installBuilding(state, source, farm, events);
  const built = language(state, record(events, 'building-completed'));
  assert.match(built.title, new RegExp(farm.name)); assert.match(built.consequence, /capacity.*not goods made/);
  state.civilizations[0]!.resources.food = 999;
  assert.doesNotMatch(language(state, record(events, 'building-completed')).consequence, /999/);
});

void test('foundation prose uses recorded counts, not later state, and keeps the native raw EventLogEntry unchanged', () => {
  const state = createWorld(1701, epoch); const original = state.events[0]!;
  state.cities = []; state.civilizations = [];
  const before = structuredClone(state);
  const story = spectatorChronicle(state)[0]; assert.ok(story);
  assert.match(story.display.consequence, /5 civilizations.*5/);
  assert.doesNotMatch(story.display.cause, /seed|release|version/i);
  assert.deepEqual(story.event, eventLogEntries([original], { civilizations: [] })[0]);
  assert.equal(story.event.cause, original.cause); assert.deepEqual(story.event.effects, original.effects);
  assert.deepEqual(state, before);
});

void test('old sparse records, unknown identities and unrelated typed receipts have bounded honest fallbacks', () => {
  const state = world();
  const old: GameEvent = { id: 'old', round: 1, type: 'city-repaired', title: 'A town repaired damage', detail: 'Only city-removed was repaired using shared civilization supplies', actor: 98, target: 98, tileId: state.cities[0]!.tileId, cause: '', effects: [], importance: 3 };
  const display = language(state, old);
  assert.match(display.title, /recorded town/i);
  assert.doesNotMatch(JSON.stringify(display), new RegExp(state.cities[0]!.name));
  assert.match(display.consequence, /Details/);
  const coastal = { ...old, type: 'coastal-founded', coastalFounding: { ruleVersion: 1 as const, sourceCityId: state.cities[0]!.id, sourceTileId: 0, destinationTileId: 1, pathTileIds: [0, 1], population: 999, paid: {}, foundedRound: 1, eventId: 'unrelated' } };
  assert.doesNotMatch(JSON.stringify(language(state, coastal)), /999/);
  const future = { ...old, type: 'future-event', cause: 'city-removed '.repeat(80), effects: ['A future consequence'] };
  const fallback = language(state, future);
  assert.ok(fallback.cause.length <= 180); assert.doesNotMatch(fallback.cause, /city-removed/);
  assert.equal(fallback.consequence, 'A future consequence');
});

void test('regional harvest fire and industrial injury explain committed causes without consulting current eligibility', () => {
  for (const type of ['cultivated-harvest', 'forest-fire', 'industrial-accident'] as const) {
    const state = world(); const city = state.cities[0]!; const events: GameEvent[] = [];
    const site = state.tiles.find(tile => tile.id === city.tileId)!;
    if (type === 'cultivated-harvest') { city.buildings.push('farm'); site.terrain = 'grassland'; }
    if (type === 'forest-fire') {
      const tree = state.tiles.find(tile => hexDistance(site, tile) === 1 && !state.cities.some(town => town.tileId === tile.id)); assert.ok(tree); tree.terrain = 'forest';
    }
    if (type === 'industrial-accident') {
      state.civilizations[0]!.era = 2; city.buildings.push('guild-workshop');
      city.buildingOperations = { 'guild-workshop': { enabled: true, lastResult: { round: state.round, status: 'operated', paid: { energy: 1 }, produced: { materials: 2 }, shortages: [] } } };
    }
    applyDirectorEvent(state, type, 0, events);
    const committed = record(events, type); const display = language(state, committed);
    assert.match(display.title, new RegExp(city.name));
    assert.doesNotMatch(display.cause, /city-|guild-workshop|tile|current round/);
    assert.match(display.consequence, /Materials/);
    city.buildings = []; city.buildingOperations = {}; site.terrain = 'desert'; city.damage = 0;
    assert.deepEqual(language(state, committed), display);
  }
});

void test('coastal receipt supplies exact departure and paid founding facts only for its own event', () => {
  const state = world(); const source = state.cities[0]!;
  const committed: GameEvent = { id: 'coastal-record', round: 3, type: 'coastal-founded', title: 'New Shore is founded by a coastal expedition', detail: `From ${source.id} along 1 → 2 → 3`, actor: 0, target: 0, tileId: 3, cause: 'Navigation and an installed coastal departure capability enabled an exact conserved founding', effects: [], importance: 4,
    coastalFounding: { ruleVersion: 1, sourceCityId: source.id, sourceTileId: 1, destinationTileId: 3, pathTileIds: [1, 2, 3], population: 2, paid: { food: 3.125, materials: 7.25 }, foundedRound: 3, eventId: 'coastal-record' } };
  const display = language(state, committed);
  assert.match(display.cause, new RegExp(`2 residents moved from ${source.name} by sea`));
  assert.match(display.consequence, /3.125 Food, 7.25 Materials/);
  state.cities = []; assert.match(language(state, committed).cause, /recorded town/);
  assert.doesNotMatch(language(state, { ...committed, round: 4 }).consequence, /3.125|7.25/);
});
