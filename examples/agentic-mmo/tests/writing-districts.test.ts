import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyCommand, catchUpStrategy, legalActions } from '../core/engine.ts';
import { isWorldState } from '../core/validation.ts';
import type { GameAction, Resources, TransitionResult, WorldState } from '../core/types.ts';
import { coastalDeparturePrefix, coastalPrefixTime } from './fixtures/coastal-prefix.ts';

function accepted(result: TransitionResult): WorldState { assert.ok(result.ok, result.error); return result.state; }
function timestamp(state: WorldState, offset = 20): string { assert.ok(state.independentTurns); return coastalPrefixTime(state.independentTurns.strategyTicks * 60 + offset); }
function prior(): WorldState {
  return coastalDeparturePrefix('settlement-research-rate-1').state;
}
function act(state: WorldState, action: GameAction, offset = 20): TransitionResult { return applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: timestamp(state, offset), action }); }
function beat(state: WorldState): TransitionResult { assert.ok(state.independentTurns); return catchUpStrategy(state, coastalPrefixTime((state.independentTurns.strategyTicks + 1) * 60)); }

await test('prior productive release retains a legal unmodified prefix and has no Writing action', () => {
  const state = prior();
  assert.equal(state.releaseId, 'settlement-research-rate-1');
  assert.ok(!legalActions(state, 0, timestamp(state)).some(option => option.action.type === 'research' && option.action.technology === 'writing'));
  const before = JSON.stringify(state);
  assert.equal(act(state, { type: 'research', technology: 'writing' }).ok, false);
  assert.equal(JSON.stringify(state), before);
  assert.ok(beat(state).ok);
});

function learnWriting(): WorldState {
  let state = accepted(act(coastalDeparturePrefix('settlement-writing-1').state, { type: 'research', technology: 'writing' }));
  for (let count = 0; count < 40 && !state.civilizations[0]?.technologies.includes('writing'); count++) state = accepted(beat(state));
  assert.ok(state.civilizations[0]?.technologies.includes('writing'));
  return state;
}
function campus(tileId: number, cityId = 'city-0') { return { type: 'build', project: 'campus', cityId, tileId } as const; }
function completedCampus(tileId = 39): WorldState {
  let state = accepted(act(learnWriting(), campus(tileId)));
  for (let count = 0; count < 24 && !state.cities.find(city => city.id === 'city-0')?.buildings.includes('campus'); count++) state = accepted(beat(state));
  assert.ok(state.cities.find(city => city.id === 'city-0')?.buildings.includes('campus'));
  return state;
}
function unchangedRefusal(state: WorldState, action: GameAction): void {
  const before = JSON.stringify(state);
  const result = act(state, action, 40);
  assert.equal(result.ok, false);
  assert.equal(JSON.stringify(result.state), before);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(result.events, []);
}

await test('district action shape preserves an exact safe tile and rejects malformed paired fields', async () => {
  const { isGameAction } = await import('../core/planning.ts');
  assert.equal(isGameAction(campus(39)), true);
  for (const tileId of [-1, 0.5, NaN, '39', null]) assert.equal(isGameAction({ ...campus(39), tileId }), false);
  assert.equal(isGameAction({ type: 'build', project: 'campus', tileId: 39 }), false);
  assert.equal(isGameAction({ type: 'build', project: 'farm' }), true);
});

await test('legal Writing completion exposes every exact capital site and leaves Library blocked', () => {
  const state = learnWriting();
  const options = legalActions(state, 0, timestamp(state));
  const sites = options.filter(option => option.action.type === 'build' && option.action.project === 'campus' && option.action.cityId === 'city-0');
  assert.deepEqual(sites.map(option => 'tileId' in option.action ? option.action.tileId : null).toSorted((a, b) => Number(a) - Number(b)), [39, 40, 56, 58, 74, 75]);
  assert.ok(!options.some(option => option.action.type === 'build' && option.action.project === 'library'));
  assert.match(sites.find(option => 'tileId' in option.action && option.action.tileId === 39)?.reason ?? '', /science|Science/);
});

await test('Campus locks the exact site and pays once while using the existing single lane', () => {
  const before = learnWriting();
  const state = accepted(act(before, campus(39)));
  const city = state.cities.find(value => value.id === 'city-0'); assert.ok(city?.construction?.active);
  assert.ok(!('kind' in city.construction.active));
  assert.equal(city.construction.active.buildingId, 'campus');
  assert.equal('tileId' in city.construction.active ? city.construction.active.tileId : null, 39);
  assert.equal(city.construction.active.workRequired, 8);
  assert.deepEqual(city.construction.active.paid, { materials: 16, credits: 8 });
  assert.equal(state.civilizations[0]?.resources.materials, (before.civilizations[0]?.resources.materials ?? 0) - 16);
  assert.equal(state.civilizations[0]?.resources.credits, (before.civilizations[0]?.resources.credits ?? 0) - 8);
  assert.deepEqual(state.tiles, before.tiles);
  assert.ok(!city.buildings.includes('campus'));
  unchangedRefusal(state, campus(56));
  unchangedRefusal(state, { type: 'build', project: 'farm', cityId: 'city-0' });
});

await test('district invalid and missing exact targets refuse without retargeting or payment', () => {
  const state = learnWriting();
  for (const tileId of [57, 48, 0, 1, 9999]) unchangedRefusal(state, campus(tileId));
  unchangedRefusal(state, campus(39, 'missing'));
  unchangedRefusal(state, campus(39, 'city-1'));
  unchangedRefusal(state, { type: 'build', project: 'campus', cityId: 'city-0' });
  unchangedRefusal(state, { type: 'build', project: 'farm', cityId: 'city-0', tileId: 39 });
});

await test('completed Campus retains exact site and only unlocks its own town Library', () => {
  const state = completedCampus();
  const city = state.cities.find(value => value.id === 'city-0'); assert.ok(city?.construction?.lastCompleted);
  assert.deepEqual('districtSites' in city ? city.districtSites : undefined, { campus: 39 });
  assert.equal('tileId' in city.construction.lastCompleted ? city.construction.lastCompleted.tileId : null, 39);
  assert.ok(legalActions(state, 0, timestamp(state)).some(option => option.action.type === 'build' && option.action.project === 'library' && option.action.cityId === 'city-0'));
  unchangedRefusal(state, campus(56));
  const other = state.cities.find(value => value.civId === 0 && value.id !== 'city-0'); assert.ok(other);
  unchangedRefusal(state, { type: 'build', project: 'library', cityId: other.id });
});

await test('real mountain adjacency distinguishes retained sites and completion never produces retroactively', () => {
  const before = learnWriting();
  let near = accepted(act(before, campus(39)));
  let plain = accepted(act(before, campus(56)));
  for (let count = 0; count < 24 && !near.cities[0]?.buildings.includes('campus'); count++) {
    near = accepted(beat(near)); plain = accepted(beat(plain));
    assert.deepEqual(near.civilizations[0]?.resources, plain.civilizations[0]?.resources);
  }
  assert.ok(near.cities[0]?.buildings.includes('campus'));
  const nearNext = accepted(beat(near)); const plainNext = accepted(beat(plain));
  assert.ok((nearNext.civilizations[0]?.resources.science ?? 0) > (plainNext.civilizations[0]?.resources.science ?? 0));
  assert.deepEqual(near.tiles, before.tiles);
  assert.deepEqual(plain.tiles, before.tiles);
});

await test('Library completes through the same lane and only later uses opening credits and local residents', () => {
  let state = completedCampus();
  state = accepted(act(state, { type: 'build', project: 'library', cityId: 'city-0' }));
  const order = structuredClone(state.cities[0]?.construction?.active); assert.ok(order);
  assert.equal(order.tileId, undefined);
  for (let count = 0; count < 24 && !state.cities[0]?.buildings.includes('library'); count++) state = accepted(beat(state));
  const city = state.cities[0]; assert.ok(city); assert.ok(city.buildings.includes('library'));
  assert.equal(city.buildingOperations?.library?.lastResult, null);
  assert.equal(city.construction?.lastCompleted?.orderId, order.id);
  const operated = accepted(beat(state));
  const result = operated.cities[0]?.buildingOperations?.library?.lastResult;
  assert.equal(result?.status, 'operated');
  assert.deepEqual(result.paid, { credits: 1 });
  assert.equal(result.residents?.allocated, 3);
  assert.ok((result.produced.science ?? 0) > 0);
  const paused = accepted(act(operated, { type: 'set-building-operation', cityId: 'city-0', buildingId: 'library', enabled: false }));
  const pauseBeat = accepted(beat(paused));
  assert.equal(pauseBeat.cities[0]?.buildingOperations?.library?.lastResult?.status, 'paused');
  assert.deepEqual(pauseBeat.cities[0]?.buildingOperations?.library?.lastResult?.paid, {});
});

await test('synthetic capacity and resource scarcity leave Library inputs atomic after a legal completion', () => {
  let state = completedCampus();
  state = accepted(act(state, { type: 'build', project: 'library', cityId: 'city-0' }));
  for (let count = 0; count < 24 && !state.cities[0]?.buildings.includes('library'); count++) state = accepted(beat(state));
  for (const resourceLimited of [false, true]) {
    const probe = structuredClone(state); assert.ok(probe.cities[0] && probe.civilizations[0]);
    if (resourceLimited) probe.civilizations[0].resources.credits = 0;
    else probe.cities[0].population = 3;
    const result = accepted(beat(probe)).cities[0]?.buildingOperations?.library?.lastResult;
    assert.equal(result?.status, 'blocked'); assert.deepEqual(result.paid, {}); assert.deepEqual(result.produced, {});
    assert.equal(result.residents?.allocated, 0);
  }
});

await test('synthetic global reservations, capacity and changed ownership refuse exact sites without fallback', async () => {
  const { districtSiteOccupied, availableDistrictSites } = await import('../core/simulation/districts.ts');
  const { BUILDINGS } = await import('../core/content.ts');
  const state = learnWriting(); const building = BUILDINGS.find(value => value.id === 'campus'); assert.ok(building);
  const other = state.cities.find(city => city.id !== 'city-0'); assert.ok(other);
  other.districtSites = { campus: 39 };
  assert.equal(districtSiteOccupied(state, 39), true); unchangedRefusal(state, campus(39));
  const city = state.cities[0]; assert.ok(city);
  city.population = 3; city.districtSites = { synthetic: 56 };
  assert.deepEqual(availableDistrictSites(state, city, building), []);
  unchangedRefusal(state, campus(40));
});

await test('exact district plan head cannot substitute another site and projection exposes canonical facts detached', async () => {
  const { validateAttachedPlan } = await import('../core/planning.ts');
  const { projectCapabilities, capabilityCatalogue } = await import('../core/capabilities.ts');
  const state = learnWriting();
  const command = { seat: 0, expectedRevision: state.revision, action: campus(39) };
  assert.equal(validateAttachedPlan(state, command, [{ action: campus(56), reason: 'Use the other site' }]).ok, false);
  assert.equal(validateAttachedPlan(state, command, [{ action: campus(39), reason: 'Use real mountain adjacency' }]).ok, true);
  const projection = projectCapabilities(state, 0, 'city-0', timestamp(state));
  const facts = projection.buildings.find(row => row.nodeId === 'building:campus')?.district; assert.ok(facts);
  assert.deepEqual(facts.availableSites.find(site => site.tileId === 39)?.baseProduction, { science: 2 });
  assert.deepEqual(facts.availableSites.find(site => site.tileId === 56)?.baseProduction, { science: 1 });
  assert.ok(capabilityCatalogue().edges.some(edge => edge.from === 'building:campus' && edge.to === 'building:library'));
  facts.availableSites.length = 0;
  assert.equal(projectCapabilities(state, 0, 'city-0', timestamp(state)).buildings.find(row => row.nodeId === 'building:campus')?.district?.availableSites.length, 6);
});

await test('complete legal Writing Campus Library trajectory replays every exact JSON input and preserves prior frames', () => {
  const prefix = coastalDeparturePrefix('settlement-writing-1');
  let state = prefix.state;
  let frames = 0;
  const commit = (transition: (world: WorldState) => TransitionResult): void => {
    const before = JSON.stringify(state);
    const result = transition(state);
    assert.equal(result.ok, true, result.error);
    assert.equal(JSON.stringify(state), before);
    const decoded: unknown = JSON.parse(before); assert.ok(isWorldState(decoded));
    const replay = transition(decoded);
    assert.deepEqual(replay, result);
    const next: unknown = JSON.parse(JSON.stringify(result.state)); assert.ok(isWorldState(next));
    state = next;
    frames++;
  };
  const action = (value: GameAction): void => {
    const command = { seat: 0, expectedRevision: state.revision, timestamp: timestamp(state), action: value };
    assert.ok(legalActions(state, 0, command.timestamp).some(option => JSON.stringify(option.action) === JSON.stringify(value)));
    commit(world => applyCommand(world, command));
  };
  const nextBeat = (): void => { assert.ok(state.independentTurns); const time = coastalPrefixTime((state.independentTurns.strategyTicks + 1) * 60); commit(world => catchUpStrategy(world, time)); };
  action({ type: 'research', technology: 'writing' });
  for (let count = 0; count < 40 && !state.civilizations[0]?.technologies.includes('writing'); count++) nextBeat();
  action(campus(39));
  for (let count = 0; count < 24 && !state.cities[0]?.buildings.includes('campus'); count++) nextBeat();
  action({ type: 'build', project: 'library', cityId: 'city-0' });
  for (let count = 0; count < 24 && !state.cities[0]?.buildings.includes('library'); count++) nextBeat();
  nextBeat();
  assert.equal(state.cities[0]?.buildingOperations?.library?.lastResult?.status, 'operated');
  assert.deepEqual(state.tiles, prefix.state.tiles);
  assert.ok(frames > 10);
});

await test('synthetic lost site ownership invalidates a retained exact plan rather than redirecting it', async () => {
  const { completeAttachedPlan, observeActionPlan } = await import('../core/planning.ts');
  const state = learnWriting();
  const command = { seat: 0, expectedRevision: state.revision, action: { type: 'focus', cityId: 'city-0', focus: 'industry' } as const };
  const plan = completeAttachedPlan([{ action: command.action, reason: 'Prepare work' }, { action: campus(39), reason: 'Use mountain adjacency' }], state.revision, state.revision + 1);
  assert.ok(plan);
  const altered = structuredClone(state); altered.revision++;
  const site = altered.tiles.find(tile => tile.id === 39); assert.ok(site); site.owner = 1;
  const observed = observeActionPlan(altered, 0, plan, timestamp(altered));
  assert.equal(observed.items[1]?.status, 'invalidated');
  assert.deepEqual(observed.items[1]?.action, campus(39));
  unchangedRefusal(altered, campus(39));
});

await test('actual Campus science enters aggregate productivity exactly once', async () => {
  const { ECONOMY_RULES, BUILDINGS } = await import('../core/content.ts');
  const { cityProductivity } = await import('../core/simulation/world.ts');
  const { siteProduction } = await import('../core/simulation/sites.ts');
  const state = completedCampus(39);
  const expected = state.cities.filter(city => city.civId === 0).reduce((total, city) => {
    const site = state.tiles.find(tile => tile.id === city.tileId); assert.ok(site);
    const ordinary = city.buildings.filter(id => id !== 'campus').reduce((sum, id) => sum + (BUILDINGS.find(building => building.id === id)?.production.science ?? 0), 0);
    const focus: Partial<Resources> = ECONOMY_RULES.focusProduction[city.focus];
    const raw = ECONOMY_RULES.baseProduction.science + (focus.science ?? 0) + (siteProduction(state, site).science ?? 0) + ordinary + (city.buildings.includes('campus') ? 2 : 0);
    return total + Math.round(raw * cityProductivity(city) * 100) / 100;
  }, 0);
  const result = beat(state); assert.ok(result.ok);
  const production = result.events.find(event => event.type === 'settlement-production' && event.actor === 0); assert.ok(production);
  assert.ok(production.effects.includes(`Produced ${Math.round(expected * 100) / 100} science`));
});

await test('synthetic district occupancy gates both shared founding paths without changing historical site rules', async () => {
  const { foundingSiteEligible } = await import('../core/simulation/coastal.ts');
  const state = learnWriting(); const site = state.tiles.find(tile => tile.id === 26); assert.ok(site);
  assert.equal(foundingSiteEligible(state, site), true);
  const city = state.cities[0]; assert.ok(city); city.districtSites = { campus: 26 };
  assert.equal(foundingSiteEligible(state, site), false);
  state.unlockedFeatures = state.unlockedFeatures.filter(feature => feature !== 'district-planning');
  assert.equal(foundingSiteEligible(state, site), true);
});

await test('active and completed district projection exposes retained site potential separately from operation receipts', async () => {
  const { projectCapabilities } = await import('../core/capabilities.ts');
  const active = accepted(act(learnWriting(), campus(39)));
  const completed = completedCampus(39);
  for (const state of [active, completed]) {
    const row = projectCapabilities(state, 0, 'city-0', timestamp(state)).buildings.find(value => value.nodeId === 'building:campus');
    assert.equal(row?.district?.siteId, 39);
    assert.deepEqual(row?.district?.siteBaseProduction, { science: 2 });
    assert.deepEqual(row?.district?.availableSites, []);
    assert.equal(row?.operation, undefined);
  }
});
