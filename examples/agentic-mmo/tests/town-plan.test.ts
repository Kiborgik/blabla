import assert from 'node:assert/strict';
import { test } from 'node:test';
import { townPlanV1 } from '../visuals/town-plan.ts';
import type { TownLot } from '../visuals/town-plan.ts';
import { DETAIL_BUDGETS, SETTLEMENT_RENDER_SCALE, settlementVisual, projectWorldVisuals } from '../visuals/world-visuals.ts';
import { createWorld } from '../core/engine.ts';
import { projectWorld } from '../web/live-world.ts';
import { transformedVertices } from '../web/settlement-parts.ts';

const city = { id: 'seeded-town', worldSeed: 1701, civId: 0, tileId: 4, name: 'Town', population: 40, wellbeing: 65, damage: 0, buildings: ['academy', 'granary', 'kiln'] };
const overlaps = (a: TownLot, b: TownLot): boolean => Math.abs(a.x - b.x) < (a.width + b.width) / 2 - 1e-10 && Math.abs(a.z - b.z) < (a.depth + b.depth) / 2 - 1e-10;
const anchors = (input: typeof city) => settlementVisual(input, 'close').parts.filter(part => /home-\d+-wall/.test(part.id)).map(part => [part.id, part.position[0], part.position[2]]);

await test('versioned plans depend only on immutable world seed and city identity', () => {
  const before = structuredClone(city);
  const expected = townPlanV1(city);
  assert.equal(expected.version, 1);
  assert.deepEqual(townPlanV1(structuredClone(city)), expected);
  const changed = { ...city, name: 'Renamed', civId: 4, tileId: 92, population: 100, round: 200, revision: 300, rng: 45, damage: 90, policySeed: 3, buildings: ['launchpad'] };
  assert.deepEqual(townPlanV1(changed), expected);
  assert.notDeepEqual(townPlanV1({ ...city, worldSeed: 1702 }), expected);
  assert.notDeepEqual(townPlanV1({ ...city, id: 'other-town' }), expected);
  assert.deepEqual(townPlanV1({ id: city.id }), townPlanV1({ id: city.id, worldSeed: 0 }));
  assert.deepEqual(city, before);
});

await test('finite seed matrix has three structurally different families with compact disjoint reservations and an open approach', () => {
  const counts = new Map<string, number>();
  for (let worldSeed = 0; worldSeed < 64; worldSeed++) for (let civId = 0; civId < 5; civId++) {
    const plan = townPlanV1({ worldSeed, id: `town-${civId}` });
    counts.set(plan.topology, (counts.get(plan.topology) ?? 0) + 1);
    assert.equal(plan.homeLots.length, 6);
    assert.equal(plan.supportLots.length, 2);
    const lots = [plan.landmarkLot, ...plan.supportLots, plan.constructionLot, ...plan.homeLots];
    assert.equal(new Set(lots.map(lot => lot.id)).size, lots.length);
    for (const [index, lot] of lots.entries()) {
      assert.ok([lot.x, lot.z, lot.width, lot.depth, lot.height].every(Number.isFinite));
      assert.ok(lot.width > 0 && lot.depth > 0 && lot.height > 0);
      assert.ok(!overlaps(lot, plan.approach), `${worldSeed}/${plan.topology}: ${lot.id} blocks approach`);
      for (const other of lots.slice(index + 1)) assert.ok(!overlaps(lot, other), `${worldSeed}/${plan.topology}: ${lot.id}/${other.id}`);
      for (const x of [lot.x - lot.width / 2, lot.x + lot.width / 2]) for (const z of [lot.z - lot.depth / 2, lot.z + lot.depth / 2]) {
        assert.ok(Math.abs(x) <= .96 && Math.abs(z) <= .96);
        assert.ok(Math.hypot(x, z) * SETTLEMENT_RENDER_SCALE <= .76);
      }
    }
    assert.ok(plan.supportLots.every(lot => plan.landmarkLot.width * plan.landmarkLot.depth > lot.width * lot.depth * 3));
    const left = plan.homeLots.filter((_, index) => index % 2 === 0);
    const right = plan.homeLots.filter((_, index) => index % 2 === 1);
    if (plan.topology === 'crescent') assert.ok(Math.abs(left[0]!.x) - Math.abs(left[2]!.x) > .2);
    if (plan.topology === 'split-court') assert.ok(Math.abs(left[0]!.x - left[2]!.x) < .01);
    if (plan.topology === 'ridge-terrace') assert.ok(right[0]!.z - left[0]!.z > .08);
  }
  assert.deepEqual([...counts.keys()].sort(), ['crescent', 'ridge-terrace', 'split-court']);
  assert.ok([...counts.values()].every(count => count > 50 && count < 160));
});

await test('homes keep stable reserved anchors through growth, damage and detail changes', () => {
  const expected = anchors(city);
  for (const population of [1, 4, 7, 14, 40, 10000]) for (const detail of ['far', 'mid', 'close'] as const) {
    const visual = settlementVisual({ ...city, population, damage: 35 }, detail);
    assert.ok(visual.parts.length <= DETAIL_BUDGETS[detail].parts);
    for (const part of visual.parts.filter(part => /home-\d+-wall/.test(part.id))) assert.ok(expected.some(anchor => anchor[0] === part.id && anchor[1] === part.position[0] && anchor[2] === part.position[2]));
    const plan = townPlanV1(city);
    for (const [index, lot] of plan.homeLots.entries()) for (const part of visual.parts.filter(part => part.id.startsWith(`home-${index}-`))) {
      for (const [x, , z] of transformedVertices(part)) assert.ok(x >= lot.x - lot.width / 2 && x <= lot.x + lot.width / 2 && z >= lot.z - lot.depth / 2 && z <= lot.z + lot.depth / 2);
    }
  }
});

await test('world and live projections forward the immutable seed without consuming simulation randomness', () => {
  const state = createWorld(1701);
  state.cities[0]!.buildings = [...city.buildings];
  const before = structuredClone(state);
  const world = projectWorld(state);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const direct = projectWorldVisuals(state, detail);
    assert.deepEqual(world.cities.map(town => settlementVisual(town.settlement!, detail)), direct);
    assert.ok(world.cities.every(town => town.settlement?.worldSeed === state.seed));
    const advanced = { ...state, round: 900, revision: 901, rng: 902 };
    assert.deepEqual(projectWorldVisuals(advanced, detail), direct);
    const other = projectWorldVisuals({ ...state, seed: 1702 }, detail);
    assert.notDeepEqual(other[0]!.parts, direct[0]!.parts);
  }
  assert.deepEqual(state, before);
});

await test('rendered installed landmarks and paid frames occupy their own reserved lots at every detail', () => {
  for (const worldSeed of [0, 1, 2, 1701]) for (let civId = 0; civId < 5; civId++) for (const detail of ['far', 'mid', 'close'] as const) {
    const source = { ...city, worldSeed, civId, construction: { active: { id: 'paid-pad', cityId: city.id, buildingId: 'launchpad', ruleVersion: 1 as const, startedRound: 3, paid: { materials: 12 }, workRequired: 20, workDone: 5 }, lastCompleted: null } };
    const plan = townPlanV1(source);
    const visual = settlementVisual(source, detail);
    const sites = [plan.landmarkLot, ...plan.supportLots];
    const groups = visual.landmarks.map((id, index) => ({ lot: sites[index]!, parts: visual.parts.filter(part => part.id.startsWith(`${id}-`)) }));
    groups.push({ lot: plan.constructionLot, parts: visual.parts.filter(part => part.id.startsWith('construction:')) });
    for (const { lot, parts } of groups) {
      assert.ok(parts.length > 0);
      for (const part of parts) for (const [x, , z] of transformedVertices(part)) {
        assert.ok(x >= lot.x - lot.width / 2 - 1e-10 && x <= lot.x + lot.width / 2 + 1e-10, `${detail}/${part.id}: x`);
        assert.ok(z >= lot.z - lot.depth / 2 - 1e-10 && z <= lot.z + lot.depth / 2 + 1e-10, `${detail}/${part.id}: z`);
      }
    }
    assert.ok(visual.landmarks.every(id => source.buildings.includes(id)));
    assert.ok(!visual.parts.some(part => part.id.startsWith('launchpad-')));
  }
});
