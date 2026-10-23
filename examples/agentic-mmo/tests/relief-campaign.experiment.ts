import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import type { GameEvent } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { advanceLocalSimulation, createLocalSimulation, parseLocalSimulation } from '../web/local-simulation.ts';

const scratch = '.blabla/scratch/historical-relief-experiment';
const HISTORICAL_RELEASE_ID = 'settlement-regional-targets-1';

void test('natural seed73 combined living world uses exact local events, consenting relief and paid Mars without intervention', { timeout: 510_000 }, context => {
  mkdirSync(scratch, { recursive: true });
  let run = createLocalSimulation(73, HISTORICAL_RELEASE_ID);
  assert.equal(run.state.releaseId, HISTORICAL_RELEASE_ID);
  assert.equal(run.policyVersion, 'weighted-civilizations-v2');
  assert.equal(Object.hasOwn(run.state.origin!, 'namingVersion'), false);
  assert.equal(run.state.origin?.initialReleaseId, 'settlement-regional-targets-1');
  assert.ok(run.state.unlockedFeatures.includes('consented-relief'));
  assert.ok(run.state.unlockedFeatures.includes('procedural-regional-targets'));
  assert.ok(run.state.cities.every(city => city.buildings.length === 0));
  assert.ok(run.state.civilizations.every(actor => actor.technologies.length === 0 && actor.marsPopulation === 0));
  const started = performance.now(); const deadline = started + 480_000;
  const counts: Record<string, number> = {};
  const decisions: Record<string, number> = {};
  const episodes: GameEvent[] = [];
  const regionalTargets: Record<string, Set<string>> = {};
  const windows: number[] = [];
  const restarted = new Set<string>();
  let lastSavedRound = -1;
  try {
    while (!run.state.outcome && run.state.round < 360 && performance.now() < deadline) {
      const before = run; const seen = new Set(before.state.events.map(event => event.id));
      const begin = performance.now();
      try { run = advanceLocalSimulation(run, 1); }
      catch (error) {
        writeFileSync(`${scratch}/combined73-rejected-input.json`, JSON.stringify(before));
        throw error;
      }
      windows.push(performance.now() - begin);
      for (const decision of run.decisions) if (decision.revision > before.state.revision) decisions[decision.action.type] = (decisions[decision.action.type] ?? 0) + 1;
      for (const event of run.state.events.filter(event => !seen.has(event.id))) {
        counts[event.type] = (counts[event.type] ?? 0) + 1;
        if (event.reliefResult || event.regionalEvent || event.type.startsWith('relief-') || event.type.startsWith('mars-')) episodes.push(event);
        if (event.regionalEvent) {
          const receipt = event.regionalEvent;
          assert.equal(receipt.eventId, event.id); assert.equal(receipt.selection.instanceId, receipt.instanceId);
          assert.equal(receipt.selection.local.tileId, event.tileId);
          const decision = run.decisions.find(decision => decision.action.type === 'event' && decision.action.regional?.instanceId === receipt.instanceId);
          assert.ok(decision?.action.type === 'event'); assert.deepEqual(decision.action.regional, receipt.selection);
          (regionalTargets[receipt.eventKind] ??= new Set()).add(receipt.selection.local.cityId);
        }
        if (event.reliefResult?.outcome === 'delivered') {
          const result = event.reliefResult;
          assert.equal(result.charter.status, 'accepted');
          assert.equal(result.before.donorFood - result.after.donorFood, result.charter.terms.food);
          assert.equal(result.after.recipientFood - result.before.recipientFood, result.charter.terms.food);
          assert.equal(result.before.donorEnergy - result.after.donorEnergy, 1);
          assert.equal(result.deliveredFood, result.charter.terms.food);
        }
      }
      const checkpoint = run.state.relief?.active.some(charter => charter.status === 'accepted') ? 'accepted-relief'
        : run.state.round >= 60 ? 'ordinary-continuation' : null;
      if (checkpoint && !restarted.has(checkpoint)) {
        const encoded = JSON.stringify(run); const restored = parseLocalSimulation(JSON.parse(encoded)); assert.ok(restored);
        assert.deepEqual(advanceLocalSimulation(restored, 2), advanceLocalSimulation(run, 2));
        assert.equal(JSON.stringify(run), encoded); restarted.add(checkpoint);
        writeFileSync(`${scratch}/combined73-${checkpoint}.json`, encoded);
      }
      if (run.state.round !== lastSavedRound && run.state.round % 20 === 0) {
        lastSavedRound = run.state.round;
        writeFileSync(`${scratch}/combined73-checkpoint.json`, JSON.stringify(run));
        context.diagnostic(`Natural combined seed73 round ${run.state.round}: relief proposals ${counts['relief-proposed'] ?? 0}, delivered ${counts['relief-delivered'] ?? 0}, regional receipts ${Object.values(regionalTargets).reduce((sum, values) => sum + values.size, 0)} distinct family/town pairs`);
      }
    }
    assert.ok(isWorldState(run.state));
    assert.ok(run.state.outcome, `Natural combined campaign stopped at round ${run.state.round}; this is not a successful Mars journey`);
    assert.equal(run.state.outcome.kind, 'mars');
    assert.ok((counts['relief-proposed'] ?? 0) > 0, 'A genuine natural need must yield an autonomous offer, not a scripted command');
    assert.ok((counts['relief-accepted'] ?? 0) > 0);
    assert.ok((counts['relief-delivered'] ?? 0) > 0, 'At least one actual consented due transfer must execute in the natural window');
    assert.ok(Object.keys(regionalTargets).length >= 2);
    assert.ok(restarted.has('accepted-relief'));
    const terminal = JSON.stringify(run); assert.deepEqual(advanceLocalSimulation(run, 60), run); assert.equal(JSON.stringify(run), terminal);
  } finally {
    const sorted = windows.toSorted((left, right) => left - right);
    const summary = { kind: 'natural-production-local-engine', seed: 73, initialReleaseId: HISTORICAL_RELEASE_ID,
      round: run.state.round, steps: run.steps, outcome: run.state.outcome, elapsedMs: performance.now() - started,
      counts, decisions, regionalTargets: Object.fromEntries(Object.entries(regionalTargets).map(([kind, towns]) => [kind, [...towns].sort()])),
      restarted: [...restarted], episodeCount: episodes.length,
      synchronousWindowMs: { count: windows.length, mean: windows.reduce((sum, value) => sum + value, 0) / Math.max(1, windows.length), p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0, maximum: sorted.at(-1) ?? 0 },
      scope: 'Actual local engine used by Worker; no browser thread, hosted world, injected stocks, selected success actions or all-seed outcome claim' };
    writeFileSync(`${scratch}/combined73-summary.json`, JSON.stringify(summary, null, 2));
    writeFileSync(`${scratch}/combined73-episodes.json`, JSON.stringify(episodes));
    writeFileSync(`${scratch}/combined73-final.json`, JSON.stringify(run));
    context.diagnostic(JSON.stringify(summary));
  }
});
