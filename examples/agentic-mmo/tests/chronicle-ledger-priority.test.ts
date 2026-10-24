import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../core/engine.ts';
import type { GameEvent } from '../core/types.ts';
import { eventLogEntries, eventLogPage, latestStoryEvent } from '../web/event-log.ts';
import { spectatorChronicle } from '../web/spectator-hud.ts';

function event(id: string, type: string, overrides: Partial<GameEvent> = {}): GameEvent {
  return { id, type, round: 4, title: 'A recorded event', detail: '', actor: 0, target: 0,
    tileId: null, cause: 'Recorded cause', effects: [], importance: 2, ...overrides };
}

function ledger(id: string, type: 'river-flow' | 'woodland-beat', active: boolean): GameEvent {
  return event(id, type, {
    actor: null, target: null, importance: active ? 2 : 1,
    title: type === 'river-flow' ? 'River intakes complete a flow season' : 'Worked woodlands complete a season',
    detail: `${type === 'river-flow' ? 'uniform-runoff-1' : 'worked-woodlands-1'} at strategic round 4`,
    cause: type === 'river-flow'
      ? 'One renewable runoff unit per land tile followed actual downhill links; all ordinary paid work reserved first, then fully funded intakes withdrew in upstream order with zero return flow'
      : 'Fully funded and staffed existing forest operations use one local work-lot; only stands with no harvest recover one lot, capped at eight',
    effects: type === 'river-flow'
      ? ['Land-source units 30', `Withdrawn ${active ? 8 : 0}`, `Ocean outlet residual ${active ? 22 : 30}`, ...(active ? ['city-0/7/construction-1: withdrew 8'] : [])]
      : [`Harvested work-lots ${active ? 1 : 0}`, `Recovered work-lots ${active ? 0 : 1}`, 'Recovery is not operation output; forest terrain is unchanged'],
  });
}

function world(events: GameEvent[]) {
  const state = createWorld(1701, '2026-10-16T00:00:00Z');
  state.events = events;
  return state;
}

void test('idle and working river and woodland ledgers are routine while their exact records stay inspectable', () => {
  const events = [ledger('river-idle', 'river-flow', false), ledger('river-paid', 'river-flow', true),
    ledger('woodland-idle', 'woodland-beat', false), ledger('woodland-paid', 'woodland-beat', true)];
  const state = world(events); const before = structuredClone(state);
  const rows = eventLogEntries(events, { civilizations: state.civilizations });
  assert.equal(rows.length, events.length);
  assert.ok(rows.every(row => row.routine));
  assert.deepEqual(eventLogPage(rows, { actor: '', family: 'important', page: 0 }).rows, []);
  for (const family of ['all', 'routine']) {
    assert.deepEqual(eventLogPage(rows, { actor: '', family, page: 0 }).rows.map(row => row.id), events.toReversed().map(source => source.id));
  }
  for (const source of events) {
    const row = rows.find(candidate => candidate.id === source.id); assert.ok(row);
    assert.equal(row.title, source.title); assert.equal(row.round, source.round);
    assert.equal(row.cause, source.cause); assert.equal(row.detail, source.detail);
    assert.deepEqual(row.effects, source.effects);
  }
  assert.equal(latestStoryEvent(events), undefined);
  assert.deepEqual(spectatorChronicle(state), []);
  rows[0]!.effects.push('Only the projected row changed');
  assert.deepEqual(state, before);
});

void test('founding reform and discovery remain the Chronicle through a later routine ledger flood', () => {
  const meaningful = [
    event('founding', 'settlement-founded', { title: 'Tidehaven is founded' }),
    event('reform', 'arrangement-accepted', { title: 'Pelagos chooses a new government', effects: ['Credits paid 0', 'Reform completion civic-1'] }),
    event('discovery', 'research-completed', { title: 'Pelagos discovers Writing' }),
  ];
  const noise = Array.from({ length: 80 }, (_, index) => ledger(`ledger-${index}`, index % 2 ? 'river-flow' : 'woodland-beat', index % 3 === 0));
  const state = world([...meaningful, ...noise]); const before = structuredClone(state);
  const rows = eventLogEntries(state.events, { civilizations: state.civilizations });
  assert.equal(rows.length, 24);
  assert.deepEqual(eventLogPage(rows, { actor: '', family: 'important', page: 0 }).rows.map(row => row.id), ['discovery', 'reform', 'founding']);
  assert.equal(latestStoryEvent(state.events), meaningful[2]);
  assert.deepEqual(spectatorChronicle(state).map(story => story.event.id), ['discovery', 'reform', 'founding']);
  assert.deepEqual(spectatorChronicle(state), spectatorChronicle(state));
  assert.deepEqual(state, before);
});

void test('real blocked operations retain exact shortage facts and priority despite later ledger beats', () => {
  const blocked = [
    event('building-blocked', 'building-operation', { title: 'Tidehaven: Irrigation works blocked', cause: 'The complete recipe was checked against remaining opening stocks in city and building ID order', detail: 'city-0/irrigation at strategic round 4', effects: ['materials: required 1, opening stock remaining 0; nothing consumed or produced'] }),
    event('river-blocked', 'improvement-operation', { title: 'Tidehaven: river-intake blocked', cause: 'flow-shortage', detail: 'city-0/7/river-intake at strategic round 4', effects: ['River 7 → 8, outlet 9: available 7, withdrawn 0, remaining 7; no return flow', 'No output produced'] }),
    event('woodland-blocked', 'improvement-operation', { title: 'Tidehaven: lumber-mill blocked', cause: 'woodland-shortage', detail: 'city-0/10/lumber-mill at strategic round 4', effects: ['No output produced'] }),
  ];
  const state = world([...blocked, ledger('river', 'river-flow', false), ledger('woodland', 'woodland-beat', false)]);
  const before = structuredClone(state); const rows = eventLogEntries(state.events, { civilizations: state.civilizations });
  assert.deepEqual(eventLogPage(rows, { actor: '', family: 'important', page: 0 }).rows.map(row => row.id), blocked.toReversed().map(source => source.id));
  for (const source of blocked) {
    const row = rows.find(candidate => candidate.id === source.id); assert.ok(row);
    assert.equal(row.routine, false); assert.equal(row.category, 'Needs support');
    assert.equal(row.cause, source.cause); assert.equal(row.detail, source.detail);
    assert.deepEqual(row.effects, source.effects);
  }
  assert.equal(latestStoryEvent(state.events), blocked[2]);
  assert.deepEqual(spectatorChronicle(state).map(story => story.event.id), blocked.toReversed().map(source => source.id));
  assert.deepEqual(state, before);
});

void test('exact ledger classification does not hide unknown low-importance events or related event names', () => {
  for (const type of ['future-event', 'river-flow-changed', 'woodland-beat-discovery', 'civic-completed', 'transition-completed', 'coastal-founded']) {
    const source = event(`unknown-${type}`, type, { importance: 0, title: 'An exact recorded change', effects: ['An unfamiliar retained fact'] });
    const state = world([source, ledger('ledger', 'river-flow', true)]);
    const rows = eventLogEntries(state.events, { civilizations: state.civilizations });
    const row = rows.find(candidate => candidate.id === source.id); assert.ok(row);
    assert.equal(row.routine, false); assert.equal(row.title, source.title);
    assert.deepEqual(row.effects, source.effects);
    assert.equal(latestStoryEvent(state.events), source);
    assert.deepEqual(spectatorChronicle(state).map(story => story.event.id), [source.id]);
  }
});

void test('ledger floods preserve the existing sixteen priority and twenty-four total record budgets', () => {
  const meaningful = Array.from({ length: 20 }, (_, index) => event(`discovery-${index}`, 'research-completed', { title: `Discovery ${index}` }));
  const noise = Array.from({ length: 40 }, (_, index) => ledger(`ledger-${index}`, index % 2 ? 'river-flow' : 'woodland-beat', true));
  const state = world([...meaningful, ...noise]); const before = structuredClone(state);
  const rows = eventLogEntries(state.events, { civilizations: state.civilizations });
  assert.equal(rows.length, 24);
  assert.deepEqual(rows.map(row => row.id), [...meaningful.slice(-16), ...noise.slice(-8)].toReversed().map(source => source.id));
  assert.equal(rows.filter(row => !row.routine).length, 16);
  assert.equal(spectatorChronicle(state).length, 3);
  assert.deepEqual(state, before);
});

void test('ledger filtering keeps the ninety-six-event inspection boundary and existing production fallback', () => {
  const choice = event('choice', 'arrangement-accepted');
  const noise = Array.from({ length: 96 }, (_, index) => ledger(`ledger-${index}`, index % 2 ? 'river-flow' : 'woodland-beat', false));
  const inside = world([choice, ...noise.slice(0, 95)]);
  assert.equal(latestStoryEvent(inside.events), choice);
  assert.ok(eventLogEntries(inside.events, { civilizations: inside.civilizations }).some(row => row.id === choice.id));
  assert.deepEqual(spectatorChronicle(inside).map(story => story.event.id), [choice.id]);
  const outside = world([choice, ...noise]);
  assert.equal(latestStoryEvent(outside.events), undefined);
  assert.ok(!eventLogEntries(outside.events, { civilizations: outside.civilizations }).some(row => row.id === choice.id));
  assert.deepEqual(spectatorChronicle(outside), []);
  for (const type of ['settlement-production', 'building-operation']) {
    const production = event('production', type, { title: 'Tidehaven: Kiln operated' });
    assert.equal(latestStoryEvent([production, ...noise.slice(0, 20)]), production);
  }
});
