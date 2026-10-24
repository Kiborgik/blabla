import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectWorld } from '../web/live-world.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { freshFixtureJourney, syntheticTechnologies } from './fixtures/coastal-prefix.ts';
import type { ImprovementOperationResult } from '../core/types.ts';
import { hillsideCommonworksParts, HILLSIDE_COMMONWORKS_MARK_PATH } from '../visuals/hillside-commonworks-visuals.ts';
import { improvementLabel, improvementLastLabel, improvementMark, improvementParts, IMPROVEMENT_PART_BUDGETS, LUMBER_MARK_PATH } from '../visuals/improvement-visuals.ts';
import type { ImprovementView } from '../visuals/improvement-visuals.ts';
import { PASTORAL_MARK_PATH } from '../visuals/pastoral-visuals.ts';
import { SHORE_FISHERY_MARK_PATH } from '../visuals/shore-fishery-visuals.ts';
import { SITE_MARK_PATHS } from '../visuals/strategic-resource-visuals.ts';
import { workedLandCompositionV1 } from '../visuals/worked-land-composition.ts';
import { ICON_PATHS, VISUAL_PALETTE } from '../visuals/world-visuals.ts';
import type { DetailLevel, VisualPart } from '../visuals/world-visuals.ts';

const details: readonly DetailLevel[] = ['far', 'mid', 'close'];

function fixture(): ImprovementView {
  return {
    id: 'conditional:upland-town:hill-commons:56', cityId: 'upland-town', townName: 'Upland town', civId: 0,
    improvementId: 'hill-commons', name: 'Hillside commonworks', tileId: 56, worldSeed: 1701,
    q: 2, r: 3, height: .4, color: '#8eaa53', status: 'built', construction: null,
    completion: { kind: 'improvement', orderId: 'conditional:commons:56', cityId: 'upland-town', improvementId: 'hill-commons',
      tileId: 56, startedRound: 2, completedRound: 5, paid: { materials: 12, credits: 6 }, workRequired: 6, eventId: 'conditional:5' },
    operation: { enabled: true, lastResult: null }, baseProduction: { food: 3 }, residentsRequired: 1,
  };
}

function result(status: ImprovementOperationResult['status'] = 'operated'): ImprovementOperationResult {
  return { round: 6, status, paid: status === 'operated' ? { materials: 1 } : {}, produced: status === 'operated' ? { food: 2.8 } : {},
    inputs: [{ resource: 'materials', required: 1, available: status === 'blocked' ? 0 : 2 }],
    shortages: status === 'blocked' ? [{ resource: 'materials', required: 1, available: 0 }] : [],
    residents: { ruleVersion: 1, openingPopulation: 12, communityReserve: 3, required: 1, available: 3, allocated: status === 'operated' ? 1 : 0 },
    blockedReason: status === 'blocked' ? 'input-shortage' : null };
}

function part(parts: readonly VisualPart[], suffix: string): VisualPart {
  const value = parts.find(entry => entry.id.endsWith(`:commons-${suffix}`));
  assert.ok(value, suffix);
  return value;
}

function freeze(value: object): void {
  Object.freeze(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
}

await test('conditional commonworks keep three low planted contours, dry retaining edges and a small open tool shelter within unchanged budgets', () => {
  assert.deepEqual(IMPROVEMENT_PART_BUDGETS, { far: 10, mid: 15, close: 20 });
  const view = fixture();
  for (const detail of details) {
    const parts = hillsideCommonworksParts(view, detail);
    assert.equal(parts.length, detail === 'far' ? 10 : detail === 'mid' ? 15 : 19);
    assert.equal(parts.filter(entry => /:commons-strip-\d$/.test(entry.id)).length, 3);
    assert.equal(parts.filter(entry => /:commons-retaining-edge-\d$/.test(entry.id)).length, 3);
    for (const row of [0, 1, 2]) {
      const strip = part(parts, `strip-${row}`);
      const edge = part(parts, `retaining-edge-${row}`);
      assert.ok(strip.material === 'crop' || strip.material === 'grain');
      assert.equal(edge.material, 'stone');
      assert.equal(edge.rotation, strip.rotation);
      assert.ok(edge.scale[0] >= strip.scale[0]);
      assert.ok(edge.scale[2] < strip.scale[2]);
      assert.ok(strip.position[1] + strip.scale[1] / 2 <= .1);
      assert.ok(Math.abs(strip.position[1] - strip.scale[1] / 2) < 1e-9);
    }
    assert.equal(part(parts, 'shelter-roof').shape, 'gable');
    assert.equal(part(parts, 'shelter-roof').material, 'timber');
    assert.equal(parts.filter(entry => /:commons-shelter-post-/.test(entry.id)).length, 2);
    assert.ok(part(parts, 'shelter-roof').scale[0] < .45);
    assert.equal(parts.filter(entry => entry.material === 'identity').length, 1);
    assert.equal(parts.filter(entry => /:commons-soil-margin-/.test(entry.id)).length, detail === 'far' ? 0 : 3);
    assert.equal(parts.filter(entry => /:commons-furrow-/.test(entry.id)).length, detail === 'close' ? 3 : 0);
    assert.ok(parts.every(entry => !/house|water|river|pipe|opening|spoil|track|smoke|glow/.test(entry.id)));
    assert.ok(parts.every(entry => entry.material === 'identity' || Object.hasOwn(VISUAL_PALETTE, entry.material)));
  }
});

await test('construction is only a quiet survey while paid built inventory survives pause and blocked or absent operation', () => {
  const built = fixture();
  const construction: ImprovementView = { ...built, status: 'building', completion: null, operation: null,
    construction: { kind: 'improvement', id: 'conditional:commons:56', cityId: built.cityId, improvementId: built.improvementId,
      tileId: built.tileId, ruleVersion: 1, startedRound: 2, paid: { materials: 12, credits: 6 }, workRequired: 6, workDone: 1 } };
  assert.equal(improvementLabel(construction), 'Hillside commonworks · Building');
  for (const detail of details) {
    const installed = improvementParts(built, detail);
    for (const operation of [null, { enabled: true, lastResult: null }, { enabled: false, lastResult: result() },
      { enabled: false, lastResult: result('paused') }, { enabled: true, lastResult: result('blocked') }]) {
      assert.deepEqual(improvementParts({ ...built, operation }, detail), installed);
    }
    const pending = improvementParts(construction, detail);
    assert.equal(pending.length, 4);
    assert.equal(pending.filter(entry => entry.id.includes(':commons-survey-')).length, 3);
    assert.ok(pending.every(entry => entry.material === 'identity' || entry.material === 'timber'));
    assert.deepEqual(part(pending, 'identity'), part(installed, 'identity'));
    assert.equal(part(pending, 'survey-line').rotation, part(installed, 'strip-0').rotation);
    assert.equal(part(pending, 'survey-line').position[0], part(installed, 'strip-0').position[0]);
    assert.equal(part(pending, 'survey-line').position[2], part(installed, 'strip-0').position[2]);
    assert.equal(part(pending, 'survey-line').scale[0], part(installed, 'strip-0').scale[0]);
    assert.deepEqual(improvementParts({ ...construction, construction: { ...construction.construction!, workDone: 5 },
      operation: { enabled: true, lastResult: result() } }, detail), pending);
  }
  assert.equal(improvementLabel({ ...built, operation: { enabled: false, lastResult: result() } }), 'Hillside commonworks · Paused');
  assert.equal(improvementLastLabel(null), 'No operating record yet');
  assert.equal(improvementLastLabel(result('blocked')), 'Not enough Materials');
  assert.equal(improvementLastLabel(result('paused')), 'Paused that season');
  assert.equal(improvementLastLabel(result()), 'Food made');
});

await test('a small static close harvest cue requires an enabled built site and an actual positive Food receipt, never a forecast', () => {
  const view = fixture();
  const operated = { ...view, operation: { enabled: true, lastResult: result() } };
  for (const detail of details) {
    const baseline = improvementParts(view, detail);
    const actual = improvementParts(operated, detail);
    assert.equal(actual.length, baseline.length + Number(detail === 'close'));
    assert.deepEqual(actual.filter(entry => !entry.id.endsWith(':commons-recorded-harvest')), baseline);
    for (const lastResult of [null, result('paused'), result('blocked'), { ...result(), produced: {} },
      { ...result(), produced: { food: 0 } }, { ...result(), produced: { materials: 3 } },
      { ...result('blocked'), produced: { food: 999 } }, { ...result('paused'), produced: { food: 999 } }]) {
      assert.deepEqual(improvementParts({ ...view, baseProduction: { food: 999 }, operation: { enabled: true, lastResult } }, detail), baseline);
    }
  }
  const cue = part(improvementParts(operated, 'close'), 'recorded-harvest');
  assert.equal(cue.material, 'grain');
  assert.ok(cue.scale.every(value => value <= .12));
  assert.equal(improvementParts(operated, 'close').length, IMPROVEMENT_PART_BUDGETS.close);
});

await test('immutable seed and tile select bounded row and crop variation without round, status, display or output driven reshuffling', () => {
  const original = fixture();
  const layouts = new Set<string>();
  const colors = new Set<string>();
  for (const worldSeed of [0, 1, 1701, 90421]) for (const tileId of [0, 56, 57, 83]) {
    const view = { ...original, worldSeed, tileId };
    const raw = hillsideCommonworksParts(view, 'close');
    const strips = raw.filter(entry => /:commons-strip-\d$/.test(entry.id));
    layouts.add(JSON.stringify(strips));
    colors.add(strips.map(entry => entry.material).join(','));
    for (const strip of strips) {
      assert.ok(Math.abs(strip.position[0]) <= .06);
      assert.ok(strip.scale[0] >= .86 && strip.scale[0] <= 1.24);
      assert.ok(Math.abs(strip.rotation) <= .055);
    }
    for (const detail of details) {
      const current = improvementParts(view, detail);
      assert.deepEqual(current, workedLandCompositionV1(view, hillsideCommonworksParts(view, detail)));
      assert.deepEqual(improvementParts({ ...view, name: 'Renamed site', townName: 'Renamed town', color: '#ffffff', civId: 4,
        q: 20, r: -5, height: 1.5, baseProduction: { food: 88 }, residentsRequired: 30,
        completion: { ...view.completion!, completedRound: 99, paid: { materials: 80, credits: 22 } },
        operation: { enabled: true, lastResult: { ...result('blocked'), round: 99 } } }, detail), current);
      const operated = { ...view, operation: { enabled: true, lastResult: result() } };
      assert.deepEqual(improvementParts({ ...operated, operation: { enabled: true,
        lastResult: { ...result(), round: 99, paid: { materials: 42 }, produced: { food: 999 } } } }, detail), improvementParts(operated, detail));
    }
  }
  assert.equal(layouts.size, 16);
  assert.ok(colors.size > 1);
  const unseeded = { ...original };
  delete unseeded.worldSeed;
  assert.deepEqual(hillsideCommonworksParts(unseeded, 'close'), hillsideCommonworksParts({ ...original, worldSeed: 0 }, 'close'));
});

await test('LOD only adds details and keeps shared immutable part IDs, topology and anchors through threshold revisits', () => {
  for (const operation of [null, { enabled: true, lastResult: result() }, { enabled: true, lastResult: result('blocked') }]) {
    const view = { ...fixture(), operation };
    const close = improvementParts(view, 'close');
    for (const detail of ['far', 'mid', 'far', 'mid', 'close', 'mid', 'close'] as const) {
      const current = improvementParts(view, detail);
      assert.deepEqual(current, improvementParts(view, detail));
      for (const entry of current) assert.deepEqual(entry, close.find(candidate => candidate.id === entry.id));
    }
  }
});

await test('pure geometry keeps frozen receipt inputs unchanged and returns detached finite parts inside the compact site envelope', () => {
  const view = { ...fixture(), operation: { enabled: true, lastResult: result() } };
  const before = structuredClone(view);
  freeze(view);
  for (const detail of details) {
    const parts = improvementParts(view, detail);
    assert.ok(parts.length <= IMPROVEMENT_PART_BUDGETS[detail]);
    assert.equal(new Set(parts.map(entry => entry.id)).size, parts.length);
    for (const entry of parts) {
      assert.ok([...entry.position, ...entry.scale, entry.rotation].every(Number.isFinite));
      assert.ok(entry.scale.every(value => value > 0));
      const halfX = Math.abs(Math.cos(entry.rotation)) * entry.scale[0] / 2 + Math.abs(Math.sin(entry.rotation)) * entry.scale[2] / 2;
      const halfZ = Math.abs(Math.sin(entry.rotation)) * entry.scale[0] / 2 + Math.abs(Math.cos(entry.rotation)) * entry.scale[2] / 2;
      assert.ok(Math.abs(entry.position[0]) + halfX <= .8);
      assert.ok(Math.abs(entry.position[2]) + halfZ <= .75);
      assert.ok(entry.position[1] - entry.scale[1] / 2 >= -1e-9);
      assert.ok(entry.position[1] + entry.scale[1] / 2 <= .4);
    }
    parts[0]!.position = [99, 99, 99];
    assert.ok(improvementParts(view, detail).every(entry => entry.position[0] !== 99));
  }
  assert.deepEqual(view, before);
});

await test('the original commons glyph is distinct from town fields and mine, pasture, fishery and mill marks', () => {
  assert.equal(improvementMark({ improvementId: 'hill-commons' }), 'commons');
  assert.equal(improvementMark({ improvementId: 'mine' }), 'mine');
  assert.equal(improvementMark({ improvementId: 'pasture' }), 'pasture');
  assert.equal(improvementMark({ improvementId: 'shore-fishery' }), 'fishery');
  assert.equal(improvementMark({ improvementId: 'lumber-mill' }), 'lumber');
  assert.equal(HILLSIDE_COMMONWORKS_MARK_PATH, 'M3 21Q12 16 21 21M4 16Q10 12 16 15M6 11Q10 8 14 10M15 6L19 3L23 6M16 6V10M22 6V10');
  assert.equal(new Set([HILLSIDE_COMMONWORKS_MARK_PATH, ICON_PATHS.farm, SITE_MARK_PATHS.mine, PASTORAL_MARK_PATH,
    SHORE_FISHERY_MARK_PATH, LUMBER_MARK_PATH]).size, 6);
});

await test('actual paid construction and operation project immutable world seed and exact detached commons receipt without extra assets', () => {
  let tileId = -1;
  const run = freshFixtureJourney('settlement-hillside-commonworks-1', state => {
    syntheticTechnologies(state, 0, ['masonry', 'water-management']);
    const city = state.cities.find(item => item.id === 'city-0')!;
    const center = state.tiles.find(tile => tile.id === city.tileId)!;
    const tile = state.tiles.find(tile => hexDistance(center, tile) === 1 && !state.cities.some(city => city.tileId === tile.id)
      && !state.strategicDeposits?.deposits[String(tile.id)] && !state.coalDeposits?.deposits[String(tile.id)] && !state.pastoralSites?.sites[String(tile.id)]);
    assert.ok(tile); tile.terrain = 'grassland'; tile.elevation = 70; tile.owner = 0; tileId = tile.id;
  }, 'Synthetic known prerequisites and one owned grassland hill; actual paid construction and strategic operating beats follow');
  run.act({ type: 'improve', cityId: 'city-0', tileId, improvementId: 'hill-commons' });
  const building = projectWorld(run.state).improvements?.find(site => site.tileId === tileId);
  assert.ok(building); assert.equal(building.status, 'building'); assert.equal(building.worldSeed, run.state.seed);
  assert.equal(building.operation, null); assert.equal(building.completion, null);
  run.until(() => !run.state.cities[0]!.construction?.active, 'Paid six-work completion', 16);
  run.beat();
  const before = structuredClone(run.state);
  const projected = projectWorld(run.state);
  const view = projected.improvements?.find(site => site.tileId === tileId);
  assert.ok(view); assert.equal(view.worldSeed, run.state.seed); assert.equal(view.cityId, 'city-0');
  assert.equal(view.improvementId, 'hill-commons'); assert.equal(view.status, 'built');
  assert.deepEqual(view.completion?.paid, { materials: 12, credits: 6 });
  assert.equal(view.operation?.lastResult?.status, 'operated');
  assert.deepEqual(view.operation?.lastResult?.paid, { materials: 1 });
  assert.ok((view.operation?.lastResult?.produced.food ?? 0) > 0);
  assert.deepEqual(view.operation, run.state.cities[0]!.improvements![String(tileId)]!.operation);
  assert.equal(projected.improvements?.length, run.state.cities.reduce((sum, city) => sum + Object.keys(city.improvements ?? {}).length, 0));
  view.operation!.lastResult!.produced.food = 999;
  assert.deepEqual(run.state, before);
});
