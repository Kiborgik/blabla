import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommand, catchUpStrategy } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { isWorldState } from '../core/validation.ts';
import { isWoodlandOperationResult, isWoodlandState, type WoodlandValidationContext } from '../core/woodland-validation.ts';
import type { City, CityImprovement, GameEvent } from '../core/types.ts';
import type { WoodlandImprovementId, WoodlandState } from '../core/woodland-types.ts';
import { syntheticTechnologies } from './fixtures/coastal-prefix.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const release = 'settlement-renewing-worked-woodlands-1';
const at = (seconds: number): string => new Date(Date.parse(epoch) + seconds * 1000).toISOString();
const features = ['renewing-worked-woodlands', 'worked-land', 'forest-production', 'charcoal-clearing', 'resident-capacity', 'building-operations', 'recurring-decisions'];
type Fixture = WoodlandValidationContext & { woodlands: WoodlandState };

function rawFixture(improvementId: WoodlandImprovementId = 'lumber-mill'): Fixture {
  const paid = improvementId === 'charcoal-clearing';
  const improvement: CityImprovement = {
    improvementId, tileId: 1,
    completion: { kind: 'improvement', orderId: 'construction-1', cityId: 'town', improvementId, tileId: 1, startedRound: 0, completedRound: 1, paid: paid ? { materials: 8, credits: 4 } : { materials: 10, credits: 5 }, workRequired: paid ? 4 : 6, eventId: '2:0' },
    operation: { enabled: true, lastResult: {
      round: 2, status: 'operated', paid: paid ? { materials: 1 } : {}, produced: paid ? { energy: 1 } : { materials: 4 }, blockedReason: null,
      residents: { ruleVersion: 1, openingPopulation: 4, communityReserve: 3, required: 1, available: 1, allocated: 1 },
      ...(paid ? { inputs: [{ resource: 'materials' as const, required: 1, available: 10 }], shortages: [] } : {}),
      woodland: { ruleVersion: 1, profileId: 'worked-woodlands-1', tileId: 1, required: 1, opening: 8, harvested: 1, recovered: 0, closing: 7 },
    } },
  };
  const city: City = { id: 'town', name: 'Town', civId: 0, tileId: 0, population: 4, wellbeing: 50, infrastructure: 0, focus: 'research', damage: 0, buildings: [], improvements: { '1': improvement } };
  const completion: GameEvent = { id: '2:0', round: 1, type: 'improvement-completed', title: 'Completed', detail: `town/1/${improvementId}`, actor: 0, target: 0, tileId: 1, cause: 'Actual completed order', effects: [], importance: 4 };
  const beat: GameEvent = { id: '3:1', round: 2, type: 'woodland-beat', title: 'Worked woodlands complete a season', detail: 'worked-woodlands-1 at strategic round 2', actor: null, target: null, tileId: null, cause: 'Fully funded and staffed existing forest operations use one local work-lot; only stands with no harvest recover one lot, capped at eight', effects: ['Harvested work-lots 1', 'Recovered work-lots 0', 'Recovery is not operation output; forest terrain is unchanged'], importance: 2 };
  return {
    unlockedFeatures: [...features], round: 2, revision: 3,
    tiles: [0, 1, 2].map(id => ({ id, q: id, r: 0, terrain: id === 0 ? 'grassland' as const : 'forest' as const, elevation: 50, owner: 0, resource: null })),
    cities: [city], civilizations: [{ id: 0, name: 'People', color: '#000000', adjective: 'Local', objective: '', era: 1, resources: { food: 100, materials: 10, energy: 10, science: 10, culture: 10, credits: 10 }, technologies: ['machinery', 'kiln-firing'], researchTarget: 'agriculture', researchProgress: 0, influence: 0, legitimacy: 50, marsProgress: 0, marsPopulation: 0, marsSupplyStreak: 0, federationStreak: 0, score: 0 }], events: [completion, beat],
    woodlands: { ruleVersion: 1, profileId: 'worked-woodlands-1', stands: { '1': { stock: 7, lastHarvestRound: 2 }, '2': { stock: 8, lastHarvestRound: null } }, lastBeat: { ruleVersion: 1, profileId: 'worked-woodlands-1', round: 2, eventId: '3:1', entries: [
      { tileId: 1, opening: 8, harvested: 1, recovered: 0, closing: 7, harvester: { cityId: 'town', civId: 0, improvementId, orderId: 'construction-1' } },
      { tileId: 2, opening: 8, harvested: 0, recovered: 0, closing: 8, harvester: null },
    ] } },
  };
}

const installed = (state: Fixture): CityImprovement => state.cities[0]!.improvements!['1']!;
const result = (state: Fixture) => { const value = installed(state).operation.lastResult; assert.ok(value); return value; };
const entry = (state: Fixture) => { const value = state.woodlands.lastBeat?.entries[0]; assert.ok(value); return value; };
const raw = (value: object): Record<string, unknown> => value as unknown as Record<string, unknown>;

function rejects(initial: Fixture, cases: Array<[string, (state: Fixture) => void]>): void {
  assert.equal(isWoodlandState(initial.woodlands, initial), true, 'The unmutated independent raw fixture is valid');
  for (const [label, mutate] of cases) {
    const state = structuredClone(initial); mutate(state);
    assert.equal(isWoodlandState(state.woodlands, state), false, label);
  }
}

void test('independent raw fixtures accept exact paid Charcoal and unpaid Lumber, including operated zero output', () => {
  for (const id of ['charcoal-clearing', 'lumber-mill'] as const) {
    const state = rawFixture(id); const before = structuredClone(state);
    assert.equal(isWoodlandState(state.woodlands, state), true);
    assert.equal(isWoodlandOperationResult(result(state), id, 1, 2), true);
    assert.deepEqual(state, before);
    result(state).produced = {};
    assert.equal(isWoodlandState(state.woodlands, state), true, 'Fully paid work consumes its lot even when actual productivity yielded nothing');
    installed(state).operation.enabled = false; state.cities[0]!.population = 12; state.tiles[1]!.owner = 1;
    assert.equal(isWoodlandState(state.woodlands, state), true, 'Later tactical pause, ownership and population changes do not rewrite historical operation receipts');
  }
});

void test('exact fresh inventory rejects missing, alien, fractional, over-cap and impossible history fields', () => {
  rejects(rawFixture(), [
    ['missing layer', s => { raw(s).woodlands = undefined; }],
    ['wrong feature', s => { s.unlockedFeatures = s.unlockedFeatures.filter(id => id !== 'renewing-worked-woodlands'); }],
    ['wrong layer version', s => { raw(s.woodlands).ruleVersion = 2; }],
    ['wrong layer profile', s => { raw(s.woodlands).profileId = 'unknown'; }],
    ['extra layer field', s => { raw(s.woodlands).recovery = 1; }],
    ['missing forest', s => { delete s.woodlands.stands['2']; }],
    ['alien nonforest site', s => { s.woodlands.stands['0'] = { stock: 8, lastHarvestRound: null }; }],
    ['noncanonical site key', s => { s.woodlands.stands['01'] = s.woodlands.stands['1']!; delete s.woodlands.stands['1']; }],
    ['fractional stock', s => { s.woodlands.stands['1']!.stock = 7.5; }],
    ['negative stock', s => { s.woodlands.stands['1']!.stock = -1; }],
    ['over-cap stock', s => { s.woodlands.stands['1']!.stock = 9; }],
    ['nonfinite stock', s => { s.woodlands.stands['1']!.stock = NaN; }],
    ['extra stand field', s => { raw(s.woodlands.stands['1']!).age = 1; }],
    ['missing harvest round', s => { delete raw(s.woodlands.stands['1']!).lastHarvestRound; }],
    ['fractional harvest round', s => { s.woodlands.stands['1']!.lastHarvestRound = 1.5; }],
    ['future harvest round', s => { s.woodlands.stands['1']!.lastHarvestRound = 3; }],
    ['zero harvest round', s => { s.woodlands.stands['1']!.lastHarvestRound = 0; }],
    ['erased actual harvest', s => { s.woodlands.stands['1']!.lastHarvestRound = null; }],
    ['invented unworked harvest', s => { s.woodlands.stands['2']!.lastHarvestRound = 2; }],
    ['missing completed beat', s => { s.woodlands.lastBeat = null; }],
  ]);
  const fresh = rawFixture(); fresh.round = 0; fresh.revision = 0; fresh.events = []; fresh.cities[0]!.improvements = {};
  fresh.woodlands.lastBeat = null; fresh.woodlands.stands['1'] = { stock: 8, lastHarvestRound: null };
  assert.equal(isWoodlandState(fresh.woodlands, fresh), true);
  rejects(fresh, [['depleted genesis', s => { s.woodlands.stands['1']!.stock = 7; }], ['harvest at genesis', s => { s.woodlands.stands['1']!.lastHarvestRound = 0; }]]);
});

void test('the complete latest ledger rejects key, ordering, arithmetic, duplicate harvest and recovery forgeries', () => {
  rejects(rawFixture(), [
    ['stale round', s => { s.woodlands.lastBeat!.round = 1; }],
    ['skipped round', s => { s.woodlands.lastBeat!.round = 3; }],
    ['wrong beat version', s => { raw(s.woodlands.lastBeat!).ruleVersion = 2; }],
    ['wrong beat profile', s => { raw(s.woodlands.lastBeat!).profileId = 'other'; }],
    ['extra beat field', s => { raw(s.woodlands.lastBeat!).forecast = true; }],
    ['omitted idle stand', s => { s.woodlands.lastBeat!.entries.pop(); }],
    ['duplicate entry', s => { s.woodlands.lastBeat!.entries[1] = structuredClone(entry(s)); }],
    ['unordered entries', s => { s.woodlands.lastBeat!.entries.reverse(); }],
    ['sparse entries', s => { delete s.woodlands.lastBeat!.entries[0]; }],
    ['extra array property', s => { raw(s.woodlands.lastBeat!.entries).extra = 1; }],
    ['extra entry field', s => { raw(entry(s)).growth = 1; }],
    ['fractional harvest', s => { entry(s).harvested = 0.5; }],
    ['two lots harvested', s => { entry(s).harvested = 2; }],
    ['harvest and recovery', s => { entry(s).recovered = 1; }],
    ['negative recovery', s => { entry(s).recovered = -1; }],
    ['wrong closing', s => { entry(s).closing = 8; }],
    ['wrong stand closing', s => { s.woodlands.stands['1']!.stock = 6; }],
    ['full idle overgrowth', s => { s.woodlands.lastBeat!.entries[1]!.recovered = 1; }],
    ['unearned decline', s => { const idle = s.woodlands.lastBeat!.entries[1]!; idle.opening = 7; idle.recovered = 1; }],
    ['arithmetic-consistent premature depletion', s => { entry(s).opening = 1; entry(s).closing = 0; s.woodlands.stands['1']!.stock = 0; Object.assign(result(s).woodland!, { opening: 1, closing: 0 }); }],
  ]);
});

void test('harvest requires the exact prior completion, immutable order identity and full current operation', () => {
  rejects(rawFixture('charcoal-clearing'), [
    ['missing harvester', s => { entry(s).harvester = null; }],
    ['foreign city', s => { entry(s).harvester!.cityId = 'foreign'; }],
    ['foreign civilization', s => { entry(s).harvester!.civId = 1; }],
    ['wrong improvement', s => { entry(s).harvester!.improvementId = 'lumber-mill'; }],
    ['wrong order', s => { entry(s).harvester!.orderId = 'construction-2'; }],
    ['extra identity field', s => { raw(entry(s).harvester!).allocated = 1; }],
    ['uninstalled harvest', s => { s.cities[0]!.improvements = {}; }],
    ['duplicate installation', s => { const other = structuredClone(s.cities[0]!); other.id = 'other'; s.cities.push(other); }],
    ['mismatched map key', s => { s.cities[0]!.improvements!['2'] = installed(s); delete s.cities[0]!.improvements!['1']; }],
    ['completion city', s => { installed(s).completion.cityId = 'other'; }],
    ['completion tile', s => { installed(s).completion.tileId = 2; }],
    ['completion improvement', s => { installed(s).completion.improvementId = 'lumber-mill'; }],
    ['completion paid', s => { installed(s).completion.paid.materials = 0; }],
    ['completion work', s => { installed(s).completion.workRequired = 0; }],
    ['same-beat completion harvest', s => { installed(s).completion.completedRound = 2; }],
    ['completion before start', s => { installed(s).completion.startedRound = 2; }],
    ['uncommitted order', s => { installed(s).completion.orderId = 'construction-3'; entry(s).harvester!.orderId = 'construction-3'; }],
    ['completion event altered', s => { s.events[0]!.type = 'focus'; }],
    ['missing current result', s => { installed(s).operation.lastResult = null; }],
    ['stale current result', s => { result(s).round = 1; }],
    ['future current result', s => { result(s).round = 3; }],
    ['paused harvest', s => { result(s).status = 'paused'; }],
    ['blocked harvest', s => { result(s).status = 'blocked'; result(s).blockedReason = 'woodland-shortage'; }],
    ['missing woodland receipt', s => { delete result(s).woodland; }],
    ['wrong receipt site', s => { result(s).woodland!.tileId = 2; }],
    ['wrong receipt required', s => { result(s).woodland!.required = 2; }],
    ['forged receipt closing', s => { result(s).woodland!.closing = 8; }],
    ['missing Material debit', s => { result(s).paid = {}; }],
    ['fractional Material debit', s => { result(s).paid = { materials: 0.99 }; }],
    ['extra ordinary debit', s => { result(s).paid.energy = 1; }],
    ['fractional opening input', s => { result(s).inputs![0]!.available = 0.99; }],
    ['false input recipe', s => { result(s).inputs![0]!.required = 0; }],
    ['fabricated shortage', s => { result(s).shortages = [{ resource: 'materials', required: 1, available: 0 }]; }],
    ['wrong output resource', s => { result(s).produced = { materials: 1 }; }],
    ['nonquantized output', s => { result(s).produced = { energy: 0.001 }; }],
    ['zero-valued output key', s => { result(s).produced = { energy: 0 }; }],
    ['no allocated worker', s => { result(s).residents.allocated = 0; }],
    ['invented residents', s => { result(s).residents.available = 2; }],
    ['false resident recipe', s => { result(s).residents.required = 2; }],
    ['community reserve waived', s => { result(s).residents.communityReserve = 0; }],
    ['fractional opening population', s => { result(s).residents.openingPopulation = 4.5; }],
    ['extra resident field', s => { raw(result(s).residents).bonus = 1; }],
  ]);
});

void test('ledger events require an exact retained identity or provable eviction before all retained events', () => {
  rejects(rawFixture(), [
    ['noncanonical event ID', s => { s.woodlands.lastBeat!.eventId = '03:1'; }],
    ['future event revision', s => { s.woodlands.lastBeat!.eventId = '4:1'; }],
    ['missing retained event', s => { s.events.pop(); }],
    ['duplicate retained event', s => { s.events.push(structuredClone(s.events[1]!)); }],
    ['wrong event type', s => { s.events[1]!.type = 'river-flow'; }],
    ['wrong event round', s => { s.events[1]!.round = 1; }],
    ['wrong event actor', s => { s.events[1]!.actor = 0; }],
    ['wrong event tile', s => { s.events[1]!.tileId = 1; }],
    ['wrong event profile', s => { s.events[1]!.detail = 'other at strategic round 2'; }],
    ['wrong event harvest', s => { s.events[1]!.effects[0] = 'Harvested work-lots 0'; }],
    ['wrong event recovery', s => { s.events[1]!.effects[1] = 'Recovered work-lots 1'; }],
    ['extra ledger event same round', s => { s.events.push({ ...structuredClone(s.events[1]!), id: '3:2' }); }],
    ['completion after ledger', s => { installed(s).completion.eventId = '3:2'; s.events[0]!.id = '3:2'; }],
  ]);
  const evicted = rawFixture(); evicted.revision = 4; evicted.events = [{ ...evicted.events[1]!, id: '4:0', type: 'improvement-operation-changed', detail: 'town/1/lumber-mill' }];
  assert.equal(isWoodlandState(evicted.woodlands, evicted), true);
});

void test('resident data is conserved against prior paid buildings and historical food population, not the current town', () => {
  const state = rawFixture(); const operation = result(state);
  operation.residents.openingPopulation = 7;
  state.cities[0]!.buildings = ['irrigation'];
  state.cities[0]!.buildingOperations = { irrigation: { enabled: true, lastResult: { round: 2, status: 'operated', paid: { materials: 1 }, produced: {}, shortages: [], residents: { ruleVersion: 1, openingPopulation: 7, communityReserve: 3, required: 3, available: 4, allocated: 3 } } } };
  state.cities[0]!.lastFoodSupply = { ruleVersion: 1, foodRule: 'food-budget-1', round: 2, population: 7, produced: 0, required: 8.75, paid: 8.75, growthPaid: 0, supplied: true, foodBefore: 20, foodAfter: 11.25 };
  rejects(state, [
    ['reuse building workers', s => { result(s).residents.available = 4; }],
    ['inconsistent opening populations', s => { result(s).residents.openingPopulation = 8; }],
    ['forged historical food population', s => { s.cities[0]!.lastFoodSupply!.population = 8; }],
    ['negative prior worker allocation', s => { s.cities[0]!.buildingOperations!.irrigation!.lastResult!.residents!.allocated = -3; }],
    ['woodland receipt on unrelated building', s => { raw(s.cities[0]!.buildingOperations!.irrigation!.lastResult!).woodland = structuredClone(result(s).woodland); }],
  ]);
});

void test('paused and exhausted raw receipts recover exactly once without payments, residents or fabricated output', () => {
  const state = rawFixture('charcoal-clearing'); state.round = 10; state.revision = 11; state.woodlands.lastBeat!.round = 10; state.woodlands.lastBeat!.eventId = '11:1'; state.events[1]!.id = '11:1'; result(state).round = 10;
  state.woodlands.stands['1'] = { stock: 1, lastHarvestRound: 9 };
  Object.assign(entry(state), { opening: 0, harvested: 0, recovered: 1, closing: 1, harvester: null });
  Object.assign(result(state), { status: 'blocked', blockedReason: 'woodland-shortage', paid: {}, produced: {} }); result(state).residents.allocated = 0;
  Object.assign(result(state).woodland!, { opening: 0, harvested: 0, recovered: 1, closing: 1 });
  state.events[1]!.round = 10; state.events[1]!.detail = 'worked-woodlands-1 at strategic round 10'; state.events[1]!.effects = ['Harvested work-lots 0', 'Recovered work-lots 1', 'Recovery is not operation output; forest terrain is unchanged']; state.events[1]!.importance = 1;
  rejects(state, [
    ['refusal charged inputs', s => { result(s).paid.materials = 1; }],
    ['refusal allocated worker', s => { result(s).residents.allocated = 1; }],
    ['recovery counted as output', s => { result(s).produced.energy = 1; }],
    ['omitted recovery', s => { entry(s).recovered = 0; entry(s).closing = 0; s.woodlands.stands['1']!.stock = 0; Object.assign(result(s).woodland!, { recovered: 0, closing: 0 }); }],
    ['false harvest date', s => { s.woodlands.stands['1']!.lastHarvestRound = 8; }],
  ]);
  result(state).status = 'paused'; result(state).blockedReason = null; installed(state).operation.enabled = false;
  assert.equal(isWoodlandState(state.woodlands, state), true);
  result(state).status = 'blocked'; result(state).blockedReason = 'input-shortage'; result(state).inputs![0]!.available = 0.99; result(state).shortages = [structuredClone(result(state).inputs![0]!)];
  assert.equal(isWoodlandState(state.woodlands, state), true, 'Input shortage retains priority and zero harvest even at zero woodland stock');
});

void test('fresh registered current-engine construction, depletion and rest validate identically after same-version restart', () => {
  let state = createGeneratedWorld(1701, epoch, release);
  const pair = state.cities.flatMap(city => state.tiles.filter(tile => tile.terrain === 'forest' && !state.cities.some(other => other.tileId === tile.id) && Math.max(Math.abs(tile.q - state.tiles[city.tileId]!.q), Math.abs(tile.r - state.tiles[city.tileId]!.r), Math.abs(tile.q - state.tiles[city.tileId]!.q + tile.r - state.tiles[city.tileId]!.r)) <= 3).map(tile => ({ city, tile })))[0];
  assert.ok(pair, 'Explicit synthetic initial prerequisites: owned nearby forest, Kiln firing, four residents and abundant opening supplies; no natural-uptake claim');
  const { id: cityId, civId } = pair.city; const tileId = pair.tile.id; pair.tile.owner = civId;
  syntheticTechnologies(state, civId, ['kiln-firing']); pair.city.population = 4; pair.city.focus = 'research'; pair.city.wellbeing = 50; pair.city.damage = 0;
  const actor = state.civilizations.find(candidate => candidate.id === civId)!; actor.resources.food = 200; actor.resources.materials = 100; actor.resources.credits = 100;
  assert.equal(isWorldState(state), true);
  const accepted = applyCommand(state, { seat: civId, expectedRevision: state.revision, timestamp: at(20), action: { type: 'improve', cityId, improvementId: 'charcoal-clearing', tileId } });
  assert.equal(accepted.ok, true, accepted.error); state = accepted.state;
  let harvests = 0; let sawRest = false; let sawResumed = false;
  for (let index = 0; index < 18 && !sawResumed; index++) {
    const restored: unknown = JSON.parse(JSON.stringify(state)); assert.equal(isWorldState(restored), true); assert.ok(isWorldState(restored));
    const previous = structuredClone(state); const timestamp = at(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60);
    const next = catchUpStrategy(state, timestamp); assert.equal(next.ok, true, next.error); assert.deepEqual(state, previous);
    assert.deepEqual(catchUpStrategy(restored, timestamp), next); state = next.state;
    assert.equal(isWorldState(state), true, `Actual round ${state.round}`); assert.equal(isWoodlandState(state.woodlands, state), true);
    const installedSite = state.cities.find(city => city.id === cityId)!.improvements?.[String(tileId)];
    const operation = installedSite?.operation.lastResult;
    if (installedSite?.completion.completedRound === state.round) { assert.equal(operation, null); assert.equal(state.woodlands!.stands[String(tileId)]!.stock, 8); }
    if (operation?.status === 'operated') { harvests++; assert.equal(operation.woodland!.harvested, 1); if (sawRest) sawResumed = true; }
    if (operation?.blockedReason === 'woodland-shortage') { assert.equal(harvests, 8); sawRest = true; assert.deepEqual(operation.paid, {}); assert.equal(operation.residents.allocated, 0); assert.equal(state.woodlands!.stands[String(tileId)]!.stock, 1); }
    const repeated = catchUpStrategy(state, timestamp); assert.deepEqual(repeated.state, state); assert.deepEqual(repeated.events, []);
  }
  assert.equal(sawRest, true); assert.equal(sawResumed, true);
  const corrupt = structuredClone(state); delete raw(corrupt).woodlands; assert.equal(isWorldState(corrupt), false);
  const forged = structuredClone(state); forged.woodlands!.lastBeat!.entries.find(candidate => candidate.tileId === tileId)!.harvester!.orderId = 'construction-999'; assert.equal(isWorldState(forged), false);
});
