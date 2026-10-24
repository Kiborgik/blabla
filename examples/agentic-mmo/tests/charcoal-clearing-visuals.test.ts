import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ImprovementOperationResult } from '../core/types.ts';
import { charcoalClearingParts } from '../visuals/charcoal-clearing-visuals.ts';
import { IMPROVEMENT_PART_BUDGETS } from '../visuals/improvement-visuals.ts';
import type { ImprovementView } from '../visuals/improvement-visuals.ts';
import { VISUAL_PALETTE } from '../visuals/visual-language.ts';
import type { DetailLevel, VisualPart } from '../visuals/world-visuals.ts';

const details: readonly DetailLevel[] = ['far', 'mid', 'close'];

function fixture(): ImprovementView {
  return {
    id: 'conditional:forest-town:charcoal-clearing:56', cityId: 'forest-town', townName: 'Forest town', civId: 0,
    improvementId: 'charcoal-clearing', name: 'Charcoal clearing', tileId: 56, worldSeed: 1701,
    q: 2, r: 3, height: .4, color: '#8eaa53', status: 'built', construction: null,
    completion: { kind: 'improvement', orderId: 'conditional:charcoal:56', cityId: 'forest-town', improvementId: 'charcoal-clearing',
      tileId: 56, startedRound: 2, completedRound: 4, paid: { materials: 8, credits: 4 }, workRequired: 4, eventId: 'conditional:4' },
    operation: { enabled: true, lastResult: null }, baseProduction: { energy: 1 }, residentsRequired: 1,
  };
}

function result(status: ImprovementOperationResult['status'] = 'operated'): ImprovementOperationResult {
  return {
    round: 5, status, paid: status === 'operated' ? { materials: 1 } : {}, produced: status === 'operated' ? { energy: 1 } : {},
    inputs: [{ resource: 'materials', required: 1, available: status === 'blocked' ? 0 : 2 }],
    shortages: status === 'blocked' ? [{ resource: 'materials', required: 1, available: 0 }] : [],
    residents: { ruleVersion: 1, openingPopulation: 12, communityReserve: 3, required: 1, available: 3, allocated: status === 'operated' ? 1 : 0 },
    blockedReason: status === 'blocked' ? 'input-shortage' : null,
  };
}

function part(parts: readonly VisualPart[], suffix: string): VisualPart {
  const value = parts.find(entry => entry.id.endsWith(`:charcoal-${suffix}`));
  assert.ok(value, suffix);
  return value;
}

function freeze(value: object): void {
  Object.freeze(value);
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
}

function withoutCues(parts: readonly VisualPart[]): VisualPart[] {
  return parts.filter(entry => !entry.id.includes(':charcoal-recorded-'));
}

await test('a compact dark working pad, low earthen mound and short perimeter wood stacks remain distinct at every LOD', () => {
  assert.deepEqual(IMPROVEMENT_PART_BUDGETS, { far: 10, mid: 15, close: 20 });
  for (const detail of details) {
    const parts = charcoalClearingParts(fixture(), detail);
    assert.equal(parts.length, detail === 'far' ? 8 : detail === 'mid' ? 12 : 16);
    const pad = part(parts, 'working-pad');
    const mound = part(parts, 'mound');
    assert.equal(pad.shape, 'cylinder');
    assert.equal(pad.material, 'timber');
    assert.equal(mound.shape, 'canopy');
    assert.equal(mound.material, 'soil');
    assert.equal(part(parts, 'mound-foot').material, 'soil');
    assert.ok(mound.scale[1] < mound.scale[0] / 2);
    assert.ok(mound.position[1] + mound.scale[1] / 2 <= .36);
    assert.ok(mound.scale[0] < pad.scale[0]);
    assert.ok(mound.scale[2] < pad.scale[2]);
    assert.equal(parts.filter(entry => entry.material === 'identity').length, 1);
    for (const pile of [0, 1]) {
      for (const row of [0, 1]) {
        const log = part(parts, `wood-${pile}-lower-${row}`);
        assert.equal(log.shape, 'box');
        assert.equal(log.material, 'timber');
        assert.ok(log.scale[0] >= .36 && log.scale[0] <= .42);
        assert.ok(log.scale[1] <= .07 && log.scale[2] <= .08);
        assert.ok(Math.hypot(log.position[0], log.position[2]) > .3);
      }
    }
    assert.ok(parts.every(entry => !/house|shelter|roof|water|opening|portal|spoil|track|net|strip|retaining|skull|weapon|chimney|tree/.test(entry.id)));
    assert.ok(parts.every(entry => entry.material === 'identity' || Object.hasOwn(VISUAL_PALETTE, entry.material)));
    assert.equal(parts.filter(entry => entry.id.includes(':charcoal-survey-')).length, 0);
    assert.equal(parts.filter(entry => entry.id.includes(':charcoal-recorded-')).length, 0);
  }
});

await test('unfinished construction has only identity and survey stakes, never finished inventory or operating cues', () => {
  const built = fixture();
  const view: ImprovementView = { ...built, status: 'building', completion: null, operation: null,
    construction: { kind: 'improvement', id: 'conditional:charcoal:56', cityId: built.cityId, improvementId: built.improvementId,
      tileId: built.tileId, ruleVersion: 1, startedRound: 2, paid: { materials: 8, credits: 4 }, workRequired: 4, workDone: 1 } };
  for (const detail of details) {
    const pending = charcoalClearingParts(view, detail);
    assert.equal(pending.length, 5);
    assert.equal(pending.filter(entry => entry.id.includes(':charcoal-survey-')).length, 4);
    assert.ok(pending.every(entry => entry.material === 'identity' || entry.material === 'timber'));
    assert.ok(pending.every(entry => entry.shape === 'box'));
    assert.deepEqual(part(pending, 'identity'), part(charcoalClearingParts(built, detail), 'identity'));
    assert.deepEqual(charcoalClearingParts({ ...view, construction: { ...view.construction!, workDone: 3 },
      operation: { enabled: true, lastResult: result() } }, detail), pending);
  }
});

await test('completed inventory survives absent, paused and input or resident shortage receipts without heat or smoke', () => {
  const view = fixture();
  const blocked = result('blocked');
  const inactive: ImprovementView['operation'][] = [
    null,
    { enabled: true, lastResult: null },
    { enabled: false, lastResult: result() },
    { enabled: false, lastResult: result('paused') },
    { enabled: true, lastResult: result('paused') },
    { enabled: true, lastResult: blocked },
    { enabled: true, lastResult: { ...blocked, blockedReason: 'resident-shortage', inputs: [], shortages: [] } },
    { enabled: true, lastResult: { ...blocked, blockedReason: 'site-ineligible' } },
    { enabled: true, lastResult: { ...blocked, produced: { energy: 999 } } },
    { enabled: true, lastResult: { ...result('paused'), produced: { energy: 999 } } },
  ];
  for (const detail of details) {
    const baseline = charcoalClearingParts(view, detail);
    for (const operation of inactive) {
      assert.deepEqual(charcoalClearingParts({ ...view, operation, baseProduction: { energy: 999 } }, detail), baseline);
    }
  }
});

await test('small recorded smoke and heat require finite positive Energy in an enabled built operation receipt', () => {
  const view = fixture();
  const operated = { ...view, operation: { enabled: true, lastResult: result() } };
  for (const detail of details) {
    const baseline = charcoalClearingParts(view, detail);
    const actual = charcoalClearingParts(operated, detail);
    assert.equal(actual.length, baseline.length + (detail === 'far' ? 0 : detail === 'mid' ? 1 : 2));
    assert.deepEqual(withoutCues(actual), baseline);
    for (const produced of [{}, { energy: 0 }, { energy: -1 }, { materials: 3 }, { energy: Number.NaN }, { energy: Infinity }]) {
      assert.deepEqual(charcoalClearingParts({ ...view, operation: { enabled: true, lastResult: { ...result(), produced } } }, detail), baseline);
    }
    assert.deepEqual(charcoalClearingParts({ ...operated, operation: { enabled: true,
      lastResult: { ...result(), round: 99, paid: { materials: 42 }, produced: { energy: .01 } } } }, detail), actual);
  }
  const close = charcoalClearingParts(operated, 'close');
  const smoke = part(close, 'recorded-smoke');
  const heat = part(close, 'recorded-heat');
  assert.equal(smoke.shape, 'canopy');
  assert.equal(smoke.material, 'rockLight');
  assert.equal(heat.material, 'roof');
  assert.ok(smoke.scale.every(value => value <= .12));
  assert.ok(heat.scale.every(value => value <= .05));
});

await test('immutable world seed and tile choose bounded orientations and wood-pile variation without random draws', t => {
  const random = t.mock.method(Math, 'random', () => { throw new Error('visual geometry must not draw runtime randomness'); });
  const original = fixture();
  const orientations = new Set<number>();
  const piles = new Set<string>();
  for (const worldSeed of [0, 1, 1701, 90421]) for (const tileId of [0, 56, 57, 83]) {
    const view = { ...original, worldSeed, tileId };
    const parts = charcoalClearingParts(view, 'close');
    orientations.add(part(parts, 'working-pad').rotation);
    piles.add(JSON.stringify(parts.filter(entry => entry.id.includes(':charcoal-wood-'))));
    assert.ok(Math.abs(part(parts, 'working-pad').rotation) <= Math.PI / 8);
    assert.equal(part(parts, 'working-pad').rotation, part(parts, 'mound').rotation);
    for (const detail of details) {
      const current = charcoalClearingParts(view, detail);
      assert.deepEqual(charcoalClearingParts({ ...view, cityId: 'renamed-town', name: 'Renamed clearing', townName: 'Renamed town',
        color: '#ffffff', civId: 4, q: 20, r: -5, height: 1.5, baseProduction: { energy: 88 }, residentsRequired: 30,
        completion: { ...view.completion!, completedRound: 99, paid: { materials: 80, credits: 22 } },
        operation: { enabled: true, lastResult: { ...result('blocked'), round: 99 } } }, detail), current);
    }
  }
  assert.equal(orientations.size, 16);
  assert.equal(piles.size, 16);
  const unseeded = { ...original };
  delete unseeded.worldSeed;
  assert.deepEqual(charcoalClearingParts(unseeded, 'close'), charcoalClearingParts({ ...original, worldSeed: 0 }, 'close'));
  assert.equal(random.mock.callCount(), 0);
});

await test('raw recipe leaves owner composition unapplied and site IDs affect only returned identifiers', () => {
  const view = fixture();
  for (const detail of details) {
    const raw = charcoalClearingParts(view, detail);
    assert.equal(part(raw, 'identity').position[0], -.64);
    for (const cityId of ['city-0', 'city-1', 'city-2', 'city-3']) assert.deepEqual(charcoalClearingParts({ ...view, cityId }, detail), raw);
    const renamed = charcoalClearingParts({ ...view, id: 'another-id' }, detail);
    assert.deepEqual(renamed.map(entry => ({ ...entry, id: entry.id.replace('another-id', view.id) })), raw);
  }
});

await test('LOD only adds details and keeps common part IDs, geometry and anchors stable through repeated threshold visits', () => {
  for (const operation of [null, { enabled: true, lastResult: result() }, { enabled: true, lastResult: result('blocked') }]) {
    const view = { ...fixture(), operation };
    const close = charcoalClearingParts(view, 'close');
    for (const detail of ['far', 'mid', 'far', 'mid', 'close', 'mid', 'close'] as const) {
      const current = charcoalClearingParts(view, detail);
      assert.deepEqual(current, charcoalClearingParts(view, detail));
      for (const entry of current) assert.deepEqual(entry, close.find(candidate => candidate.id === entry.id));
    }
  }
});

await test('frozen inputs stay unchanged and returned finite parts remain detached, compact and within unchanged budgets', () => {
  for (const worldSeed of [0, 1, 1701, 90421]) for (const tileId of [0, 56, 57, 83]) {
    for (const status of ['building', 'built'] as const) {
      const view = { ...fixture(), worldSeed, tileId, status, operation: { enabled: true, lastResult: result() } };
      const before = structuredClone(view);
      freeze(view);
      for (const detail of details) {
        const parts = charcoalClearingParts(view, detail);
        assert.ok(parts.length <= IMPROVEMENT_PART_BUDGETS[detail]);
        assert.equal(new Set(parts.map(entry => entry.id)).size, parts.length);
        for (const entry of parts) {
          assert.ok([...entry.position, ...entry.scale, entry.rotation].every(Number.isFinite));
          assert.ok(entry.scale.every(value => value > 0));
          const halfX = Math.abs(Math.cos(entry.rotation)) * entry.scale[0] / 2 + Math.abs(Math.sin(entry.rotation)) * entry.scale[2] / 2;
          const halfZ = Math.abs(Math.sin(entry.rotation)) * entry.scale[0] / 2 + Math.abs(Math.cos(entry.rotation)) * entry.scale[2] / 2;
          assert.ok(Math.abs(entry.position[0]) + halfX <= .75, entry.id);
          assert.ok(Math.abs(entry.position[2]) + halfZ <= .75, entry.id);
          assert.ok(entry.position[1] - entry.scale[1] / 2 >= -1e-9, entry.id);
          assert.ok(entry.position[1] + entry.scale[1] / 2 <= .55, entry.id);
        }
        parts[0]!.position = [99, 99, 99];
        parts[1]!.scale = [99, 99, 99];
        assert.ok(charcoalClearingParts(view, detail).every(entry => entry.position[0] !== 99 && entry.scale[0] !== 99));
      }
      assert.deepEqual(view, before);
    }
  }
});
