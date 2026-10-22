import { allocateBuildingParts, buildingAppearance, buildingAppearances, buildingIdentity } from '../visuals/building-visuals.ts';
import { BUILDINGS } from '../core/content.ts';
import { damageCondition, damageMapLabel, damageParts } from '../visuals/damage-visuals.ts';
import { operationVisual } from '../visuals/operation-visuals.ts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import type { GameEvent } from '../core/types.ts';
import {
  DETAIL_BUDGETS, ICON_PATHS, createEventCueTracker, eventVisual, projectWorldVisuals,
  settlementVisual, visualDetail,
} from '../visuals/world-visuals.ts';

const city = { id: 'hearth', civId: 0, tileId: 4, name: 'Dawnwell', population: 6, wellbeing: 67, damage: 0, buildings: [] as string[] };
const event = (overrides: Partial<GameEvent> = {}): GameEvent => ({
  id: '1:0', round: 1, type: 'drought', title: 'The rains fail: Aster', detail: 'A dry season',
  actor: 5, target: 0, tileId: 4, cause: 'A recorded weather event', importance: 4,
  effects: ['Aster food 24.2 → 12.2', 'Dawnwell wellbeing 67 → 57'], ...overrides,
});

await test('committed buildings create distinct original parts, without fictional infrastructure', () => {
  const empty = settlementVisual(city, 'mid');
  assert.ok(empty.parts.every((part) => part.id.startsWith('home-')));
  assert.equal(empty.buildings.length, 0);
  const built = settlementVisual({ ...city, buildings: ['farm', 'workshop'] }, 'mid');
  assert.deepEqual(built.buildings.map((building) => building.icon), ['farm', 'workshop']);
  assert.ok(built.parts.some((part) => part.id === 'farm-soil'));
  assert.ok(built.parts.filter((part) => part.id.startsWith('farm-row')).length >= 3);
  assert.ok(built.parts.some((part) => part.id === 'workshop-chimney'));
  assert.ok(!empty.parts.some((part) => part.id.startsWith('farm')));
});

await test('population changes the bounded settlement silhouette', () => {
  assert.ok(settlementVisual({ ...city, population: 7 }, 'mid').houses > settlementVisual(city, 'mid').houses);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const large = settlementVisual({ ...city, population: 10000, buildings: ['farm', 'workshop'] }, detail);
    assert.ok(large.houses <= DETAIL_BUDGETS[detail].houses);
    assert.ok(large.parts.length <= DETAIL_BUDGETS[detail].parts);
    assert.equal(large.population, 10000);
  }
});

await test('current wellbeing and damage remain distinct from past drought', () => {
  const visual = settlementVisual({ ...city, wellbeing: 37, damage: 12, buildings: ['farm'] }, 'mid');
  assert.deepEqual(visual.conditions.map((condition) => condition.icon), ['wellbeing', 'damage']);
  assert.ok(visual.conditions.every((condition) => condition.icon !== 'drought'));
  assert.ok(visual.parts.some((part) => part.id.startsWith('farm-row') && part.material === 'crop'));
});

await test('projected pixel detail uses hysteresis rather than zoom flicker', () => {
  assert.equal(visualDetail(18), 'far');
  assert.equal(visualDetail(32), 'mid');
  assert.equal(visualDetail(60), 'close');
  assert.equal(visualDetail(24, 'far'), 'far');
  assert.equal(visualDetail(23, 'mid'), 'mid');
  assert.equal(visualDetail(48, 'mid'), 'mid');
  assert.equal(visualDetail(47, 'close'), 'close');
  assert.equal(visualDetail(Number.NaN), 'far');
});

await test('world visual projection preserves canonical state and actual city identities', () => {
  const state = createWorld(1701);
  const first = state.cities[0];
  assert.ok(first);
  first.buildings.push('farm');
  const before = structuredClone(state);
  const visuals = projectWorldVisuals(state, 'mid');
  assert.equal(visuals.length, state.cities.length);
  assert.equal(visuals[0]?.cityId, first.id);
  assert.equal(visuals[0]?.tileId, first.tileId);
  assert.equal(visuals[0]?.buildings[0]?.icon, 'farm');
  assert.deepEqual(state, before);
});

await test('drought presents actual clamped losses with a transient local cue', () => {
  const visual = eventVisual(event({ effects: ['Aster food 8 → 0', 'Dawnwell wellbeing 67 → 57'] }));
  assert.equal(visual?.cue, 'dry-wind');
  assert.ok(visual && visual.label.length > 0);
  assert.equal(visual?.durationMs, 3200);
  assert.deepEqual(visual?.deltas.map((delta) => [delta.icon, delta.value]), [['food', -8], ['wellbeing', -10]]);
  assert.equal(visual?.tileId, 4);
});

await test('construction capacity is not reported as a delivered harvest', () => {
  const visual = eventVisual(event({ type: 'building-completed', effects: ['Dawnwell infrastructure 0 → 1', 'Dawnwell wellbeing 57 → 61', 'Seasonal food +4'] }));
  assert.equal(visual?.cue, 'construction');
  const food = visual?.deltas.find((delta) => delta.icon === 'food');
  assert.equal(food?.kind, 'rate');
  assert.ok(food && food.qualifier.length > 0);
  const harvest = eventVisual(event({ type: 'settlement-production', effects: ['Produced 10.08 food', 'Produced 5.1 science'] }));
  assert.equal(harvest?.cue, 'production');
  assert.equal(harvest?.deltas[0]?.value, 10.08);
  assert.equal(harvest?.deltas[0]?.kind, 'production');
  assert.equal(harvest?.deltas[0]?.qualifier, 'produced before costs');
});

await test('population and delivery cues follow recorded changes only', () => {
  const growth = eventVisual(event({ type: 'population-growth', effects: ['Population +1', 'Food -6'] }));
  assert.equal(growth?.cue, 'growth');
  assert.deepEqual(growth?.deltas.map((delta) => delta.value), [1, -6]);
  const pending = eventVisual(event({ type: 'trade-offered', effects: ['No shipment occurred'] }));
  assert.notEqual(pending?.cue, 'delivery');
  const delivered = eventVisual(event({ type: 'trade-delivered', effects: ['8 cargo exchanged atomically'] }));
  assert.equal(delivered?.cue, 'delivery');
  assert.equal(delivered?.deltas[0]?.value, 8);
});

await test('unknown or ambiguous effects never invent numerical deltas', () => {
  assert.equal(eventVisual(event({ type: 'future-unimplemented-event' })), null);
  const source = event({ effects: ['Food should rise 100', 'Secret number 99', 'Seasonal mystery +4'] });
  const visual = eventVisual(source);
  assert.deepEqual(visual?.deltas, []);
  assert.equal(visual?.detail, source.detail);
});

await test('status color direction follows meaning rather than the sign alone', () => {
  const visual = eventVisual(event({ effects: ['Dawnwell damage 12 → 0', 'Aster food 8 → 0', 'Population +1'] }));
  assert.deepEqual(visual?.deltas.map((entry) => entry.tone), ['positive', 'negative', 'positive']);
});

await test('event cues do not replay old history on load, polling or a different run', () => {
  const tracker = createEventCueTracker();
  const old = event();
  const added = event({ id: '2:0' });
  assert.deepEqual(tracker.observe('run-a', [old]), []);
  assert.equal(tracker.observe('run-a', [old, added]).length, 1);
  assert.deepEqual(tracker.observe('run-a', [old, added]), []);
  assert.deepEqual(tracker.observe('run-b', [old, added]), []);
});

await test('a busy update has bounded visible cues and prioritizes meaningful events', () => {
  const tracker = createEventCueTracker();
  tracker.observe('a', []);
  const events = Array.from({ length: 200 }, (_, index) => event({ id: `2:${index}`, importance: index === 105 ? 5 : 1, type: index === 105 ? 'drought' : 'settlement-production' }));
  const cues = tracker.observe('a', events);
  assert.equal(cues.length, 3);
  assert.ok(cues.some((cue) => cue.eventId === '2:105'));
  assert.deepEqual(tracker.observe('a', events), []);
});

await test('every displayed metric uses an original semantic icon path and a word', () => {
  const visual = eventVisual(event());
  for (const delta of visual?.deltas ?? []) {
    assert.ok(ICON_PATHS[delta.icon].length > 0);
    assert.ok(delta.label.length > 0);
    assert.ok(Number.isFinite(delta.value));
  }
});

await test('recipe inventories stay complete while each selected irrigation or kiln remains recognizable', () => {
  for (const detail of ['far', 'mid', 'close'] as const) {
    const all = settlementVisual({ ...city, population: 100, buildings: ['farm', 'workshop', 'irrigation', 'kiln'] }, detail);
    assert.deepEqual(all.buildings.map(entry => entry.icon), ['farm', 'workshop', 'irrigation', 'kiln']);
    assert.ok(all.parts.length <= DETAIL_BUDGETS[detail].parts);
    for (const id of ['irrigation', 'kiln']) {
      const selected = settlementVisual({ ...city, buildings: [id] }, detail);
      assert.deepEqual(selected.landmarks, [id]);
      assert.ok(selected.parts.some(entry => entry.id === `${id}-${id === 'kiln' ? 'body' : 'cistern'}`));
      assert.ok(selected.parts.some(entry => entry.id === `${id}-${id === 'kiln' ? 'opening' : 'basin'}`));
      assert.ok(selected.parts.length <= DETAIL_BUDGETS[detail].parts);
      assert.equal(new Set(selected.parts.map(entry => entry.id)).size, selected.parts.length);
      assert.ok(selected.parts.every(entry => [...entry.position, ...entry.scale, entry.rotation].every(Number.isFinite)));
    }
  }
});

await test('built recipe structures persist through waiting, paused and blocked operation', () => {
  const empty = settlementVisual(city, 'close');
  assert.ok(!empty.parts.some((entry) => entry.id.startsWith('irrigation') || entry.id.startsWith('kiln')));
  const built = { ...city, buildings: ['irrigation', 'kiln'] };
  const expected = settlementVisual(built, 'close').parts;
  for (const operation of [
    { enabled: true, lastResult: null },
    { enabled: false, lastResult: null },
    { enabled: true, lastResult: { round: 3, status: 'blocked' as const, paid: {}, produced: {}, shortages: [{ resource: 'materials' as const, required: 1, available: .5 }] } },
  ]) {
    assert.deepEqual(settlementVisual({ ...built, buildingOperations: { irrigation: operation, kiln: operation } }, 'close').parts, expected);
  }
});

await test('operation inspection separates current choice, past receipt and actual positive output', () => {
  assert.equal(operationVisual(undefined).summary, 'No operating record');
  assert.equal(operationVisual({ enabled: true, lastResult: null }).summary, 'Ready for next season');
  const result = { round: 8, status: 'operated' as const, paid: { materials: 1 }, produced: { food: 4.35 }, shortages: [] };
  const paused = operationVisual({ enabled: false, lastResult: result });
  assert.equal(paused.current, 'Paused');
  assert.equal(paused.summary, 'Paused now');
  assert.equal(paused.last?.round, 8);
  assert.equal(paused.last?.label, 'Supplies made');
  assert.deepEqual(paused.last?.paid, [{ resource: 'materials', label: 'Materials', amount: 1 }]);
  assert.deepEqual(paused.last?.produced, [{ resource: 'food', label: 'Food', amount: 4.35 }]);
  const zero = operationVisual({ enabled: true, lastResult: { ...result, produced: {} } });
  assert.equal(zero.last?.label, 'No output');
  assert.equal(zero.tone, 'neutral');
  assert.equal(zero.last?.paid[0]?.amount, 1);
  const blocked = { ...result, status: 'blocked' as const, paid: {}, produced: {}, shortages: [{ resource: 'materials' as const, required: 1, available: .25 }] };
  const view = operationVisual({ enabled: true, lastResult: blocked });
  assert.equal(view.current, 'On');
  assert.equal(view.tone, 'negative');
  assert.deepEqual(view.last?.shortages, blocked.shortages);
  assert.notEqual(view.last?.shortages, blocked.shortages);
  assert.equal(operationVisual({ enabled: true, lastResult: { ...blocked, status: 'paused' } }).summary, 'Ready for next season');
});

await test('only positive recorded building output earns work motion and payments remain explicit', () => {
  const base = event({ type: 'building-operation', title: 'Dawnwell: Irrigation works operated', detail: 'hearth/irrigation at strategic round 8', effects: ['Paid 1 materials', 'Produced 4.35 food'] });
  const made = eventVisual(base);
  assert.equal(made?.cue, 'work');
  assert.equal(made?.icon, 'irrigation');
  assert.deepEqual(made?.deltas.map((entry) => [entry.kind, entry.value]), [['payment', 1], ['production', 4.35]]);
  assert.equal(made?.deltas[0]?.qualifier, 'paid inputs');
  for (const effects of [['Paid 1 materials'], ['Paid 1 materials', 'Produced 0 food'], ['No inputs consumed or outputs produced']]) {
    assert.equal(eventVisual({ ...base, effects })?.cue, 'status');
  }
  assert.equal(eventVisual({ ...base, title: 'Dawnwell: Kiln blocked', detail: 'hearth/kiln at strategic round 8', effects: ['energy: required 2, opening stock remaining 1; nothing consumed or produced'] })?.label, 'Building could not operate');
  const tracker = createEventCueTracker();
  tracker.observe('world', []);
  assert.equal(tracker.observe('world', [base])[0]?.cue, 'work');
  assert.deepEqual(tracker.observe('world', [base]), []);
});


await test('current damage has an exact persistent condition and healthy cities have no damage mark', () => {
  assert.equal(damageCondition(0), null);
  assert.deepEqual(damageParts(0), []);
  assert.equal(damageMapLabel('Dawnwell', 0), 'Dawnwell');
  for (const damage of [.25, 10, 35, 100]) {
    assert.equal(damageCondition(damage)?.value, damage);
    assert.equal(damageCondition(damage)?.text, `${damage}% damage`);
    assert.equal(damageMapLabel('Dawnwell', damage), `Dawnwell · ${damage}% damage`);
    assert.equal(damageParts(damage).length, 3);
  }
  assert.equal(damageCondition(Number.NaN), null);
  assert.deepEqual(damageParts(Number.POSITIVE_INFINITY), []);
});

await test('damage marks all affected settlements without erasing buildings or adding people at every detail', () => {
  const state = createWorld(1701);
  for (const [index, entry] of state.cities.entries()) {
    entry.damage = index % 2 === 0 ? 35 : 0;
    entry.population = 100;
    entry.buildings = ['farm', 'workshop', 'irrigation', 'kiln'];
  }
  const before = structuredClone(state);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const visuals = projectWorldVisuals(state, detail);
    for (const [index, entry] of state.cities.entries()) {
      const visual = visuals[index];
      assert.ok(visual);
      const healthy = settlementVisual({ ...entry, worldSeed: state.seed, damage: 0 }, detail);
      assert.deepEqual(visual.buildings, healthy.buildings);
      assert.equal(visual.houses, healthy.houses);
      assert.equal(visual.population, entry.population);
      assert.deepEqual(visual.parts.filter((part) => !part.id.startsWith('damage-')), healthy.parts);
      assert.equal(visual.parts.filter((part) => part.id.startsWith('damage-')).length, entry.damage > 0 ? 3 : 0);
      assert.ok(visual.parts.length <= DETAIL_BUDGETS[detail].parts);
      assert.ok(visual.parts.every((part) => [...part.position, ...part.scale, part.rotation].every(Number.isFinite)));
    }
  }
  assert.deepEqual(state, before);
});

await test('repair cues use the clamped damage change and exact paid inputs without claiming production', () => {
  for (const [before, after] of [[35, 10], [10, 0]] as const) {
    const repaired = event({ type: 'city-repaired', tileId: 19, effects: [`City damage ${before} → ${after}`, 'Paid 5 materials', 'Paid 2 energy'] });
    const visual = eventVisual(repaired);
    assert.equal(visual?.cue, 'repair');
    assert.equal(visual?.icon, 'repair');
    assert.equal(visual?.tileId, 19);
    assert.deepEqual(visual?.deltas.map((entry) => [entry.icon, entry.value, entry.kind]), [['damage', after - before, 'delta'], ['materials', 5, 'payment'], ['energy', 2, 'payment']]);
    assert.equal(visual?.deltas[0]?.tone, 'positive');
    assert.equal(visual?.deltas[0]?.qualifier, 'points');
    assert.ok(visual?.deltas.every((entry) => entry.kind !== 'production'));
    assert.equal(settlementVisual({ ...city, damage: after }, 'far').conditions.some((entry) => entry.icon === 'damage'), after > 0);
    const tracker = createEventCueTracker();
    assert.deepEqual(tracker.observe('world', [repaired]), []);
    const next = { ...repaired, id: '2:0' };
    assert.equal(tracker.observe('world', [repaired, next])[0]?.cue, 'repair');
    assert.deepEqual(tracker.observe('world', [repaired, next]), []);
  }
});


const BUILT_FAMILIES = ['farm', 'workshop', 'irrigation', 'kiln', 'academy', 'monument', 'fuel-yard'];

await test('every installed fact and current damage survive selective compact landmark allocation', () => {
  const source = { ...city, population: 10000, damage: 35, buildings: [...BUILT_FAMILIES] };
  const before = structuredClone(source);
  for (const detail of ['far', 'mid', 'close'] as const) {
    const visual = settlementVisual(source, detail);
    const appearances = buildingAppearances(visual.landmarks, detail);
    assert.deepEqual(visual.buildings.map((entry) => entry.icon), BUILT_FAMILIES);
    assert.ok(visual.parts.length <= DETAIL_BUDGETS[detail].parts);
    assert.ok(visual.houses >= 1 && visual.houses <= DETAIL_BUDGETS[detail].houses);
    assert.equal(visual.landmarks.length + visual.summarizedBuildings.length, BUILT_FAMILIES.length);
    assert.equal(visual.population, source.population);
    assert.equal(visual.conditions.find((entry) => entry.icon === 'damage')?.value, 35);
    for (const appearance of appearances) {
      for (const id of appearance.corePartIds) assert.ok(visual.parts.some((entry) => entry.id === id), `${detail}: ${id}`);
    }
    assert.deepEqual(visual.parts.filter(entry => entry.id.startsWith('damage-')).map(entry => entry.id), damageParts(35).map(entry => entry.id));
    assert.equal(new Set(visual.parts.map((entry) => entry.id)).size, visual.parts.length);
    for (const part of visual.parts) {
      assert.ok([...part.position, ...part.scale, part.rotation].every(Number.isFinite));
      const c = Math.abs(Math.cos(part.rotation));
      const s = Math.abs(Math.sin(part.rotation));
      assert.ok(Math.abs(part.position[0]) + (part.scale[0] * c + part.scale[2] * s) / 2 <= .96);
      assert.ok(Math.abs(part.position[2]) + (part.scale[2] * c + part.scale[0] * s) / 2 <= .96);
    }
  }
  assert.deepEqual(source, before);
});

await test('all building subsets have stable identity and geometry independent of source ordering', () => {
  for (let mask = 0; mask < 2 ** BUILT_FAMILIES.length; mask += 1) {
    const buildings = BUILT_FAMILIES.filter((_, index) => (mask & (1 << index)) !== 0);
    for (const detail of ['far', 'mid', 'close'] as const) {
      const source = { ...city, population: 100, damage: 100, buildings };
      const expected = settlementVisual(source, detail);
      const reversed = settlementVisual({ ...source, buildings: buildings.toReversed() }, detail);
      const duplicated = settlementVisual({ ...source, buildings: ['unknown-future-building', ...buildings, ...buildings] }, detail);
      assert.deepEqual(reversed, expected);
      assert.deepEqual(duplicated, expected);
      assert.ok(expected.parts.length <= DETAIL_BUDGETS[detail].parts);
      for (const appearance of buildingAppearances(expected.landmarks, detail)) {
        assert.ok(appearance.corePartIds.every((id) => expected.parts.some((entry) => entry.id === id)));
      }
    }
  }
});

await test('optional detail spends spare parts fairly after all family cores are reserved', () => {
  const appearances = buildingAppearances(BUILT_FAMILIES, 'close');
  const coreIds = appearances.flatMap((entry) => entry.corePartIds);
  const before = structuredClone(appearances);
  assert.equal(coreIds.length, 9);
  const cores = allocateBuildingParts(appearances, coreIds.length);
  assert.deepEqual(new Set(cores.map((entry) => entry.id)), new Set(coreIds));
  const firstDetails = allocateBuildingParts(appearances, coreIds.length + appearances.length);
  for (const appearance of appearances) {
    const firstOptional = appearance.parts.find((entry) => !appearance.corePartIds.includes(entry.id));
    assert.ok(firstOptional);
    assert.ok(firstDetails.some((entry) => entry.id === firstOptional.id));
  }
  assert.deepEqual(appearances, before);
  assert.deepEqual(allocateBuildingParts(appearances, 1000), appearances.flatMap((entry) => entry.parts));
  assert.equal(allocateBuildingParts(appearances, coreIds.length - 1).length, coreIds.length - 1);
  assert.deepEqual(allocateBuildingParts(appearances, 0), []);
});

await test('civic families use distinct original silhouettes and canonical familiar names', () => {
  for (const [id, core, shape, material] of [
    ['academy', 'academy-roof', 'gable', 'plaster'],
    ['monument', 'monument-platform', 'cylinder', 'stone'],
    ['fuel-yard', 'fuel-yard-stack', 'box', 'timber'],
  ] as const) {
    const definition = BUILDINGS.find((entry) => entry.id === id);
    assert.ok(definition);
    const appearance = buildingAppearance(id, 'far');
    assert.ok(appearance);
    assert.equal(appearance.label, definition.name);
    assert.equal(appearance.icon, id);
    assert.ok(ICON_PATHS[appearance.icon].length > 0);
    assert.deepEqual(appearance.corePartIds, [core]);
    assert.ok(appearance.parts.some((entry) => entry.id === core && entry.shape === shape && entry.material === material));
    assert.deepEqual(buildingIdentity(id), { icon: appearance.icon, label: definition.name });
  }
  assert.equal(buildingAppearance('unknown', 'close'), null);
  assert.equal(buildingIdentity('unknown'), null);
  assert.equal(buildingAppearance('constructor', 'close'), null);
  assert.equal(buildingIdentity('__proto__'), null);
});

await test('civic structures persist unchanged across current choices and recorded operating outcomes', () => {
  const source = { ...city, population: 40, damage: 10, buildings: [...BUILT_FAMILIES] };
  for (const detail of ['far', 'mid', 'close'] as const) {
    const baseline = settlementVisual(source, detail);
    for (const operation of [
      { enabled: true, lastResult: null },
      { enabled: false, lastResult: null },
      { enabled: true, lastResult: { round: 3, status: 'blocked' as const, paid: {}, produced: {}, shortages: [{ resource: 'culture' as const, required: 2, available: 1 }] } },
      { enabled: false, lastResult: { round: 3, status: 'operated' as const, paid: { culture: 2 }, produced: { science: 1.75 }, shortages: [] } },
    ]) {
      const input = { ...source, buildingOperations: { academy: operation, 'fuel-yard': operation } };
      const before = structuredClone(input);
      assert.deepEqual(settlementVisual(input, detail), baseline);
      assert.deepEqual(input, before);
    }
  }
});

await test('civic operation cues use shared identity and exact receipts without inventing activity', () => {
  for (const id of ['academy', 'fuel-yard']) {
    const definition = BUILDINGS.find((entry) => entry.id === id);
    assert.ok(definition?.operatingInputs);
    const paid = Object.entries(definition.operatingInputs).map(([resource, amount]) => `Paid ${amount} ${resource}`);
    const made = Object.entries(definition.production).map(([resource, amount]) => `Produced ${amount / 2} ${resource}`);
    const source = event({ type: 'building-operation', title: `${definition.name} operated`, detail: `hearth/${id} at strategic round 8`, effects: [...paid, ...made] });
    const before = structuredClone(source);
    const visual = eventVisual(source);
    assert.equal(visual?.icon, id);
    assert.equal(visual?.cue, 'work');
    assert.deepEqual(visual?.deltas.filter((entry) => entry.kind === 'payment').map((entry) => entry.value), Object.values(definition.operatingInputs));
    assert.deepEqual(visual?.deltas.filter((entry) => entry.kind === 'production').map((entry) => entry.value), Object.values(definition.production).map((amount) => amount / 2));
    for (const effects of [paid, [...paid, 'Produced 0 science'], ['No inputs consumed or outputs produced']]) {
      assert.equal(eventVisual({ ...source, effects })?.cue, 'status');
    }
    const tracker = createEventCueTracker();
    assert.deepEqual(tracker.observe('civic-fixture', [source]), []);
    const fresh = { ...source, id: '2:0' };
    assert.equal(tracker.observe('civic-fixture', [source, fresh])[0]?.icon, id);
    assert.deepEqual(tracker.observe('civic-fixture', [source, fresh]), []);
    assert.deepEqual(source, before);
  }
  assert.equal(eventVisual(event({ type: 'building-operation', detail: 'hearth/unknown at strategic round 8', effects: [] }))?.icon, 'infrastructure');
});

await test('seeded town variants retain factual family silhouettes, faction roofs and bounded shared geometry', () => {
  const buildings = BUILDINGS.map(building => building.id);
  for (const worldSeed of [0, 1, 2, 1701, 9001]) for (let civId = 0; civId < 5; civId++) for (const detail of ['far', 'mid', 'close'] as const) {
    const source = { ...city, worldSeed, civId, population: 10000, buildings, damage: 100 };
    const before = structuredClone(source);
    const visual = settlementVisual(source, detail);
    assert.equal(visual.landmarks[0], 'launchpad');
    assert.equal(visual.buildings.length, buildings.length);
    assert.ok(visual.parts.length <= DETAIL_BUDGETS[detail].parts);
    assert.ok(visual.parts.every(part => !/road|route|rocket|plume/.test(part.id)));
    assert.ok(visual.parts.every(part => [...part.position, ...part.scale, part.rotation].every(Number.isFinite)));
    assert.deepEqual(settlementVisual({ ...source, buildings: buildings.toReversed() }, detail), visual);
    assert.deepEqual(source, before);
  }
});
