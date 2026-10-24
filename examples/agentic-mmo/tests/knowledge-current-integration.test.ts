import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameEvent } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { RECORDED_CHOICES_FORMAT } from '../server/public-protocol.ts';
import { readBoundedChronicle } from '../server/recorded-choices.ts';
import type { D1Database, D1Statement } from '../server/repository.ts';
import { createLocalSimulation, advanceLocalSimulation, parseLocalSimulation, ACTIVE_LOCAL_RELEASE_ID, LOCAL_SIMULATION_STORAGE_KEY } from '../web/local-simulation.ts';
import { spectatorEventDestination } from '../web/spectator-hud.ts';
import { knowledgeStory } from '../web/knowledge-inspection.ts';
import { acceptKnowledge, knowledgeEconomy, syntheticKnowledgeCorridor } from './fixtures/knowledge-current.ts';

function recordedDatabase(events: GameEvent[], start: number, end: number): D1Database {
  const row = {
    start_revision: start, end_revision: end,
    transition_json: JSON.stringify({ kind: 'strategy-catchup', expectedRevision: start, timestamp: '2026-10-23T00:01:00.000Z' }),
    provenance_json: JSON.stringify({ kind: 'clock-service', model: null, seat: 5, commandId: 'synthetic-recorded-current-economy', recordedAt: '2026-10-23T00:01:00.000Z' }),
    events_json: JSON.stringify(events),
  };
  return {
    prepare(sql): D1Statement {
      return {
        bind() { return this; },
        async all() {
          return { results: sql.startsWith('SELECT revision') ? [{ revision: end }]
            : sql.includes('detail_bytes') ? [{ end_revision: end, detail_bytes: Buffer.byteLength(JSON.stringify(row)) }] : [row], meta: { changes: 0 } };
        },
        async run() { throw new Error('The read-only recorded-history fixture must never write'); },
      };
    },
    async batch() { throw new Error('The read-only recorded-history fixture must never write'); },
  };
}

void test('current genesis retains supported-study rules and deterministic same-version restart', () => {
  const initial = createLocalSimulation(73);
  assert.equal(initial.state.origin?.initialReleaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.match(LOCAL_SIMULATION_STORAGE_KEY, /^civitas:procedural-observatory:[a-z-]+-v[1-9]\d*$/);
  assert.equal(initial.state.releaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.equal(initial.state.knowledge?.ruleVersion, 2);
  assert.ok(initial.state.unlockedFeatures.includes('hillside-commonworks'));
  assert.ok(isWorldState(initial.state));
  const advanced = advanceLocalSimulation(initial, 3);
  const restored = parseLocalSimulation(JSON.parse(JSON.stringify(advanced)));
  assert.ok(restored);
  assert.deepEqual(advanceLocalSimulation(restored, 2), advanceLocalSimulation(advanced, 2));
});

void test('current recorded study seasons require exact emitted institution operations, not cargo events', async () => {
  const state = syntheticKnowledgeCorridor();
  acceptKnowledge(state);
  for (const count of [1, 2]) {
    const before = state.revision;
    const events = knowledgeEconomy(state);
    const study = events.find(event => event.knowledgeStudy)!;
    assert.ok(study);
    assert.equal(study.knowledgeStudy!.studyCount, count);
    assert.equal(events.some(event => event.type === 'trade-delivered'), false);
    const page = await readBoundedChronicle(recordedDatabase(events, before, state.revision), 'synthetic-current-row', { format: RECORDED_CHOICES_FORMAT });
    assert.deepEqual(page.entries[0]!.events, events);
    for (const alter of ['missing-operation', 'changed-operation', 'wrong-kind'] as const) {
      const corrupt = structuredClone(events);
      const proof = study.knowledgeStudy!.attempt.teacher!;
      const index = corrupt.findIndex(event => event.id === proof.operationEventId);
      assert.ok(index >= 0);
      if (alter === 'missing-operation') corrupt.splice(index, 1);
      if (alter === 'changed-operation') corrupt[index]!.effects = ['Different paid operation'];
      if (alter === 'wrong-kind') corrupt[index]!.type = 'trade-delivered';
      await assert.rejects(readBoundedChronicle(recordedDatabase(corrupt, before, state.revision), 'synthetic-current-row', { format: RECORDED_CHOICES_FORMAT }), /corrupt_history/);
    }
  }
});

void test('current Chronicle binds an actual study to the exact consenting route and describes paid operation seasons', () => {
  const state = syntheticKnowledgeCorridor();
  acceptKnowledge(state);
  const event = knowledgeEconomy(state).find(event => event.knowledgeStudy)!;
  const destination = spectatorEventDestination(state, event);
  assert.deepEqual(destination, { kind: 'route', id: state.routes[0]!.id, label: 'Recorded study route' });
  assert.match(knowledgeStory(event)!.consequence, /1 of 2 supported study seasons/);
  state.routes[0]!.agreement!.offerId = 'different-consent';
  assert.equal(spectatorEventDestination(state, event)?.kind === 'route', false);
});
