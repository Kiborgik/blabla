import assert from 'node:assert/strict';
import { test } from 'node:test';
import { eventVisual, createEventCueTracker } from '../visuals/event-visuals.ts';
import type { GameEvent } from '../core/types.ts';

const event = (patch: Partial<GameEvent> = {}): GameEvent => ({ id: '2:0', round: 4, type: 'research-completed', title: 'Ember discovers Writing', detail: 'Recorded capability', actor: 2, target: 2, tileId: 4, cause: 'Produced Science completed the active research', effects: ['Technology writing unlocked'], importance: 3, ...patch });

void test('committed content cues name the recorded civilization or town and actual completed content', () => {
  const research = event(); const before = structuredClone(research);
  assert.equal(eventVisual(research)?.label, 'Ember · Writing discovered');
  assert.equal(eventVisual(research)?.cue, 'discovery');
  assert.match(eventVisual(research)?.detail ?? '', /Ember discovers Writing/);
  assert.deepEqual(research, before);
  const built = event({ type: 'building-completed', title: 'Tidehaven builds Kiln', effects: [], detail: 'A fired-clay building' });
  assert.equal(eventVisual(built)?.label, 'Tidehaven · Kiln built');
  assert.equal(eventVisual(built)?.cue, 'construction');
  assert.equal(eventVisual({ ...built, type: 'construction-started', title: 'Tidehaven starts Kiln' }), null);
  assert.equal(eventVisual({ ...research, type: 'research-started', title: 'Ember begins Writing' }), null);
});

void test('unknown records stay generic instead of borrowing current catalogue or inventory claims', () => {
  assert.equal(eventVisual(event({ title: 'A future discovery', effects: [] }))?.label, 'Discovery');
  assert.equal(eventVisual(event({ type: 'building-completed', title: 'Unfamiliar construction', effects: [] }))?.label, 'New building');
  assert.equal(eventVisual(event({ title: 'A completed discovery', effects: ['Technology writing unlocked'] }))?.label, 'Writing discovered');
  assert.equal(eventVisual(event({ effects: ['Technology writing unlocked', 'Technology mining unlocked'] }))?.label, 'Discovery');
  assert.equal(eventVisual(event({ type: 'trade-blocked', title: 'An agreed shipment cannot depart', effects: [] }))?.label, 'Shipment blocked');
});

void test('long recorded names cannot crowd out the content name or exceed the compact cue budget', () => {
  const source = event({ type: 'building-completed', title: `${'Town'.repeat(40)} builds Kiln`, effects: [] });
  const cue = eventVisual(source); assert.ok(cue);
  assert.ok(cue.label.length <= 72); assert.match(cue.label, /Kiln built$/); assert.match(cue.label, /…/);
  assert.ok(cue.detail.includes(source.title));
});

void test('named cues keep the existing bounded source baseline and deterministic recent-event ordering', () => {
  const tracker = createEventCueTracker();
  const first = event({ id: '1:0' });
  assert.deepEqual(tracker.observe('local:a', [first]), []);
  const records = Array.from({ length: 5 }, (_, index) => event({ id: `${index + 2}:0` }));
  assert.deepEqual(tracker.observe('local:a', [first, ...records]).map(cue => cue.eventId), ['6:0', '5:0', '4:0']);
  assert.deepEqual(tracker.observe('archive:a', [first, ...records]), []);
  assert.deepEqual(tracker.observe('archive:a', [first, ...records]), []);
});

void test('new local historical events have distinct cues without promoting a fair to a shipment or migration to growth', () => {
  const cases = [
    ['cultivated-harvest', 'Extra harvest', 'production'], ['forest-fire', 'Forest fire', 'warning'],
    ['coastal-storm', 'Coastal storm', 'warning'], ['trade-fair', 'Trade fair', 'status'],
    ['industrial-accident', 'Industrial accident', 'warning'], ['internal-migration', 'Residents moved', 'status'],
  ];
  for (const [type, label, cue] of cases) {
    assert.ok(type && label && cue);
    const visual = eventVisual(event({ type, effects: ['Town damage 10 → 28', 'Aster food 20 → 16'] }));
    assert.equal(visual?.label, label); assert.equal(visual?.cue, cue);
    assert.deepEqual(visual?.deltas.map(delta => delta.value), [18, -4]);
  }
  assert.equal(eventVisual(event({ type: 'trade-fair', effects: ['Aster credits 2 → 8'] }))?.deltas.some(delta => delta.icon === 'cargo'), false);
});
