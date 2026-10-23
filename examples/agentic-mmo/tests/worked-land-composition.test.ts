import assert from 'node:assert/strict';
import { test } from 'node:test';
import { improvementParts, IMPROVEMENT_PART_BUDGETS } from '../visuals/improvement-visuals.ts';
import type { ImprovementView } from '../visuals/improvement-visuals.ts';
import { workedLandCompositionV1 } from '../visuals/worked-land-composition.ts';
import type { VisualPart } from '../visuals/world-visuals.ts';
import { flatSceneFaces, transformedVertices } from '../web/settlement-parts.ts';

function site(improvementId: string, tileId = 56): ImprovementView {
  return { id: `site:${improvementId}:${tileId}`, cityId: 'frontier', townName: 'Frontier', civId: 0, improvementId,
    name: improvementId, tileId, q: 2, r: -3, height: .4, color: '#659ac7', status: 'built', construction: null,
    completion: null, operation: { enabled: true, lastResult: null }, baseProduction: { materials: 2.4 }, residentsRequired: 1 };
}

const probe: VisualPart = { id: 'identity-probe', shape: 'box', material: 'identity', position: [1, 2, 3], scale: [.2, .3, .4], rotation: .35 };
const pointKey = (point: readonly number[]): string => point.map(value => Math.round(value * 1e8) / 1e8).join(',');

await test('versioned worked-land identity chooses stable reflection from city, tile and improvement only', () => {
  for (const [cityId, tileId, improvementId, sign] of [
    ['frontier', 56, 'mine', -1], ['frontier', 57, 'mine', 1], ['frontier-2', 56, 'mine', 1],
    ['frontier', 56, 'lumber-mill', 1], ['frontier', 56, 'pasture', 1], ['frontier', 57, 'pasture', -1],
  ] as const) {
    const identity = { cityId, tileId, improvementId };
    const actual = workedLandCompositionV1(identity, [probe]);
    assert.equal(actual[0]?.position[0], sign);
    assert.equal(actual[0]?.rotation, probe.rotation * sign);
    assert.deepEqual(workedLandCompositionV1(structuredClone(identity), [probe]), actual);
  }
});

await test('whole-composition reflection preserves rotated face geometry, dimensions, heights, depths and part identity without mutation', () => {
  const parts: VisualPart[] = (['box', 'gable', 'cylinder', 'cone'] as const).map((shape, index) => ({
    ...probe, id: `part:${shape}`, shape, position: [.2 + index * .1, .5 + index * .2, -.3 + index * .1], rotation: .27 + index * .19,
  }));
  const before = structuredClone(parts);
  const reflected = workedLandCompositionV1(site('mine'), parts);
  assert.equal(reflected.length, parts.length);
  for (const [index, source] of parts.entries()) {
    const part = reflected[index]; assert.ok(part);
    assert.deepEqual(part, { ...source, position: [-source.position[0], source.position[1], source.position[2]], rotation: -source.rotation });
    const expectedVertices = transformedVertices(source).map(([x, y, z]) => pointKey([-x, y, z])).sort();
    assert.deepEqual(transformedVertices(part).map(pointKey).sort(), expectedVertices);
    assert.ok(flatSceneFaces([part], .72).length > 0);
  }
  assert.deepEqual(parts, before);
  assert.deepEqual(workedLandCompositionV1(site('mine', 57), parts), before);
});

await test('all three real worked-land recipes reflect every part together at every bounded detail', () => {
  for (const improvementId of ['mine', 'lumber-mill', 'pasture']) for (const status of ['building', 'built'] as const) {
    const left = { ...site(improvementId), status };
    const right = { ...site(improvementId, 57), status };
    for (const detail of ['far', 'mid', 'close'] as const) {
      const first = improvementParts(left, detail);
      const second = improvementParts(right, detail);
      assert.ok(first.length > 0 && first.length <= IMPROVEMENT_PART_BUDGETS[detail]);
      assert.equal(second.length, first.length);
      for (const [index, original] of first.entries()) {
        const reflected = second[index]; assert.ok(reflected);
        assert.deepEqual(reflected, { ...original, id: original.id.replace(left.id, right.id),
          position: [-original.position[0], original.position[1], original.position[2]], rotation: -original.rotation });
      }
      for (const parts of [first, second]) {
        assert.equal(new Set(parts.map(part => part.id)).size, parts.length);
        assert.ok(parts.flatMap(transformedVertices).every(point => point.every(Number.isFinite) && Math.abs(point[0]) <= .9 && Math.abs(point[2]) <= .9));
        const visible = new Set(flatSceneFaces(parts, .72).map(face => face.part.id));
        assert.ok(parts.every(part => visible.has(part.id)));
      }
    }
  }
});

await test('site orientation survives construction completion, pause, later receipts and renamed display identities', () => {
  for (const improvementId of ['mine', 'lumber-mill', 'pasture']) for (const tileId of [56, 57]) {
    const built = site(improvementId, tileId);
    const active: ImprovementView = { ...built, id: `active:order:${tileId}`, status: 'building', operation: null,
      construction: { kind: 'improvement', id: `order:${tileId}`, cityId: built.cityId, improvementId, tileId, ruleVersion: 1, startedRound: 2, paid: { materials: 6, credits: 3 }, workRequired: 4, workDone: 1 } };
    const renamed: ImprovementView = { ...built, id: `new-display:${tileId}`, townName: 'Renamed', name: 'Renamed site', color: '#ffffff',
      baseProduction: { materials: 999 }, residentsRequired: 9,
      operation: { enabled: false, lastResult: { round: 99, status: 'paused', paid: {}, produced: {}, residents: { ruleVersion: 1, openingPopulation: 12, communityReserve: 3, required: 1, available: 9, allocated: 0 }, blockedReason: null } },
      completion: { kind: 'improvement', orderId: 'later-record', cityId: built.cityId, improvementId, tileId, startedRound: 80, completedRound: 90, paid: { credits: 99 }, workRequired: 4, eventId: 'later-event' } };
    const inputs = [built, active, renamed];
    const before = structuredClone(inputs);
    const orientation = new Set<number>();
    for (const detail of ['far', 'mid', 'close'] as const) {
      const installed = improvementParts(built, detail);
      const construction = improvementParts(active, detail);
      assert.deepEqual(improvementParts(renamed, detail).map(part => ({ ...part, id: part.id.replace(renamed.id, built.id) })), installed);
      const identity = installed.find(part => part.material === 'identity'); assert.ok(identity);
      orientation.add(Math.sign(identity.position[0]));
      const reservedIdentity = construction.find(part => part.material === 'identity'); assert.ok(reservedIdentity);
      assert.deepEqual(reservedIdentity, { ...identity, id: identity.id.replace(built.id, active.id) });
      assert.ok(construction.some(part => part.id.includes('survey')));
      assert.ok(construction.every(part => !/:(opening|spoil|lumber-roof|lumber-saw|lumber-stack-|pasture-shelter)/.test(part.id)));
    }
    assert.equal(orientation.size, 1);
    assert.deepEqual(inputs, before);
  }
});

await test('far Pasture retains its existing shelter support within the unchanged ten-part budget', () => {
  assert.deepEqual(IMPROVEMENT_PART_BUDGETS, { far: 10, mid: 15, close: 20 });
  for (const tileId of [56, 57]) for (const detail of ['far', 'mid', 'close'] as const) {
    const view = site('pasture', tileId);
    const parts = improvementParts(view, detail);
    const wall = parts.find(part => part.id.endsWith(':pasture-shelter-wall')); assert.ok(wall);
    const roof = parts.find(part => part.id.endsWith(':pasture-shelter-roof')); assert.ok(roof);
    assert.equal(wall.shape, 'box'); assert.equal(wall.material, 'timber');
    assert.deepEqual(wall.scale, [.6, .44, .4]);
    assert.deepEqual([wall.position[0], wall.position[2]], [roof.position[0], roof.position[2]]);
    assert.ok(wall.position[1] + wall.scale[1] / 2 >= roof.position[1] - roof.scale[1] / 2);
    assert.deepEqual(improvementParts({ ...view, operation: { enabled: false, lastResult: null } }, detail), parts);
    assert.ok(parts.length <= IMPROVEMENT_PART_BUDGETS[detail]);
    assert.ok(improvementParts({ ...view, status: 'building', operation: null }, detail).every(part => !part.id.includes('shelter')));
  }
});
