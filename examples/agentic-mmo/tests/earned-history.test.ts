import assert from 'node:assert/strict';
import test from 'node:test';
import { applyHistoryAdvance } from '../core/engine.ts';
import { HISTORICAL_MILESTONES } from '../core/content.ts';
import { nextEarnedHistoryAdvance } from '../core/simulation/history.ts';
import { isWorldState } from '../core/validation.ts';
import { createAutonomousState, planAutonomousWake } from '../server/autonomous-runner.ts';
import { createLocalSimulation, advanceLocalSimulation } from '../web/local-simulation.ts';

const epoch = '2000-01-01T00:00:00.000Z';

await test('real local and hosted policy progress retains earned history and once-only calendar receipts', () => {
  const initial = createLocalSimulation();
  assert.equal(nextEarnedHistoryAdvance(initial.state, epoch), null);
  let run = initial;
  let pending: typeof run | null = null;
  for (let window = 0; window < 120 && !run.state.historyAdvances?.['milestone:first-harvest']; window += 1) {
    run = advanceLocalSimulation(run, 1);
    if (!pending && nextEarnedHistoryAdvance(run.state, run.timestamp)) pending = structuredClone(run);
  }
  const proof = run.state.milestoneProofs?.['first-harvest'];
  const receipt = run.state.historyAdvances?.['milestone:first-harvest'];
  assert.ok(proof, 'Actual paid policy research and construction must produce the first harvest');
  assert.ok(receipt);
  assert.equal(proof.targetYear, HISTORICAL_MILESTONES.find(item => item.id === 'first-harvest')!.year);
  assert.equal(receipt.deltaYears, Math.max(0, proof.targetYear - receipt.yearBefore));
  assert.equal(receipt.yearAfter, receipt.yearBefore + receipt.deltaYears);
  assert.ok(receipt.revision > proof.revision);
  assert.ok(isWorldState(run.state));
  const duplicate = applyHistoryAdvance(run.state, { expectedRevision: run.state.revision, cause: receipt.cause, reason: 'Repeat an already consumed earned cause', deltaYears: 0, timestamp: run.timestamp });
  assert.equal(duplicate.ok, false);
  assert.strictEqual(duplicate.state, run.state);
  const pruned = structuredClone(run.state); pruned.events = [];
  assert.ok(isWorldState(pruned));
  assert.deepEqual(pruned.milestoneProofs, run.state.milestoneProofs);
  for (const mutate of [
    (world: typeof pruned) => { world.milestoneProofs!['first-harvest']!.targetYear += 1; },
    (world: typeof pruned) => { world.historyAdvances!['milestone:first-harvest']!.deltaYears += 1; },
    (world: typeof pruned) => { delete world.milestoneProofs!['first-harvest']; },
  ]) { const bad = structuredClone(pruned); mutate(bad); assert.equal(isWorldState(bad), false); }
  assert.ok(pending, 'The actual local run must retain an earned, not yet consumed cause');
  const timestamp = new Date(Date.parse(pending.timestamp) + 10_000).toISOString();
  const previous = createAutonomousState(pending.state, pending.timestamp, true, 'earned-history-activation');
  const wake = planAutonomousWake(pending.state, previous, timestamp, 'earned-history-wake');
  const history = wake.steps.filter(step => step.transition.kind === 'history-advance');
  assert.equal(history.length, 1);
  const step = history[0]!;
  assert.equal(step.provenance.kind, 'procedural-policy');
  assert.equal(step.provenance.model, null);
  assert.equal(step.provenance.policy?.profileId, 'earned-history');
  assert.equal(step.provenance.commandId, step.receiptKey);
  assert.ok(step.transition.kind === 'history-advance');
  assert.equal(step.transition.command.cause.kind, 'milestone');
  assert.ok(isWorldState(wake.state));
  const repeat = planAutonomousWake(wake.state, wake.runtime, timestamp, 'same-window-later-wake');
  assert.deepEqual(repeat.steps, []);
  assert.deepEqual(repeat.state, wake.state);
  assert.deepEqual(repeat.runtime.memories, wake.runtime.memories);
});

await test('unearned or altered authored dates refuse without mutating the actual new world', () => {
  const state = createLocalSimulation().state;
  const before = JSON.stringify(state);
  const rejected = applyHistoryAdvance(state, { expectedRevision: state.revision, cause: { kind: 'milestone', id: 'beyond-earth' }, reason: 'No earned launch preparation exists', deltaYears: 12150, timestamp: epoch });
  assert.equal(rejected.ok, false);
  assert.equal(JSON.stringify(state), before);
});
