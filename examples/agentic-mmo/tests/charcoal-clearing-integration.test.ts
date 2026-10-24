import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as THREE from 'three';
import { createWorld } from '../core/engine.ts';
import { isWorldState } from '../core/validation.ts';
import { ACTIVE_LOCAL_RELEASE_ID, ACTIVE_LOCAL_POLICY_VERSION, LOCAL_SIMULATION_STORAGE_KEY, createLocalSimulation, parseLocalSimulation } from '../web/local-simulation.ts';
import { charcoalClearingParts } from '../visuals/charcoal-clearing-visuals.ts';
import { CHARCOAL_MARK_PATH, improvementMark, improvementParts, IMPROVEMENT_PART_BUDGETS } from '../visuals/improvement-visuals.ts';
import type { ImprovementView } from '../visuals/improvement-visuals.ts';
import { hexPosition, LANDSCAPE_BUDGETS, projectLandscape } from '../visuals/landscape.ts';
import type { LandscapeTile } from '../visuals/landscape.ts';
import { workedLandCompositionV1 } from '../visuals/worked-land-composition.ts';
import { projectWorld } from '../web/live-world.ts';
import { createLandscapeMeshes } from '../web/landscape-three.ts';
import { flatSceneFaces } from '../web/settlement-parts.ts';

const tiles: LandscapeTile[] = [{ q: 0, r: 0, owner: 0, terrain: 'forest', height: .3 }, { q: 1, r: 0, owner: 0, terrain: 'forest', height: .3 }];
const site: ImprovementView = { id: 'synthetic-visual-site', cityId: 'synthetic-town', townName: 'Forest town', civId: 0,
  improvementId: 'charcoal-clearing', name: 'Charcoal clearing', tileId: 56, worldSeed: 73, q: 0, r: 0, height: .3,
  color: '#8eaa53', status: 'built', construction: null, completion: null, operation: { enabled: false, lastResult: null },
  baseProduction: { energy: 1 }, residentsRequired: 1 };

void test('fresh current charcoal genesis retains funded policy and current content without installing or migrating work', () => {
  const run = createLocalSimulation(73);
  assert.equal(ACTIVE_LOCAL_RELEASE_ID, 'settlement-charcoal-clearing-1');
  assert.equal(LOCAL_SIMULATION_STORAGE_KEY, 'civitas:procedural-observatory:charcoal-clearing-v1');
  assert.equal(ACTIVE_LOCAL_POLICY_VERSION, 'weighted-civilizations-v5-funded-landwork');
  assert.equal(run.state.origin?.initialReleaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.ok(isWorldState(run.state));
  for (const feature of ['food-budget', 'shore-fisheries', 'knowledge-compacts', 'hillside-commonworks', 'supplied-borders', 'funded-landwork-planning', 'charcoal-clearing']) assert.ok(run.state.unlockedFeatures.includes(feature), feature);
  assert.deepEqual(run.state.events.map(event => event.type), ['world-founded']);
  assert.ok(run.state.cities.every(city => !Object.values(city.improvements ?? {}).some(item => item.improvementId === 'charcoal-clearing')));
  assert.deepEqual(parseLocalSimulation(JSON.parse(JSON.stringify(run))), run);
  const invalid = structuredClone(run);
  invalid.state.unlockedFeatures = invalid.state.unlockedFeatures.filter(feature => feature !== 'charcoal-clearing');
  const before = JSON.stringify(invalid);
  assert.equal(parseLocalSimulation(invalid), null);
  assert.equal(JSON.stringify(invalid), before);
});

void test('charcoal recipe is reflected exactly once and both renderer markers use its distinct shared path', () => {
  assert.equal(improvementMark(site), 'charcoal');
  assert.match(CHARCOAL_MARK_PATH, /^M/);
  for (const detail of ['far', 'mid', 'close'] as const) {
    assert.deepEqual(improvementParts(site, detail), workedLandCompositionV1(site, charcoalClearingParts(site, detail)));
    assert.ok(improvementParts(site, detail).length <= IMPROVEMENT_PART_BUDGETS[detail]);
  }
  for (const file of ['flat-renderer.ts', 'renderer.ts']) {
    const source = readFileSync(new URL(`../web/${file}`, import.meta.url), 'utf8');
    assert.match(source, /CHARCOAL_MARK_PATH/);
    assert.match(source, /\.mark === 'charcoal' \? CHARCOAL_MARK_PATH/);
  }
});

void test('only actual forest under charcoal retains two small perimeter canopies with an empty center', () => {
  const before = JSON.stringify({ tiles, site });
  for (const detail of ['far', 'mid', 'close'] as const) {
    const result = projectLandscape(tiles, [site], detail);
    const retained = result.parts.filter(part => part.id.startsWith('charcoal-forest:0,0:') && part.shape === 'canopy');
    assert.equal(retained.length, 2);
    assert.ok(retained.every(part => Math.hypot(part.position[0], part.position[2]) - Math.max(part.scale[0], part.scale[2]) / 2 > .5));
    assert.ok(retained.every(part => part.scale[0] <= .31 && part.scale[1] <= .5));
    assert.ok(!result.parts.some(part => part.id === 'ground:0,0'));
    const unchanged = projectLandscape(tiles, [], detail).parts.filter(part => part.id.startsWith('forest:1,0:'));
    assert.deepEqual(result.parts.filter(part => part.id.startsWith('forest:1,0:')), unchanged);
    assert.ok(!projectLandscape([{ ...tiles[0]!, terrain: 'grassland' }], [site], detail).parts.some(part => part.id.startsWith('charcoal-forest:')));
    assert.ok(!projectLandscape(tiles, [{ ...site, improvementId: 'mine' }], detail).parts.some(part => part.id.startsWith('charcoal-forest:')));
    const building: ImprovementView = { ...site, status: 'building', operation: null };
    assert.deepEqual(projectLandscape(tiles, [building], detail), result);
  }
  assert.equal(JSON.stringify({ tiles, site }), before);
});

void test('retained forest is stable by site seed, independent of array order and bounded by existing landscape budgets', () => {
  const first = projectLandscape(tiles, [site], 'close');
  assert.deepEqual(first, projectLandscape(tiles.toReversed(), [site], 'close'));
  assert.notDeepEqual(first.parts, projectLandscape(tiles, [{ ...site, worldSeed: 74 }], 'close').parts);
  const many = Array.from({ length: 1000 }, (_, q) => ({ ...tiles[0]!, q }));
  const sites = many.map((tile, tileId) => ({ ...site, ...tile, tileId }));
  for (const detail of ['far', 'mid', 'close'] as const) {
    const parts = projectLandscape(many, sites, detail).parts;
    assert.ok(parts.length > 0 && parts.length <= LANDSCAPE_BUDGETS[detail]);
    assert.equal(new Set(parts.map(part => part.id)).size, parts.length);
    assert.ok(parts.every(part => [...part.position, ...part.scale, part.rotation].every(Number.isFinite)));
  }
});

void test('flat faces and Three instances consume the same retained-forest projection without a graphics-context claim', () => {
  const world = { ...projectWorld(createWorld(73)), tiles, cities: [], districts: [], improvements: [site], wonders: [] };
  const material = new THREE.MeshBasicMaterial();
  const layer = createLandscapeMeshes(world, () => material);
  layer.update(60);
  const expected = projectLandscape(tiles, [site], 'close').parts;
  assert.equal(layer.group.children.filter(child => child instanceof THREE.InstancedMesh).reduce((sum, mesh) => sum + mesh.count, 0), expected.length);
  const faces = flatSceneFaces(expected);
  assert.ok(faces.some(face => face.part.id.startsWith('charcoal-forest:')));
  const center = hexPosition(site.q, site.r);
  assert.deepEqual(center, { x: 0, z: 0 });
  layer.dispose(); material.dispose();
});
