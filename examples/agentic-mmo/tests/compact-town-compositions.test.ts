import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS } from '../core/content.ts';
import { createWorld } from '../core/engine.ts';
import { CIVILIZATION_IDENTITIES, civilizationIdentity, settlementDetail } from '../visuals/visual-language.ts';
import { settlementVisual, SETTLEMENT_RENDER_SCALE, DETAIL_BUDGETS } from '../visuals/world-visuals.ts';
import type { SettlementFacts, VisualPart } from '../visuals/world-visuals.ts';
import { districtParts, districtLandmarks } from '../visuals/district-visuals.ts';
import { projectWorld } from '../web/live-world.ts';
import { flatSceneFaces, transformedVertices } from '../web/settlement-parts.ts';
import { hexPosition } from '../web/atlas.ts';

const city: SettlementFacts = { id: 'compact', civId: 0, tileId: 4, name: 'Compact', population: 40, wellbeing: 65, damage: 0, buildings: [] };
const standalone = ['granary', 'launchpad', 'water-mill', 'aqueduct', 'farm', 'workshop', 'irrigation', 'kiln', 'academy', 'monument', 'boat-yard', 'fuel-yard'];
const footprint = (parts: readonly VisualPart[], scale = 1): number => Math.max(...parts.flatMap(part => transformedVertices(part).map(([x, , z]) => Math.hypot(x, z) * scale)));

await test('overview has one installed landmark, not a carpet; inspection inventory remains exact at all urban LODs', () => {
  const buildings = BUILDINGS.map(building => building.id);
  const source = { ...city, buildings, population: 10000 };
  const before = structuredClone(source);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const visual = settlementVisual(source, detail);
    assert.equal(visual.landmarks.length, detail === 'far' ? 1 : detail === 'mid' ? 2 : 3);
    assert.equal(visual.landmarks[0], 'launchpad');
    assert.equal(visual.landmarks.length + visual.summarizedBuildings.length, buildings.length);
    assert.equal(visual.buildings.length, buildings.length);
    assert.equal(visual.population, 10000);
    assert.ok(visual.parts.length <= DETAIL_BUDGETS[detail].parts);
    for (const id of standalone) assert.equal(visual.parts.some(part => part.id.startsWith(`${id}-`)), visual.landmarks.includes(id), `${detail}: ${id}`);
    assert.deepEqual(settlementVisual({ ...source, buildings: buildings.toReversed() }, detail), visual);
  }
  assert.deepEqual(source, before);
});

await test('town and district footprints leave geographic lanes between neighboring exact tiles without shrinking their landmark heights', () => {
  const neighbors = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]] as const;
  for (const civId of [0, 1, 2, 3, 4]) for (const detail of ['far', 'mid', 'close'] as const) {
    const visual = settlementVisual({ ...city, civId, buildings: standalone, damage: 100 }, detail);
    const radius = footprint(visual.parts, SETTLEMENT_RENDER_SCALE);
    assert.ok(radius <= .76, `${detail}: ${radius}`);
    for (const [q, r] of neighbors) {
      const other = hexPosition(q, r);
      assert.ok(Math.hypot(other.x, other.z) - radius * 2 >= .2);
    }
    const gantry = visual.parts.find(part => part.id === 'launchpad-gantry');
    assert.ok(gantry && gantry.position[1] + gantry.scale[1] / 2 >= 1.5);
  }
  const state = createWorld(1701);
  const town = state.cities[0]!;
  town.buildings = ['campus', 'library', 'university', 'observatory', 'research-lab', 'industrial-zone', 'guild-workshop', 'foundry', 'coal-plant', 'factory'];
  town.districtSites = { campus: 39, 'industrial-zone': 56 };
  const world = projectWorld(state);
  for (const district of world.districts ?? []) for (const detail of ['far', 'mid', 'close'] as const) {
    const parts = districtParts(district, detail);
    assert.ok(footprint(parts) <= .8);
    assert.equal(parts.some(part => part.id.endsWith(':site')), detail === 'close');
    assert.ok(districtLandmarks(district, detail).every(id => town.buildings.includes(id)));
    assert.equal(district.tileId, town.districtSites[district.buildingId as keyof typeof town.districtSites]);
  }
});

await test('installed learning, industry, harbor and launch assets have different complete overview silhouettes', () => {
  const cores = [['academy', 'academy-portico-left'], ['workshop', 'workshop-chimney'], ['boat-yard', 'boat-yard-davit-arm'], ['launchpad', 'launchpad-service-arm']] as const;
  const silhouettes: string[] = [];
  for (const [building, core] of cores) {
    const visual = settlementVisual({ ...city, buildings: [building] }, 'far');
    assert.deepEqual(visual.landmarks, [building]);
    assert.ok(visual.parts.some(part => part.id === core));
    assert.ok(visual.parts.every(part => !/rocket|plume|operation:/.test(part.id)));
    const parts = visual.parts.filter(part => part.id.startsWith(`${building}-`));
    const faces = flatSceneFaces(parts, .72);
    assert.ok(parts.every(part => faces.some(face => face.part.id === part.id)));
    silhouettes.push(JSON.stringify(faces.map(face => face.points)));
  }
  assert.equal(new Set(silhouettes).size, cores.length);
});

await test('five original roof families and shape-readable crests distinguish even identical built inventories', () => {
  const roofs = CIVILIZATION_IDENTITIES.map((identity, civId) => {
    const visual = settlementVisual({ ...city, civId, buildings: ['academy', 'farm', 'workshop', 'boat-yard'] }, 'far');
    const home = visual.parts.filter(part => part.id.startsWith('home-0-'));
    assert.ok(home.some(part => part.id.endsWith('roof') && part.material === identity.roof && part.shape === identity.roofShape));
    assert.equal(civilizationIdentity(civId), identity);
    return JSON.stringify(home);
  });
  assert.equal(new Set(roofs).size, 5);
  assert.equal(new Set(CIVILIZATION_IDENTITIES.map(identity => identity.path)).size, 5);
  assert.deepEqual(CIVILIZATION_IDENTITIES.map(identity => identity.crest), ['Star', 'Leaf', 'Flame', 'Wave', 'Crescent']);
  assert.notEqual(civilizationIdentity(1).path, civilizationIdentity(4).path);
  assert.deepEqual([0, 1, 2, 3, 4].map(civId => settlementVisual({ ...city, civId, buildings: ['academy', 'farm', 'workshop', 'boat-yard'] }, 'far').landmarks[0]), ['academy', 'farm', 'workshop', 'boat-yard', 'academy']);
});

await test('urban LOD delays annex clutter and holds stable while the camera crosses a threshold', () => {
  assert.equal(settlementDetail(30), 'far');
  assert.equal(settlementDetail(60), 'mid');
  assert.equal(settlementDetail(110), 'close');
  assert.equal(settlementDetail(40, 'far'), 'far');
  assert.equal(settlementDetail(37, 'mid'), 'mid');
  assert.equal(settlementDetail(80, 'mid'), 'mid');
  assert.equal(settlementDetail(73, 'close'), 'close');
  assert.equal(settlementDetail(Number.NaN), 'far');
});

await test('geometry summaries never invent central districts or let hidden operations emit orphan smoke', () => {
  const districtOnly = settlementVisual({ ...city, buildings: ['campus', 'library', 'industrial-zone', 'factory'] }, 'close');
  assert.deepEqual(districtOnly.landmarks, []);
  assert.equal(districtOnly.buildings.length, 4);
  assert.ok(districtOnly.parts.every(part => part.id.startsWith('home-')));
  const active = { ...city, buildings: ['launchpad', 'kiln'], round: 8, buildingOperations: { kiln: { enabled: true, lastResult: { round: 8, status: 'operated' as const, paid: { energy: 2 }, produced: { materials: 4 }, shortages: [] } } } };
  const far = settlementVisual(active, 'far');
  assert.ok(!far.parts.some(part => part.id.startsWith('operation:')));
  assert.ok(settlementVisual(active, 'mid').parts.some(part => part.id === 'operation:kiln:smoke'));
  assert.ok(!settlementVisual({ ...active, terminal: true }, 'close').parts.some(part => part.id.startsWith('operation:')));
});

await test('seeded internal layouts leave all external geographic projections at their exact recorded sites', () => {
  const state = createWorld(1701);
  const town = state.cities[0]!;
  town.buildings = ['academy', 'campus', 'library', 'industrial-zone', 'factory'];
  town.districtSites = { campus: 39, 'industrial-zone': 56 };
  const before = structuredClone(state);
  const baseline = projectWorld(state);
  const varied = projectWorld({ ...state, seed: 999 });
  for (const key of ['districts', 'improvements', 'pastoralSites', 'catchments', 'wonders', 'deposits', 'routes', 'tiles'] as const) assert.deepEqual(varied[key], baseline[key], key);
  assert.deepEqual(varied.cities.map(value => [value.cityId, value.q, value.r]), baseline.cities.map(value => [value.cityId, value.q, value.r]));
  assert.notDeepEqual(settlementVisual(varied.cities[0]!.settlement!, 'close').parts, settlementVisual(baseline.cities[0]!.settlement!, 'close').parts);
  assert.deepEqual(state, before);
});
