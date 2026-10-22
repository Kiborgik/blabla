import assert from 'node:assert/strict';
import { test } from 'node:test';
import { improvementLabel, improvementParts, IMPROVEMENT_PART_BUDGETS } from '../visuals/improvement-visuals.ts';
import type { ImprovementView } from '../visuals/improvement-visuals.ts';
import { flatSceneFaces, transformedVertices } from '../web/settlement-parts.ts';

function site(improvementId: 'mine' | 'lumber-mill'): ImprovementView {
  return { id: `site:${improvementId}:56`, cityId: 'frontier', townName: 'Frontier', civId: 0, improvementId,
    name: improvementId === 'mine' ? 'Mine' : 'Lumber mill', tileId: 56, q: 2, r: -3, height: .4, color: '#659ac7',
    status: 'built', construction: null, completion: null, operation: { enabled: true, lastResult: null },
    baseProduction: { materials: 2.4 }, residentsRequired: 1 };
}

await test('MID and FAR Mines read as compact low soil cuts rather than gold slabs and tall portals', () => {
  const view = site('mine');
  for (const detail of ['far', 'mid'] as const) {
    const parts = improvementParts(view, detail);
    const ground = parts.find(part => part.id.endsWith(':worked-ground')); assert.ok(ground);
    const opening = parts.find(part => part.id.endsWith(':opening')); assert.ok(opening);
    const spoil = parts.find(part => part.id.endsWith(':spoil')); assert.ok(spoil);
    assert.equal(ground.material, 'soil');
    assert.equal(opening.material, 'soil');
    assert.equal(spoil.material, 'stone');
    assert.ok(ground.scale[0] * ground.scale[2] <= 1.5);
    assert.ok(spoil.scale[0] * spoil.scale[2] <= .25);
    assert.ok(parts.every(part => part.material !== 'grain' && !part.id.includes(':portal-')));
    assert.ok(Math.max(...parts.flatMap(transformedVertices).map(point => point[1])) <= .4);
    const footprint = (material: string): number => parts.filter(part => part.material === material).reduce((area, part) => area + part.scale[0] * part.scale[2], 0);
    assert.ok(footprint('soil') > footprint('stone') + footprint('rock') + footprint('timber'));
  }
});

await test('MID and FAR Lumber mills keep a low open shelter and visible log work instead of a tall red house', () => {
  const view = site('lumber-mill');
  for (const detail of ['far', 'mid'] as const) {
    const parts = improvementParts(view, detail);
    const roof = parts.find(part => part.id.endsWith(':lumber-roof')); assert.ok(roof);
    const saw = parts.find(part => part.id.endsWith(':lumber-saw')); assert.ok(saw);
    const logs = parts.filter(part => part.id.includes(':lumber-stack-'));
    assert.ok(roof.scale[0] * roof.scale[2] <= .45);
    assert.ok(roof.position[1] + roof.scale[1] / 2 <= .5);
    assert.equal(roof.material, 'timber');
    assert.equal(saw.material, 'metal');
    assert.ok(logs.length >= 2 && logs.every(part => part.material === 'timber'));
    assert.ok(logs.every(part => part.position[2] - part.scale[2] / 2 > roof.position[2] + roof.scale[2] / 2));
    assert.ok(parts.some(part => part.id.includes(':lumber-log-ends') && part.material === 'grain'));
    assert.ok(!parts.some(part => part.id.endsWith(':lumber-wall')));
    assert.ok(Math.max(...parts.flatMap(transformedVertices).map(point => point[1])) <= .5);
  }
});

await test('CLOSE resource sites retain their recognizable portal, track, saw shelter and joinery details', () => {
  const mine = improvementParts(site('mine'), 'close');
  assert.ok(mine.some(part => part.id.endsWith(':portal-top')));
  assert.equal(mine.filter(part => part.id.includes(':track-')).length, 2);
  assert.equal(mine.filter(part => part.id.includes(':sleeper-')).length, 3);
  const mill = improvementParts(site('lumber-mill'), 'close');
  assert.ok(mill.some(part => part.id.endsWith(':lumber-wall')));
  assert.ok(mill.some(part => part.id.endsWith(':lumber-roof') && part.material === 'roof'));
  assert.equal(mill.filter(part => part.id.includes(':lumber-joist-')).length, 3);
});

await test('every resource-site LOD preserves installed, paused and construction facts without inventing output', () => {
  for (const improvementId of ['mine', 'lumber-mill'] as const) {
    const installed = site(improvementId);
    const paused: ImprovementView = { ...installed, operation: { enabled: false, lastResult: null } };
    const construction: ImprovementView = { ...installed, status: 'building', operation: null,
      construction: { kind: 'improvement', id: 'reserved:56', cityId: installed.cityId, improvementId, tileId: 56, ruleVersion: 1, startedRound: 2, paid: { materials: 6, credits: 3 }, workRequired: 4, workDone: 1 } };
    const before = structuredClone([installed, paused, construction]);
    assert.notEqual(improvementLabel(installed), improvementLabel(paused));
    assert.notEqual(improvementLabel(installed), improvementLabel(construction));
    for (const detail of ['far', 'mid', 'close'] as const) {
      const built = improvementParts(installed, detail);
      const planned = improvementParts(construction, detail);
      assert.deepEqual(improvementParts(paused, detail), built);
      assert.notDeepEqual(planned, built);
      assert.ok(planned.some(part => part.id.includes('survey')));
      assert.ok(planned.every(part => !/:(opening|spoil|lumber-roof|lumber-saw|lumber-stack-)/.test(part.id)));
      for (const parts of [built, planned]) {
        assert.ok(parts.length <= IMPROVEMENT_PART_BUDGETS[detail]);
        assert.equal(new Set(parts.map(part => part.id)).size, parts.length);
        assert.ok(parts.every(part => part.id.startsWith(installed.id)));
        assert.ok(parts.flatMap(transformedVertices).every(point => point.every(Number.isFinite) && Math.abs(point[0]) <= .9 && Math.abs(point[2]) <= .9));
        assert.ok(flatSceneFaces(parts, .72).length > 0);
      }
      assert.deepEqual(improvementParts(installed, detail), built);
      assert.deepEqual(improvementParts({ ...installed, operation: { enabled: true, lastResult: { round: 8, status: 'operated', paid: {}, produced: { materials: 99 }, residents: { ruleVersion: 1, openingPopulation: 12, communityReserve: 3, required: 1, available: 9, allocated: 1 }, blockedReason: null } } }, detail), built);
    }
    assert.deepEqual([installed, paused, construction], before);
  }
});
