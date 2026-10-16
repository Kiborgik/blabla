import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, CONSTRUCTION_RULES, TECHNOLOGIES } from '../core/content.ts';
import { applyCommand, catchUpStrategy, legalActions } from '../core/engine.ts';
import { projectCapabilities } from '../core/capabilities.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import { RELEASES } from '../core/release.ts';
import { isWorldState } from '../core/validation.ts';
import { buildingBaseProduction, districtAdjacencyFacts } from '../core/simulation/districts.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { sameAction } from '../core/simulation/choices.ts';
import type { GameAction, WorldState } from '../core/types.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixInput, type CoastalPrefixStep } from './fixtures/coastal-prefix.ts';
import { learningCommerceJourney } from './learning-commerce.test.ts';

function stocks(state: WorldState) {
  const civilization = state.civilizations[0]; assert.ok(civilization); return civilization.resources;
}

export function manufacturingJourney() {
  const target = RELEASES.find(release => release.compatibleFrom.includes('settlement-metal-learning-1') && release.featureIds.includes('manufacturing'));
  assert.ok(target, 'A compatible implemented manufacturing release must exist');
  const previous = learningCommerceJourney().journey;
  previous.research(0, 'bronze-working');
  let state = structuredClone(previous.state);
  const beforeRelease = structuredClone(state);
  const steps: CoastalPrefixStep[] = [];
  const time = (): string => coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ((state.independentTurns?.lastActionWindow[0] ?? -1) + 1) * 10));
  const commit = (input: CoastalPrefixInput): void => {
    const before = structuredClone(state);
    const result = replayCoastalStep(state, input);
    assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.ok(isWorldState(result.state));
    steps.push({ input, before, result }); state = result.state;
  };
  const act = (action: GameAction): void => {
    assert.ok(legalActions(state, 0, time()).some(option => sameAction(option.action, action)), JSON.stringify(action));
    commit({ kind: 'action', command: { seat: 0, expectedRevision: state.revision, timestamp: time(), action } });
  };
  const beat = (): void => commit({ kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) });
  const until = (condition: () => boolean): void => {
    for (let count = 0; count < 120 && !condition(); count++) beat();
    assert.ok(condition());
  };
  const research = (technology: string): void => { act({ type: 'research', technology }); until(() => !!state.civilizations[0]?.technologies.includes(technology)); };
  commit({ kind: 'release', command: { expectedRevision: state.revision, expectedFromReleaseId: state.releaseId, targetReleaseId: target.id, timestamp: time() } });
  return { previous, beforeRelease, get state() { return state; }, steps, time, act, beat, until, research };
}

export function manufacturingOperationJourney() {
  const journey = manufacturingJourney();
  const adopted = structuredClone(journey.state);
  journey.research('iron-working'); journey.research('apprenticeship');
  const researched = structuredClone(journey.state);
  const option = legalActions(journey.state, 0, journey.time()).find(candidate => candidate.action.type === 'build' && candidate.action.project === 'industrial-zone' && candidate.action.cityId === 'city-0'); assert.ok(option);
  journey.act(option.action);
  const zoneActive = structuredClone(journey.state);
  journey.until(() => !journey.state.cities[0]?.construction?.active);
  const zoneCompleted = structuredClone(journey.state);
  journey.act({ type: 'build', cityId: 'city-0', project: 'guild-workshop' });
  const workshopActive = structuredClone(journey.state);
  journey.until(() => !journey.state.cities[0]?.construction?.active);
  const workshopCompleted = structuredClone(journey.state);
  journey.beat();
  const operated = structuredClone(journey.state);
  return { journey, adopted, researched, zoneActive, zoneCompleted, workshopActive, workshopCompleted, operated };
}

await test('manufacturing preserves exact accepted discovery and productive institution data', () => {
  const iron = TECHNOLOGIES.find(item => item.id === 'iron-working'); assert.ok(iron, 'Iron working must be an actual discovery');
  assert.equal(iron.cost, 144); assert.deepEqual(iron.requires, ['bronze-working']);
  const apprenticeship = TECHNOLOGIES.find(item => item.id === 'apprenticeship'); assert.ok(apprenticeship);
  assert.equal(apprenticeship.cost, 204); assert.deepEqual([...apprenticeship.requires].toSorted(), ['currency', 'iron-working']);
  const zone = BUILDINGS.find(item => item.id === 'industrial-zone'); assert.ok(zone?.district);
  assert.deepEqual(zone.cost, { materials: 24, credits: 12 }); assert.equal(zone.minEra, 1); assert.deepEqual(zone.production, { materials: 2 });
  const workshop = BUILDINGS.find(item => item.id === 'guild-workshop'); assert.ok(workshop);
  assert.deepEqual(workshop.cost, { materials: 26, credits: 12 }); assert.ok(workshop.requiresBuildings?.includes('industrial-zone'));
  const work: Readonly<Record<string, number>> = CONSTRUCTION_RULES.requiredWork;
  assert.equal(work['industrial-zone'], 12); assert.equal(work['guild-workshop'], 12);
  assert.deepEqual(workshop.operatingInputs, { energy: 2 }); assert.deepEqual(workshop.production, { materials: 6 });
});

await test('manufacturing prior release refuses future choices without payment or retargeting', () => {
  const previous = learningCommerceJourney().journey;
  const state = previous.state;
  for (const action of [{ type: 'research', technology: 'iron-working' }, { type: 'build', cityId: 'city-0', project: 'industrial-zone', tileId: 75 }, { type: 'build', cityId: 'city-0', project: 'guild-workshop' }] as const) {
    const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: previous.time(), action });
    assert.equal(result.ok, false); assert.deepEqual(result.state, state); assert.deepEqual(result.events, []);
  }
});

await test('manufacturing actual research opens exact Mine-adjacent sites and pays for one retained district lane', () => {
  const journey = manufacturingJourney();
  assert.deepEqual(journey.state.tiles, journey.beforeRelease.tiles);
  assert.ok(!legalActions(journey.state, 0, journey.time()).some(option => option.action.type === 'research' && option.action.technology === 'apprenticeship'));
  journey.research('iron-working'); journey.research('apprenticeship');
  const zone = BUILDINGS.find(item => item.id === 'industrial-zone'); assert.ok(zone);
  const city = journey.state.cities.find(item => item.id === 'city-0'); assert.ok(city);
  const options = legalActions(journey.state, 0, journey.time()).filter(option => option.action.type === 'build' && option.action.project === zone.id && option.action.cityId === city.id);
  assert.ok(options.length > 0);
  const counts = options.map(option => {
    assert.ok(option.action.type === 'build' && option.action.tileId !== undefined);
    const tileId = option.action.tileId;
    const site = journey.state.tiles.find(tile => tile.id === tileId); assert.ok(site);
    const mines = journey.state.cities.flatMap(town => Object.values(town.improvements ?? {})).filter(improvement => improvement.improvementId === 'mine' && journey.state.tiles.some(tile => tile.id === improvement.tileId && hexDistance(site, tile) === 1));
    assert.equal(buildingBaseProduction(journey.state, city, zone, site.id).materials, 2 + Math.min(3, mines.length));
    return { option, count: mines.length };
  }).toSorted((left, right) => right.count - left.count);
  const selected = counts[0]; assert.ok(selected && selected.count > 0);
  const before = structuredClone(journey.state);
  journey.act(selected.option.action);
  const order = journey.state.cities.find(item => item.id === city.id)?.construction?.active;
  assert.ok(order && !('kind' in order)); assert.equal(order.buildingId, zone.id); assert.equal(order.workRequired, 12);
  assert.equal(stocks(before).materials - stocks(journey.state).materials, 24);
  assert.equal(stocks(before).credits - stocks(journey.state).credits, 12);
  const duplicate = applyCommand(journey.state, { seat: 0, expectedRevision: journey.state.revision, timestamp: journey.time(), action: selected.option.action });
  assert.equal(duplicate.ok, false); assert.deepEqual(duplicate.state, journey.state);
  journey.until(() => !journey.state.cities.find(item => item.id === city.id)?.construction?.active);
  assert.equal(journey.state.cities.find(item => item.id === city.id)?.districtSites?.[zone.id], order.tileId);
  assert.deepEqual(journey.state.tiles, before.tiles);
  for (const step of journey.steps) assert.deepEqual(replayCoastalStep(structuredClone(step.before), step.input), step.result);
});

await test('manufacturing staffed Guild workshop follows own district completion and first operates on a later beat', () => {
  const { journey, researched, workshopCompleted } = manufacturingOperationJourney();
  const wrong = researched.cities.find(city => city.civId === 0 && city.id !== 'city-0'); assert.ok(wrong);
  const refused = applyCommand(researched, { seat: 0, expectedRevision: researched.revision, timestamp: coastalPrefixTime((researched.independentTurns?.strategyTicks ?? 0) * 60 + 50), action: { type: 'build', cityId: wrong.id, project: 'guild-workshop' } });
  assert.equal(refused.ok, false); assert.deepEqual(refused.state, researched);
  assert.equal(workshopCompleted.cities[0]?.buildingOperations?.['guild-workshop']?.lastResult, null);
  const result = journey.state.cities[0]?.buildingOperations?.['guild-workshop']?.lastResult; assert.ok(result);
  assert.equal(result.status, 'operated'); assert.deepEqual(result.paid, { energy: 2 }); assert.ok((result.produced.materials ?? 0) > 0); assert.equal(result.residents?.allocated, 3);
  journey.act({ type: 'set-building-operation', cityId: 'city-0', buildingId: 'guild-workshop', enabled: false }); journey.beat();
  const paused = journey.state.cities[0]?.buildingOperations?.['guild-workshop']?.lastResult; assert.ok(paused);
  assert.equal(paused.status, 'paused'); assert.deepEqual(paused.paid, {}); assert.deepEqual(paused.produced, {}); assert.equal(paused.residents?.allocated, 0);
});

await test('manufacturing exact foreign occupied and missing sites refuse without spending or reserving', () => {
  const journey = manufacturingJourney(); journey.research('iron-working'); journey.research('apprenticeship');
  const foreign = journey.state.tiles.find(tile => tile.owner === 1); assert.ok(foreign);
  const city = journey.state.cities.find(item => item.id === 'city-0'); assert.ok(city);
  for (const tileId of [foreign.id, city.tileId, 56, city.districtSites?.campus, -1]) {
    assert.ok(tileId !== undefined);
    const before = structuredClone(journey.state);
    const result = applyCommand(journey.state, { seat: 0, expectedRevision: journey.state.revision, timestamp: journey.time(), action: { type: 'build', cityId: city.id, project: 'industrial-zone', tileId } });
    assert.equal(result.ok, false); assert.deepEqual(result.state, before); assert.deepEqual(journey.state, before); assert.deepEqual(result.events, []);
  }
});

await test('manufacturing physical installed Mine adjacency survives a legal operating pause', () => {
  const journey = manufacturingJourney(); journey.research('iron-working'); journey.research('apprenticeship');
  const zone = BUILDINGS.find(item => item.id === 'industrial-zone'); assert.ok(zone);
  const city = journey.state.cities.find(item => item.id === 'city-0'); assert.ok(city);
  const sites = legalActions(journey.state, 0, journey.time()).flatMap(option => option.action.type === 'build' && option.action.project === zone.id && option.action.cityId === city.id && option.action.tileId !== undefined ? [option.action.tileId] : []);
  assert.ok(sites.length > 0);
  const outputs = sites.map(tileId => buildingBaseProduction(journey.state, city, zone, tileId));
  for (const tileId of [56, 58]) journey.act({ type: 'set-improvement-operation', cityId: city.id, tileId, improvementId: 'mine', enabled: false });
  journey.beat();
  const after = journey.state.cities.find(item => item.id === city.id); assert.ok(after);
  assert.deepEqual(sites.map(tileId => buildingBaseProduction(journey.state, after, zone, tileId)), outputs);
  for (const tileId of [56, 58]) assert.equal(after.improvements?.[String(tileId)]?.operation.lastResult?.status, 'paused');
});

await test('manufacturing district completion earns no output until the next beat against an untouched legal control', () => {
  const result = manufacturingOperationJourney();
  let control = structuredClone(result.researched);
  while (control.round < result.zoneCompleted.round) {
    const next = catchUpStrategy(control, coastalPrefixTime(((control.independentTurns?.strategyTicks ?? 0) + 1) * 60));
    assert.ok(next.ok, next.error); assert.ok(isWorldState(next.state)); control = next.state;
  }
  assert.equal(Math.round((stocks(result.zoneCompleted).materials - stocks(control).materials) * 100) / 100, -24);
  assert.equal(Math.round((stocks(result.zoneCompleted).credits - stocks(control).credits) * 100) / 100, -12);
  const city = result.zoneCompleted.cities.find(item => item.id === 'city-0'); assert.ok(city);
  const zone = BUILDINGS.find(item => item.id === 'industrial-zone'); assert.ok(zone);
  const expected = (buildingBaseProduction(result.zoneCompleted, city, zone).materials ?? 0) * cityProductivity(city);
  const timestamp = coastalPrefixTime(((control.independentTurns?.strategyTicks ?? 0) + 1) * 60);
  const baseline = catchUpStrategy(control, timestamp); const operated = catchUpStrategy(result.zoneCompleted, timestamp);
  assert.ok(baseline.ok && operated.ok);
  const difference = stocks(operated.state).materials - stocks(baseline.state).materials;
  assert.equal(Math.round(difference * 100) / 100, Math.round((-24 + expected) * 100) / 100);
});

await test('manufacturing canonical adjacency facts expose installed IDs and exclude actual incomplete Mine orders', () => {
  const result = manufacturingOperationJourney();
  const zone = BUILDINGS.find(item => item.id === 'industrial-zone'); assert.ok(zone?.district?.adjacency);
  assert.equal(zone.district.adjacency.maximum, 3);
  const row = projectCapabilities(result.zoneCompleted, 0, 'city-0', coastalPrefixTime((result.zoneCompleted.independentTurns?.strategyTicks ?? 0) * 60 + 20)).buildings.find(item => item.nodeId === 'building:industrial-zone');
  assert.ok(row?.district?.siteAdjacency);
  const facts = row.district.siteAdjacency;
  assert.equal(facts.source, 'improvement'); assert.equal(facts.bonus, Math.min(3, facts.tileIds.length));
  assert.equal(row.district.siteBaseProduction?.materials, 2 + facts.bonus);
  facts.tileIds.push(999);
  assert.ok(!projectCapabilities(result.zoneCompleted, 0, 'city-0', coastalPrefixTime((result.zoneCompleted.independentTurns?.strategyTicks ?? 0) * 60 + 20)).buildings.find(item => item.nodeId === 'building:industrial-zone')?.district?.siteAdjacency?.tileIds.includes(999));
  const order = result.journey.previous.prefix.steps.find(step => step.input.kind === 'action' && step.input.command.action.type === 'improve' && step.input.command.action.tileId === 58); assert.ok(order);
  const center = order.result.state.tiles.find(tile => tile.id === 58); assert.ok(center);
  const neighbor = order.result.state.tiles.find(tile => hexDistance(center, tile) === 1); assert.ok(neighbor);
  assert.ok(!districtAdjacencyFacts(order.result.state, zone, neighbor.id)?.tileIds.includes(58));
  assert.ok(districtAdjacencyFacts(result.researched, zone, neighbor.id)?.tileIds.includes(58));
});
