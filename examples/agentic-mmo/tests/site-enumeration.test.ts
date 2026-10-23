import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, IMPROVEMENTS, IMPROVEMENT_RULES, WONDERS } from '../core/content.ts';
import { createWorld } from '../core/engine.ts';
import { availableDistrictSites, districtCapacity, districtCount, districtSiteBlock } from '../core/simulation/districts.ts';
import { availableImprovementSites, improvementSiteBlock } from '../core/simulation/improvements.ts';
import { availableWonderSites, wonderSiteBlock } from '../core/simulation/wonders.ts';
import type { City, WorldState } from '../core/types.ts';

function releasedWorld(seed: number): WorldState {
  return createWorld(seed, '2026-01-01T00:00:00.000Z', 'settlement-knowledge-compacts-1');
}

function assertEquivalent(state: WorldState, city: City): void {
  const expected = (blocker: (tileId: number) => string | null): number[] => state.tiles.filter(tile => blocker(tile.id) === null).map(tile => tile.id).toSorted((a, b) => a - b);
  for (const building of BUILDINGS) assert.deepEqual(availableDistrictSites(state, city, building), districtCount(city) >= districtCapacity(city) ? [] : expected(id => districtSiteBlock(state, city, building, id)), `${city.id}/${building.id}`);
  for (const improvement of IMPROVEMENTS) assert.deepEqual(availableImprovementSites(state, city, improvement), expected(id => improvementSiteBlock(state, city, improvement, id)), `${city.id}/${improvement.id}`);
  for (const wonder of WONDERS) assert.deepEqual(availableWonderSites(state, city, wonder), expected(id => wonderSiteBlock(state, city, wonder, id)), `${city.id}/${wonder.id}`);
}

void test('bulk site enumeration exactly matches the public canonical site checker across released maps and catalogues', () => {
  for (const seed of [11, 41]) {
    const state = releasedWorld(seed);
    const before = structuredClone(state);
    for (const city of state.cities) assertEquivalent(state, city);
    assert.deepEqual(state, before);
  }
  const foundations = createWorld(41);
  for (const city of foundations.cities) assertEquivalent(foundations, city);
});

void test('same-identity same-revision terrain, ownership and occupation changes cannot reuse stale site results', () => {
  const state = releasedWorld(41); const city = state.cities[0];
  const campus = BUILDINGS.find(building => building.id === 'campus');
  const mine = IMPROVEMENTS.find(improvement => improvement.id === 'mine');
  const wonder = WONDERS[0]; assert.ok(city && campus && mine && wonder);
  const tileId = availableDistrictSites(state, city, campus)[0];
  const tile = state.tiles.find(candidate => candidate.id === tileId); assert.ok(tile);
  const revision = state.revision;
  tile.terrain = 'grassland';
  tile.elevation = (IMPROVEMENT_RULES.hillElevation.minimum + IMPROVEMENT_RULES.hillElevation.maximum) / 2;
  assert.ok(availableDistrictSites(state, city, campus).includes(tile.id));
  assert.ok(availableImprovementSites(state, city, mine).includes(tile.id));
  assert.ok(availableWonderSites(state, city, wonder).includes(tile.id));
  assertEquivalent(state, city);
  tile.owner = (city.civId + 1) % 5;
  assert.ok(!availableDistrictSites(state, city, campus).includes(tile.id));
  assert.ok(!availableImprovementSites(state, city, mine).includes(tile.id));
  assert.ok(!availableWonderSites(state, city, wonder).includes(tile.id));
  assertEquivalent(state, city);
  tile.owner = city.civId; tile.terrain = 'ocean'; tile.elevation = 0;
  assertEquivalent(state, city);
  tile.terrain = 'grassland'; tile.elevation = IMPROVEMENT_RULES.hillElevation.minimum;
  city.construction = { active: { id: 'synthetic-reservation', cityId: city.id, buildingId: campus.id, tileId: tile.id, ruleVersion: 1, startedRound: state.round, paid: { ...campus.cost }, workRequired: 8, workDone: 0 }, lastCompleted: null };
  assert.ok(!availableDistrictSites(state, city, campus).includes(tile.id));
  assert.ok(!availableImprovementSites(state, city, mine).includes(tile.id));
  assert.ok(!availableWonderSites(state, city, wonder).includes(tile.id));
  assertEquivalent(state, city);
  city.construction.active = null;
  assert.ok(availableDistrictSites(state, city, campus).includes(tile.id));
  assert.ok(availableImprovementSites(state, city, mine).includes(tile.id));
  assert.ok(availableWonderSites(state, city, wonder).includes(tile.id));
  assert.equal(state.revision, revision);
});

void test('capacity, missing centers, invalid exact sites and feature removal keep existing blockers', () => {
  const state = releasedWorld(41); const city = state.cities[0];
  const campus = BUILDINGS.find(building => building.id === 'campus');
  const mine = IMPROVEMENTS.find(improvement => improvement.id === 'mine');
  const wonder = WONDERS[0]; assert.ok(city && campus && mine && wonder);
  const centers = city.tileId;
  for (const invalid of [-1, NaN, 0.5, Number.MAX_SAFE_INTEGER]) {
    assert.equal(districtSiteBlock(state, city, campus, invalid), 'The exact district site is missing');
    assert.equal(improvementSiteBlock(state, city, mine, invalid), 'The exact improvement site is missing');
    assert.equal(wonderSiteBlock(state, city, wonder, invalid), 'The exact wonder site is missing');
  }
  city.tileId = -1; assertEquivalent(state, city);
  assert.deepEqual(availableDistrictSites(state, city, campus), []);
  assert.deepEqual(availableImprovementSites(state, city, mine), []);
  assert.deepEqual(availableWonderSites(state, city, wonder), []);
  city.tileId = centers;
  city.districtSites = Object.fromEntries(Array.from({ length: districtCapacity(city) }, (_, index) => [`synthetic-${index}`, state.tiles.length + index]));
  assertEquivalent(state, city); assert.deepEqual(availableDistrictSites(state, city, campus), []);
  city.districtSites = {};
  state.unlockedFeatures = state.unlockedFeatures.filter(feature => feature !== 'district-planning');
  assertEquivalent(state, city);
  assert.equal(districtSiteBlock(state, city, campus, NaN), 'District planning is unavailable');
});

void test('site identifiers rather than array positions remain authoritative after tile reorder', () => {
  const state = releasedWorld(41); const city = state.cities[0]; assert.ok(city);
  const before = BUILDINGS.filter(building => building.district).map(building => availableDistrictSites(state, city, building));
  state.tiles.reverse();
  assertEquivalent(state, city);
  assert.deepEqual(BUILDINGS.filter(building => building.district).map(building => availableDistrictSites(state, city, building)), before);
});
