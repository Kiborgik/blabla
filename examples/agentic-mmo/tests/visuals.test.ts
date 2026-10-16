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
  assert.equal(harvest?.deltas[0]?.kind, 'delta');
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
