import assert from 'node:assert/strict';
import test from 'node:test';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { createWorld, legalActions, applyCommand } from '../core/engine.ts';
import { generateGeography, generateGeographyWithCandidateForTest, reconstructGeneratedGeography } from '../core/generated-geography.ts';
import { planRegionalIron, regionalIronPlanForWorld, regionalIronComponents, REGIONAL_IRON_MAXIMUM_STEPS } from '../core/regional-iron.ts';
import { createCoalDeposits, createStrategicDeposits } from '../core/simulation/metals.ts';
import { createPastoralSites } from '../core/simulation/pastoral.ts';
import { createTerritoryPlanner } from '../core/simulation/territory.ts';
import { isWorldState } from '../core/validation.ts';
import { type WorldState, type Terrain } from '../core/types.ts';

const EPOCH = '2000-01-01T00:00:00.000Z';
const RELEASE = 'settlement-regional-iron-1';
const SEEDS = [0, 1, 73, 1701, 90210, 0xffffffff];
const worlds = new Map<number, WorldState>();
const offsets = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]];
function neighbors(id: number, width: number, height: number): number[] {
  return offsets.flatMap(([dq, dr]) => {
    const q = id % width + dq!, r = Math.floor(id / width) + dr!;
    return q >= 0 && q < width && r >= 0 && r < height ? [r * width + q] : [];
  });
}
function distance(a: number, b: number, width: number): number {
  const q = a % width - b % width, r = Math.floor(a / width) - Math.floor(b / width);
  return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
}
function rawComponents(ids: readonly number[], width: number, height: number): number[][] {
  const remaining = new Set(ids), result: number[][] = [];
  while (remaining.size) {
    const queue = [remaining.values().next().value!]; remaining.delete(queue[0]!);
    for (const id of queue) for (const next of neighbors(id, width, height)) if (remaining.delete(next)) queue.push(next);
    result.push(queue.sort((a, b) => a - b));
  }
  return result.sort((a, b) => a[0]! - b[0]!);
}
function world(seed: number): WorldState {
  const cached = worlds.get(seed); if (cached) return structuredClone(cached);
  const start = performance.now(), state = createGeneratedWorld(seed, EPOCH, RELEASE);
  const plan = regionalIronPlanForWorld(state);
  assert.equal(plan?.status, 'placed');
  const preceding: Array<{ attempt: number; rejection: string }> = [];
  for (let attempt = 0; attempt < state.origin!.geographyAttempt!; attempt++) {
    const candidate = reconstructGeneratedGeography(seed, 18, 24, attempt);
    if (!candidate) { preceding.push({ attempt, rejection: 'base-geography' }); continue; }
    const candidatePlan = planRegionalIron({ seed, width: 18, height: 24, terrainBasis: candidate.drainage.terrainBasis, genesisCapitalTileIds: candidate.capitalTileIds });
    assert.notEqual(candidatePlan.status, 'search-budget-exhausted');
    if (candidatePlan.status === 'no-solution') { preceding.push({ attempt, rejection: 'regional-no-solution' }); continue; }
    const rejected = createWorld(seed, EPOCH, RELEASE, candidate);
    const reachable = new Set([candidate.capitalTileIds[0]!]), queue = [...reachable];
    for (const id of queue) for (const next of neighbors(id, 18, 24)) if (!reachable.has(next) && !['ocean', 'mountain'].includes(rejected.tiles[next]!.terrain)) { reachable.add(next); queue.push(next); }
    const failures = [
      rejected.coalDeposits!.tileIds.length !== 8 ? 'coal-count' : '',
      rejected.pastoralSites!.tileIds.length !== 10 ? 'horse-count' : '',
      rejected.coalDeposits!.tileIds.filter(id => reachable.has(id)).length < 6 ? 'coal-land-access' : '',
      rejected.civilizations.some(civ => !legalActions(rejected, civ.id, EPOCH).some(option => option.action.type === 'settle')) ? 'paid-founding' : '',
    ].filter(Boolean);
    assert.ok(failures.length, `attempt ${attempt} must not skip a viable candidate`);
    preceding.push({ attempt, rejection: failures.join(',') });
  }
  console.log(JSON.stringify({ seed, geographyAttempt: state.origin!.geographyAttempt, milliseconds: performance.now() - start, steps: plan?.steps, preceding, iron: state.strategicDeposits!.tileIds, coal: state.coalDeposits!.tileIds, horses: state.pastoralSites!.tileIds, approaches: plan?.status === 'placed' ? plan.approaches : [] }));
  worlds.set(seed, structuredClone(state)); return state;
}

for (const seed of SEEDS) void test(`regional Iron seed ${seed}: raw induced hill topology, reserves, compatible capital approaches and recomputed resources`, () => {
  const state = world(seed), frozen = JSON.stringify(state), iron = state.strategicDeposits!;
  assert.ok(isWorldState(state));
  assert.deepEqual(createGeneratedWorld(seed, EPOCH, RELEASE), state);
  assert.equal(iron.placementId, 'regional-iron-1');
  assert.equal(iron.tileIds.length, 8);
  assert.equal(new Set(iron.tileIds).size, 8);
  assert.deepEqual(rawComponents(iron.tileIds, state.width, state.height).map(ids => ids.length).sort((a, b) => b - a), [3, 3, 2]);
  for (const id of iron.tileIds) {
    const tile = state.tiles[id]!;
    assert.ok(tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && tile.elevation >= 70 && tile.elevation <= 88);
    assert.equal(tile.resource, null);
    assert.ok(state.cities.every(city => city.tileId !== id));
    assert.deepEqual(iron.deposits[String(id)], { tileId: id, resource: 'iron', initialReserve: 240, remaining: 240 });
  }
  assert.equal(Object.values(iron.deposits).reduce((sum, deposit) => sum + deposit.initialReserve, 0), 1920);
  const reachable = new Set<number>([state.cities[0]!.tileId]), queue = [...reachable];
  for (const id of queue) for (const next of neighbors(id, state.width, state.height)) {
    const tile = state.tiles[next]!;
    if (!reachable.has(next) && tile.terrain !== 'ocean' && tile.terrain !== 'mountain') { reachable.add(next); queue.push(next); }
  }
  for (const layer of [iron, state.coalDeposits!]) assert.ok(layer.tileIds.filter(id => reachable.has(id)).length >= 6);
  const plan = regionalIronPlanForWorld(state); assert.equal(plan?.status, 'placed');
  if (plan?.status !== 'placed') throw new Error('Missing canonical plan');
  assert.ok(plan.steps <= REGIONAL_IRON_MAXIMUM_STEPS);
  assert.deepEqual(plan.tileIds, iron.tileIds);
  assert.deepEqual(plan.components, rawComponents(iron.tileIds, state.width, state.height));
  assert.equal(new Set(plan.approaches.map(approach => approach.civId)).size, 2);
  assert.equal(new Set(plan.approaches.map(approach => approach.tileId)).size, 2);
  const bought = plan.approaches.flatMap(approach => approach.purchaseTileIds);
  assert.equal(new Set(bought).size, bought.length);
  const purchaseFixture = structuredClone(state);
  for (const approach of plan.approaches) {
    assert.equal(approach.capitalTileId, state.cities[approach.civId]!.tileId);
    assert.equal(approach.pathTileIds[0], approach.capitalTileId);
    assert.equal(approach.pathTileIds.at(-1), approach.tileId);
    assert.ok(iron.tileIds.includes(approach.tileId));
    assert.equal(state.tiles[approach.tileId]!.owner, null);
    assert.deepEqual(approach.purchaseTileIds, approach.pathTileIds.filter(id => state.tiles[id]!.owner === null));
    for (const [index, id] of approach.pathTileIds.entries()) {
      const tile = state.tiles[id]!;
      assert.ok(tile.terrain !== 'ocean' && tile.terrain !== 'mountain');
      assert.ok(distance(approach.capitalTileId, id, state.width) <= 3);
      assert.ok(tile.owner === null || tile.owner === approach.civId);
      if (index) { assert.ok(neighbors(approach.pathTileIds[index - 1]!, state.width, state.height).includes(id)); assert.ok(state.cities.every(city => city.tileId !== id)); }
    }
    for (const id of approach.purchaseTileIds) {
      const native = createTerritoryPlanner(purchaseFixture).assess(approach.civId, `city-${approach.civId}`, id);
      assert.ok(native.quote, native.blocker ?? 'Structural native quote absent');
      purchaseFixture.tiles[id]!.owner = approach.civId;
    }
  }
  assert.deepEqual(createStrategicDeposits(state), iron);
  assert.deepEqual(createPastoralSites(state), state.pastoralSites);
  assert.deepEqual(createCoalDeposits(state), state.coalDeposits);
  assert.equal(state.coalDeposits!.tileIds.length, 8);
  assert.equal(state.pastoralSites!.tileIds.length, 10);
  const all = [...iron.tileIds, ...state.coalDeposits!.tileIds, ...state.pastoralSites!.tileIds];
  assert.equal(new Set(all).size, all.length);
  for (const id of state.coalDeposits!.tileIds) {
    const tile = state.tiles[id]!;
    assert.ok(tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && tile.elevation >= 70 && tile.elevation <= 88);
    assert.equal(state.coalDeposits!.deposits[String(id)]!.initialReserve, 300);
    assert.ok(state.coalDeposits!.tileIds.every(other => other === id || distance(id, other, state.width) >= 2));
  }
  for (const id of state.pastoralSites!.tileIds) {
    assert.equal(state.tiles[id]!.terrain, 'grassland');
    assert.ok(state.pastoralSites!.tileIds.every(other => other === id || distance(id, other, state.width) >= 2));
  }
  for (const civ of state.civilizations) assert.ok(legalActions(state, civ.id, EPOCH).some(option => option.action.type === 'settle'));
  assert.equal(JSON.stringify(state), frozen);
});

void test('canonical membership rejects substituted hills, reserve forgery, version, origin and immutable basis mutation', () => {
  const state = world(73);
  const mutate = (change: (fixture: WorldState) => void): void => { const fixture = structuredClone(state); change(fixture); assert.equal(isWorldState(fixture), false); };
  mutate(fixture => { fixture.strategicDeposits!.placementId = 'iron-placement-1'; });
  mutate(fixture => { const id = fixture.strategicDeposits!.tileIds[0]!; fixture.strategicDeposits!.deposits[String(id)]!.initialReserve = 241; });
  mutate(fixture => { const id = fixture.strategicDeposits!.tileIds[0]!; fixture.strategicDeposits!.deposits[String(id)]!.remaining = 241; });
  mutate(fixture => { fixture.strategicDeposits!.tileIds.reverse(); });
  mutate(fixture => {
    const layer = fixture.strategicDeposits!, old = layer.tileIds[0]!;
    const replacement = fixture.tiles.find(tile => tile.elevation >= 70 && tile.elevation <= 88 && tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && tile.resource === null && !layer.tileIds.includes(tile.id) && !fixture.coalDeposits!.tileIds.includes(tile.id) && !fixture.pastoralSites!.tileIds.includes(tile.id))!;
    assert.ok(replacement); layer.tileIds[0] = replacement.id; layer.tileIds.sort((a, b) => a - b); delete layer.deposits[String(old)];
    layer.deposits[String(replacement.id)] = { tileId: replacement.id, resource: 'iron', initialReserve: 240, remaining: 240 };
  });
  for (const attempt of [-1, .5, 96, Number.NaN]) mutate(fixture => { fixture.origin!.geographyAttempt = attempt; });
  mutate(fixture => { delete fixture.origin!.geographyAttempt; });
  mutate(fixture => { fixture.origin!.initialReleaseId = 'settlement-civic-works-1'; });
  mutate(fixture => { fixture.origin!.geographyAttempt = (fixture.origin!.geographyAttempt! + 1) % 96; });
  mutate(fixture => { fixture.drainage!.terrainBasis[0]![1] += 1; fixture.tiles[0]!.elevation += 1 / 4096; });
  mutate(fixture => { fixture.seed ^= 1; fixture.origin!.seed = fixture.seed; fixture.strategicDeposits!.seed = fixture.seed; });
  assert.ok(isWorldState(state));
});

void test('genesis reconstruction ignores later ownership and towns, preserves paid founding and protects cached output', () => {
  const state = world(73), plan = regionalIronPlanForWorld(state);
  assert.equal(plan?.status, 'placed');
  const altered = structuredClone(state);
  for (const tile of altered.tiles) if (tile.owner === null) tile.owner = 4;
  altered.cities[0]!.tileId = altered.cities[1]!.tileId;
  altered.cities.push({ ...structuredClone(altered.cities[0]!), id: 'later-town' });
  assert.deepEqual(regionalIronPlanForWorld(altered), plan);
  if (plan?.status !== 'placed') throw new Error('Missing plan');
  plan.tileIds[0] = -1; plan.components[0]![0] = -1; plan.approaches[0].pathTileIds[0] = -1;
  assert.deepEqual(regionalIronPlanForWorld(state)?.status === 'placed' && regionalIronPlanForWorld(state), regionalIronPlanForWorld(altered));
  const option = legalActions(state, 0, EPOCH).find(item => item.action.type === 'settle'); assert.ok(option);
  const result = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: EPOCH, action: option.action });
  assert.ok(result.ok, result.error); assert.ok(isWorldState(result.state));
  assert.deepEqual(result.state.strategicDeposits, state.strategicDeposits);
  assert.deepEqual(regionalIronPlanForWorld(result.state), regionalIronPlanForWorld(state));
  assert.deepEqual(JSON.parse(JSON.stringify(result.state)), result.state);
  const depleted = structuredClone(state); depleted.strategicDeposits!.deposits[String(depleted.strategicDeposits!.tileIds[0])]!.remaining = 0;
  assert.ok(isWorldState(depleted));
});

void test('bounded pure search distinguishes proved absence from UNKNOWN without changing terrain', () => {
  const state = world(73), genesis = reconstructGeneratedGeography(state.seed, state.width, state.height, state.origin!.geographyAttempt!);
  assert.ok(genesis);
  const input = { seed: state.seed, width: state.width, height: state.height, terrainBasis: state.drainage!.terrainBasis, genesisCapitalTileIds: genesis.capitalTileIds };
  const bytes = JSON.stringify(input);
  assert.deepEqual(planRegionalIron(input, { maximumSteps: 0 }), { status: 'search-budget-exhausted', steps: 0 });
  const bounded = planRegionalIron(input, { maximumSteps: 20 }); assert.equal(bounded.status, 'search-budget-exhausted'); assert.equal(bounded.steps, 20);
  assert.equal(JSON.stringify(input), bytes);
  const flat = { ...input, terrainBasis: input.terrainBasis.map(([terrain, elevation]): [Terrain, number] => [terrain === 'mountain' ? 'grassland' : terrain, terrain === 'ocean' ? elevation : 35 * 4096]) };
  assert.equal(planRegionalIron(flat).status, 'no-solution');
  assert.throws(() => planRegionalIron(input, { maximumSteps: -1 }), RangeError);
  assert.deepEqual(regionalIronComponents([17, 18], 18, 24), [[17], [18]]);
});

void test('candidate viability stays inside exactly 96 attempts and UNKNOWN refuses without a reroll', () => {
  let candidates = 0;
  assert.throws(() => generateGeographyWithCandidateForTest(73, 18, 24, () => { candidates++; return []; }), /within 96 attempts/);
  assert.equal(candidates, 96);
  let assessments = 0;
  assert.throws(() => generateGeography(73, 18, 24, () => { assessments++; return 'search-budget-exhausted'; }), /search-budget-exhausted/);
  assert.equal(assessments, 1);
  const existing = world(73), frozen = JSON.stringify(existing.drainage);
  let retries = 0;
  assert.throws(() => generateGeographyWithCandidateForTest(73, 18, 24, () => { retries++; return structuredClone(existing.tiles).map(tile => ({ ...tile, owner: null, resource: null })); }, () => 'reject'), /within 96 attempts/);
  assert.equal(retries, 96);
  assert.equal(JSON.stringify(existing.drainage), frozen);
});

void test('all registered fresh entry points select regional geography without upgrading old worlds', () => {
  assert.deepEqual(createWorld(73, EPOCH, RELEASE), world(73));
  const genesis = reconstructGeneratedGeography(73, 18, 24, world(73).origin!.geographyAttempt!); assert.ok(genesis);
  assert.throws(() => createWorld(74, EPOCH, RELEASE, genesis), /exact generated candidate/);
  assert.throws(() => createWorld(73, EPOCH, RELEASE, { ...genesis, attempt: 96 }), /exact generated candidate/);
  assert.throws(() => createWorld(73, EPOCH, 'settlement-civic-works-1', genesis), /exact generated candidate/);
  const old = createGeneratedWorld(73, EPOCH, 'settlement-civic-works-1');
  assert.equal(old.strategicDeposits!.placementId, 'iron-placement-1');
  assert.equal(Object.hasOwn(old.origin!, 'geographyAttempt'), false);
  assert.ok(isWorldState(old));
  const forged = structuredClone(old); forged.origin!.geographyAttempt = 0; assert.equal(isWorldState(forged), false);
  const regional = createGeneratedWorld(73, EPOCH, RELEASE, 'cultural-toponyms-v1', 'strategic-temperaments-v1');
  assert.ok(isWorldState(regional));
  assert.deepEqual(regional.strategicDeposits, world(73).strategicDeposits);
});

void test('warm canonical validation uses exact-input cached plans and remains bounded', () => {
  const state = world(73), start = performance.now();
  for (let index = 0; index < 32; index++) assert.ok(isWorldState(structuredClone(state)));
  console.log(JSON.stringify({ validationCopies: 32, milliseconds: performance.now() - start }));
});
