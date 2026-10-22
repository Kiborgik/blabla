import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { chooseCivilizationBehavior } from '../core/behaviors.ts';
import type { GameEvent, Route } from '../core/types.ts';
import { advanceLocalSimulation, createLocalSimulation, parseLocalSimulation, type LocalSimulation } from '../web/local-simulation.ts';

const scratch = '.blabla/scratch/autonomous-partnership-stewardship';
let repairCheckpoint: { run: LocalSimulation; routeId: string } | null = null;

function eligible(run: LocalSimulation, route: Route): boolean {
  return !!route.agreement?.enabled && !run.state.publicProjects?.some(project => project.routeId === route.id)
    && [route.owner, route.partner].every(seat => {
      const actor = run.state.civilizations.find(candidate => candidate.id === seat);
      const cities = run.state.cities.filter(city => city.civId === seat);
      return actor?.technologies.includes('civic-institutions') && cities.some(city => city.buildings.includes('monument'))
        && actor.resources.materials >= 20 && actor.resources.energy >= 10 && actor.resources.food >= cities.reduce((sum, city) => sum + city.population, 0) * 2;
    });
}

function eventDelta(before: LocalSimulation, after: LocalSimulation): GameEvent[] {
  const seen = new Set(before.state.events.map(event => event.id));
  return after.state.events.filter(event => !seen.has(event.id));
}

await test('natural nondefault seed 73 uses actual autonomous windows, conserved releases and exact restart continuation', { timeout: 330_000 }, () => {
  mkdirSync(scratch, { recursive: true });
  let run = createLocalSimulation(73, 'settlement-living-partnerships-1');
  assert.ok(run.state.unlockedFeatures.includes('partnership-stewardship'));
  const deadline = Date.now() + 300_000;
  const counts: Record<string, number> = {};
  const decisions: Array<{ round: number; seat: number; type: string; reason: string }> = [];
  const episodes: GameEvent[] = [];
  const completed = new Map<string, { round: number; deliveries: number; deliveredLater: boolean }>();
  let restarted = false;
  while (run.state.round < 120 && !run.state.outcome && Date.now() < deadline) {
    const before = run; run = advanceLocalSimulation(run, 1);
    for (const decision of run.decisions) if (decision.revision > before.state.revision)
      decisions.push({ round: run.state.round, seat: decision.seat, type: decision.action.type, reason: decision.reason });
    for (const event of eventDelta(before, run)) {
      counts[event.type] = (counts[event.type] ?? 0) + 1;
      if (event.type.startsWith('public-project') || event.type === 'trade-stopped') episodes.push(event);
      if (event.publicProjectResult?.outcome === 'completed') {
        const route = run.state.routes.find(route => route.id === event.publicProjectResult?.routeId);
        if (route) completed.set(route.id, { round: run.state.round, deliveries: route.agreement?.deliveryCount ?? 0, deliveredLater: false });
      }
    }
    for (const [routeId, result] of completed) if (run.state.round > result.round && (run.state.routes.find(route => route.id === routeId)?.agreement?.deliveryCount ?? 0) > result.deliveries) result.deliveredLater = true;
    if (!repairCheckpoint && run.steps % 6 !== 5 && run.state.round >= 12) {
      const route = run.state.routes.find(route => eligible(run, route));
      if (route) repairCheckpoint = { run: structuredClone(run), routeId: route.id };
    }
    if (!restarted && (run.state.publicProjects?.length || run.state.round >= 60)) {
      const restored = parseLocalSimulation(JSON.parse(JSON.stringify(run))); assert.ok(restored);
      assert.deepEqual(advanceLocalSimulation(restored, 1), advanceLocalSimulation(run, 1));
      writeFileSync(`${scratch}/natural73-restart.json`, JSON.stringify(run)); restarted = true;
    }
  }
  const summary = { kind: 'natural-autonomous-nondefault-window', seed: 73, round: run.state.round, steps: run.steps, outcome: run.state.outcome,
    milestones: run.state.calendarMilestones, counts, episodes, repairedRoutes: [...completed.entries()], decisions,
    enabledRoutes: run.state.routes.filter(route => route.agreement?.enabled).length,
    deliveries: run.state.routes.reduce((sum, route) => sum + (route.agreement?.deliveryCount ?? 0), 0), restarted,
    syntheticRepairCheckpointAvailable: repairCheckpoint !== null };
  writeFileSync(`${scratch}/natural73-summary.json`, JSON.stringify(summary, null, 2));
  writeFileSync(`${scratch}/natural73-final.json`, JSON.stringify(run));
  assert.ok(run.state.round >= 120 || run.state.outcome, `Finite natural window reached its diagnostic time ceiling at round ${run.state.round}; checkpoint retained, not a completed campaign`);
  assert.ok(restarted); assert.ok(summary.deliveries > 0);
  assert.ok(run.state.calendarMilestones.includes('rise-of-states'));
  assert.ok((counts['research-completed'] ?? 0) > 5);
  assert.ok(decisions.some(decision => decision.type === 'propose-trade'));
  assert.ok(decisions.some(decision => decision.type === 'respond-trade'));
  assert.ok(repairCheckpoint, 'The natural window must establish civic partners with real supplied routes before the separate synthetic perturbation');
});

await test('labelled synthetic damage of a naturally earned partnership produces autonomous consent, paid delayed repair and a separate later shipment', { timeout: 120_000 }, () => {
  assert.ok(repairCheckpoint);
  let run = structuredClone(repairCheckpoint.run);
  const routeId = repairCheckpoint.routeId;
  const route = run.state.routes.find(route => route.id === routeId); assert.ok(route?.agreement);
  const oldDamage = route.damage; route.damage = 25;
  const initial = structuredClone(run); const deadline = Date.now() + 100_000;
  const trace: Array<{ round: number; events: GameEvent[]; decisions: LocalSimulation['decisions'] }> = [];
  let accepted = false; let completed = false; let later = false; let completedRound = -1; let deliveries = -1; let restart = false;
  while (!later && run.state.round < initial.state.round + 20 && !run.state.outcome && Date.now() < deadline) {
    const before = run; run = advanceLocalSimulation(run, 1);
    const events = eventDelta(before, run); trace.push({ round: run.state.round, events, decisions: run.decisions });
    const project = run.state.publicProjects?.find(project => project.routeId === routeId);
    if (project?.status === 'committed') {
      accepted = true;
      if (!restart) {
        const restored = parseLocalSimulation(JSON.parse(JSON.stringify(run))); assert.ok(restored);
        assert.deepEqual(advanceLocalSimulation(restored, 1), advanceLocalSimulation(run, 1)); restart = true;
        writeFileSync(`${scratch}/synthetic73-committed.json`, JSON.stringify(run));
      }
      assert.ok(run.state.round < project.dueRound);
    }
    const result = events.find(event => event.publicProjectResult?.routeId === routeId && event.publicProjectResult.outcome === 'completed')?.publicProjectResult;
    if (result) {
      completed = true; completedRound = run.state.round; deliveries = run.state.routes.find(route => route.id === routeId)?.agreement?.deliveryCount ?? 0;
      assert.deepEqual(result.proposerPaid, { materials: 2, energy: 1 }); assert.deepEqual(result.recipientPaid, { materials: 2, energy: 1 });
      assert.ok((result.damageAfter ?? Infinity) < (result.damageBefore ?? 0));
    }
    if (completed && run.state.round > completedRound && (run.state.routes.find(route => route.id === routeId)?.agreement?.deliveryCount ?? 0) > deliveries) later = true;
  }
  writeFileSync(`${scratch}/synthetic73-repair-journey.json`, JSON.stringify({ kind: 'synthetic-perturbation-of-natural-checkpoint', perturbation: { routeId, damageBefore: oldDamage, damageAfter: 25 }, initialRound: initial.state.round, finalRound: run.state.round, accepted, completed, later, restart, trace }, null, 2));
  assert.ok(accepted, 'Autonomous recipient must accept the repair, not a scripted command');
  assert.ok(completed, 'An actual due receipt must pay both contributions'); assert.ok(later, 'A distinct later due shipment must follow the repair'); assert.ok(restart);
  const nextTimestamp = new Date(Date.parse(run.timestamp) + 10_000).toISOString();
  const restored = parseLocalSimulation(JSON.parse(JSON.stringify(run))); assert.ok(restored);
  assert.deepEqual(chooseCivilizationBehavior(run.state, route.owner, run.memories[route.owner] ?? undefined, nextTimestamp), chooseCivilizationBehavior(restored.state, route.owner, restored.memories[route.owner] ?? undefined, nextTimestamp));
});
