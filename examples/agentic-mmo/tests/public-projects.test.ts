import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCommand, catchUpStrategy, createWorld, legalActions, observe } from '../core/engine.ts';

import { isWorldState } from '../core/validation.ts';
import { isGameAction, validateAttachedPlan } from '../core/planning.ts';
import type { GameAction, PublicProject, TransitionResult, WorldState } from '../core/types.ts';

const epoch = '2026-10-16T00:00:00.000Z';

await test('fresh charter rules enable public projects', () => {
  let state = createWorld(17, epoch, 'settlement-charters-1');
  assert.ok(state.unlockedFeatures.includes('public-projects'));
});

class Journey {
  state = createWorld(17, epoch, 'settlement-charters-1');
  time = Date.parse(epoch);
  accept(run: (state: WorldState) => TransitionResult): TransitionResult {
    const before = structuredClone(this.state);
    const restored: unknown = JSON.parse(JSON.stringify(this.state));
    assert.ok(isWorldState(restored));
    const result = run(this.state);
    assert.equal(result.ok, true, result.error);
    assert.deepEqual(run(restored), result);
    assert.deepEqual(this.state, before);
    assert.ok(isWorldState(result.state));
    this.state = result.state;
    return result;
  }
  timestamp(): string { return new Date(this.time).toISOString(); }
  act(seat: number, action: GameAction): TransitionResult {
    this.accept((state) => catchUpStrategy(state, this.timestamp()));
    assert.ok(legalActions(this.state, seat, this.timestamp()).some((option) => JSON.stringify(option.action) === JSON.stringify(action)), JSON.stringify(action));
    const command = { seat, action, timestamp: this.timestamp(), expectedRevision: this.state.revision };
    const result = this.accept((state) => applyCommand(state, command));
    this.time += 10_000;
    return result;
  }
  beat(): TransitionResult {
    this.time = Date.parse(epoch) + ((this.state.independentTurns?.strategyTicks ?? 0) + 1) * 60_000;
    return this.accept((state) => catchUpStrategy(state, this.timestamp()));
  }
  until(condition: () => boolean): void {
    for (let n = 0; n < 60 && !condition(); n++) this.beat();
    assert.ok(condition());
  }
  build(seat: number, project: string): void {
    const city = this.state.cities.find((candidate) => candidate.civId === seat);
    assert.ok(city);
    this.act(seat, { type: 'build', project, cityId: city.id });
  }
  route(a: number, b: number): void {
    this.act(a, { type: 'propose-trade', partner: b, recipeId: 'harvest-for-materials' });
    const offer = this.state.tradeOffers?.find((candidate) => candidate.proposer === a && candidate.recipient === b && candidate.status === 'pending');
    assert.ok(offer);
    this.act(b, { type: 'respond-trade', offerId: offer.id, accept: true });
  }
  propose(): PublicProject {
    const route = this.state.routes.find((candidate) => candidate.owner === 0 && candidate.partner === 1);
    assert.ok(route);
    this.act(0, { type: 'propose-public-project', routeId: route.id, recipeId: 'joint-road-repair' });
    const project = this.state.publicProjects?.[0];
    assert.ok(project);
    return project;
  }
  commit(): PublicProject {
    const project = this.propose();
    this.act(1, { type: 'respond-public-project', projectId: project.id, accept: true });
    const committed = this.state.publicProjects?.[0];
    assert.ok(committed?.status === 'committed');
    return committed;
  }
}

function prepared(): Journey {
  const j = new Journey();
  for (const seat of [0, 1, 2]) j.act(seat, { type: 'research', technology: 'agriculture' });
  j.until(() => [0, 1, 2].every((seat) => j.state.civilizations[seat]?.technologies.includes('agriculture')));
  for (const seat of [0, 1, 2]) j.build(seat, 'farm');
  for (const seat of [0, 1]) j.act(seat, { type: 'research', technology: 'civic-institutions' });
  j.route(0, 1); j.route(1, 2); j.route(2, 0);
  j.until(() => j.state.calendarMilestones.includes('rise-of-states'));
  assert.ok(j.state.routes.every((route) => (route.agreement?.deliveryCount ?? 0) > 0));
  j.build(0, 'monument'); j.build(1, 'monument');
  j.act(5, { type: 'event', event: 'earthquake', target: 0 });
  j.until(() => j.state.directorCooldown === 0);
  j.act(5, { type: 'event', event: 'earthquake', target: 0 });
  while (j.state.round % 4 !== 2) j.beat();
  return j;
}

await test('legal civic journey consents without escrow then repairs after trade and permits only later cargo', () => {
  const j = prepared();
  const before = structuredClone(j.state);
  const choice = legalActions(j.state, 0, j.timestamp()).find(({ action }) => action.type === 'propose-public-project');
  assert.ok(choice);
  assert.match(choice.reason, /Proposer pledges materials 2, energy 1; recipient pledges materials 2, energy 1/);
  assert.match(choice.reason, /Unfunded pledge/);
  const project = j.commit();
  assert.equal(project.status, 'committed');
  assert.deepEqual(j.state.civilizations, before.civilizations);
  assert.deepEqual(j.state.routes, before.routes);
  assert.deepEqual(project.terms.proposerContribution, { materials: 2, energy: 1 });
  assert.deepEqual(observe(j.state, 1, j.timestamp()).publicProjects, j.state.publicProjects);
  assert.equal(observe(j.state, 2, j.timestamp()).publicProjects?.length, 0);
  j.beat();
  assert.equal(j.state.publicProjects?.length, 1);
  const beforeDue = structuredClone(j.state);
  const result = j.beat();
  const receipt = result.events.find((event) => event.publicProjectResult)?.publicProjectResult;
  assert.equal(receipt?.outcome, 'completed');
  assert.deepEqual(receipt.proposerPaid, { materials: 2, energy: 1 });
  assert.deepEqual(receipt.recipientPaid, { materials: 2, energy: 1 });
  assert.equal(receipt.damageBefore, 50);
  assert.equal(receipt.damageAfter, 25);
  assert.equal(j.state.publicProjects?.length, 0);
  const route = j.state.routes.find((candidate) => candidate.id === project.routeId);
  assert.ok(route?.agreement);
  assert.equal(route.active, false);
  assert.equal(route.volume, 0);
  assert.equal(route.agreement.deliveryCount, beforeDue.routes.find((candidate) => candidate.id === route.id)?.agreement?.deliveryCount);
  assert.ok(result.events.findIndex((event) => event.type === 'trade-blocked') < result.events.findIndex((event) => event.publicProjectResult));
  const count = route.agreement.deliveryCount;
  j.until(() => (j.state.routes.find((candidate) => candidate.id === route.id)?.agreement?.deliveryCount ?? 0) > count);
  const replay = catchUpStrategy(j.state, j.timestamp());
  assert.deepEqual(replay.state, j.state);
});

await test('public charter action shapes are strict and plans bind exact target and consent', () => {
  const actions: GameAction[] = [{ type: 'propose-public-project', routeId: 'route-1', recipeId: 'joint-road-repair' }, { type: 'respond-public-project', projectId: 'project-1', accept: true }, { type: 'cancel-public-project', projectId: 'project-1' }];
  const state = prepared().state;
  for (const action of actions) {
    assert.equal(isGameAction(action), true);
    assert.equal(isGameAction({ ...action, extra: true }), false);
    assert.equal(isGameAction({ ...action, ...(action.type === 'propose-public-project' ? { routeId: '' } : { projectId: '' }) }), false);
    assert.equal(validateAttachedPlan(state, { seat: 0, expectedRevision: state.revision, action }, [{ action, reason: 'Review and submit exactly this action' }]).ok, true);
  }
  assert.equal(isGameAction({ type: 'respond-public-project', projectId: 'p', accept: 1 }), false);
});

await test('crossed duplicate and foreign proposals and responses refuse without a world or admission change', () => {
  const j = prepared();
  const project = j.propose();
  for (const [seat, action] of [[1, { type: 'propose-public-project', routeId: project.routeId, recipeId: project.terms.recipeId }], [2, { type: 'respond-public-project', projectId: project.id, accept: true }], [0, { type: 'respond-public-project', projectId: project.id, accept: true }], [2, { type: 'propose-public-project', routeId: project.routeId, recipeId: project.terms.recipeId }]] as const) {
    const before = structuredClone(j.state);
    const result = applyCommand(j.state, { seat, action, expectedRevision: j.state.revision, timestamp: j.timestamp() });
    assert.equal(result.ok, false);
    assert.deepEqual(result.state, before);
    assert.deepEqual(j.state, before);
  }
});

await test('decline, pending withdrawal, bilateral committed cancellation and expiry each retain a zero-payment receipt', () => {
  for (const mode of ['decline', 'withdraw', 'cancel-proposer', 'cancel-recipient', 'expire'] as const) {
    const j = prepared();
    const project = mode.startsWith('cancel') ? j.commit() : j.propose();
    if (mode === 'decline') j.act(1, { type: 'respond-public-project', projectId: project.id, accept: false });
    else if (mode === 'withdraw' || mode.startsWith('cancel')) j.act(mode === 'cancel-recipient' ? 1 : 0, { type: 'cancel-public-project', projectId: project.id });
    else j.until(() => j.state.publicProjects?.length === 0);
    const receipt = j.state.events.findLast((event) => event.publicProjectResult)?.publicProjectResult;
    assert.equal(receipt?.outcome, mode === 'decline' ? 'declined' : mode === 'expire' ? 'expired' : 'cancelled');
    assert.deepEqual(receipt.proposerPaid, {});
    assert.deepEqual(receipt.recipientPaid, {});
    assert.equal(receipt.damageBefore, receipt.damageAfter);
    assert.equal(j.state.publicProjects?.length, 0);
  }
});

function dueFixture(): { state: WorldState; timestamp: string; project: PublicProject } {
  const j = prepared();
  const project = j.commit();
  j.beat();
  return { state: structuredClone(j.state), timestamp: new Date(Date.parse(epoch) + ((j.state.independentTurns?.strategyTicks ?? 0) + 1) * 60_000).toISOString(), project };
}

function dueCompare(state: WorldState, timestamp: string): { result: TransitionResult; control: TransitionResult } {
  assert.ok(isWorldState(state));
  const before = structuredClone(state);
  const controlState = structuredClone(state);
  controlState.publicProjects = [];
  const result = catchUpStrategy(state, timestamp);
  const control = catchUpStrategy(controlState, timestamp);
  assert.equal(result.ok, true, result.error);
  assert.equal(control.ok, true, control.error);
  assert.deepEqual(state, before);
  assert.ok(isWorldState(result.state));
  assert.deepEqual(catchUpStrategy(structuredClone(state), timestamp), result);
  return { result, control };
}

await test('isolated synthetic shortage on either contributor pays neither side and never retries automatically', () => {
  for (const seat of [0, 1]) {
    const { state, timestamp } = dueFixture();
    const civilization = state.civilizations.find((candidate) => candidate.id === seat);
    const city = state.cities.find((candidate) => candidate.civId === seat);
    assert.ok(civilization && city);
    civilization.resources.energy = 0;
    city.damage = 100;
    const { result, control } = dueCompare(state, timestamp);
    const receipt = result.events.find((event) => event.publicProjectResult)?.publicProjectResult;
    assert.equal(receipt?.outcome, 'failed');
    assert.match(receipt.reason, new RegExp(`Civilization ${seat} contribution shortage`));
    assert.deepEqual(receipt.proposerPaid, {});
    assert.deepEqual(receipt.recipientPaid, {});
    assert.deepEqual(result.state.civilizations, control.state.civilizations);
    assert.deepEqual(result.state.routes, control.state.routes);
    assert.deepEqual(result.state.publicProjects, []);
    assert.deepEqual(catchUpStrategy(result.state, timestamp).state, result.state);
  }
});

await test('isolated synthetic opening-stock shortage can be funded by this beat production, charging exact vectors once', () => {
  const { state, timestamp, project } = dueFixture();
  for (const seat of [0, 1]) {
    const civilization = state.civilizations.find((candidate) => candidate.id === seat);
    const city = state.cities.find((candidate) => candidate.civId === seat);
    assert.ok(civilization && city);
    civilization.resources.energy = 0;
    civilization.resources.materials = 0;
    city.damage = 0;
    city.focus = 'industry';
  }
  const { result, control } = dueCompare(state, timestamp);
  const receipt = result.events.find((event) => event.publicProjectResult)?.publicProjectResult;
  assert.equal(receipt?.outcome, 'completed');
  for (const [seat, cost] of [[0, project.terms.proposerContribution], [1, project.terms.recipientContribution]] as const) {
    const actual = result.state.civilizations[seat];
    const baseline = control.state.civilizations[seat];
    assert.ok(actual && baseline);
    for (const resource of ['food', 'materials', 'energy', 'credits', 'science', 'culture'] as const)
      assert.ok(Math.abs(actual.resources[resource] - (baseline.resources[resource] - (cost[resource] ?? 0))) < 1e-9);
  }
});

await test('isolated target invalidation and fully repaired routes close at due with no payment or target substitution', () => {
  for (const mode of ['missing', 'replaced', 'institution', 'healed', 'partial'] as const) {
    const { state, timestamp, project } = dueFixture();
    const route = state.routes.find((candidate) => candidate.id === project.routeId);
    assert.ok(route?.agreement);
    if (mode === 'missing') {
      state.routes = state.routes.filter((candidate) => candidate.id !== route.id);
      state.tradeOffers = state.tradeOffers?.filter((offer) => offer.routeId !== route.id) ?? [];
    } else if (mode === 'replaced') {
      const offer = state.tradeOffers?.find((candidate) => candidate.id === route.agreement?.offerId);
      assert.ok(offer);
      offer.id = 'replacement-offer';
      route.agreement.offerId = offer.id;
    } else if (mode === 'institution') {
      const city = state.cities.find((candidate) => candidate.civId === 1);
      assert.ok(city);
      city.buildings = city.buildings.filter((building) => building !== 'monument');
    } else route.damage = mode === 'healed' ? 0 : 7;
    const { result, control } = dueCompare(state, timestamp);
    const receipt = result.events.find((event) => event.publicProjectResult)?.publicProjectResult;
    assert.equal(receipt?.outcome, mode === 'healed' ? 'no-work-needed' : mode === 'partial' ? 'completed' : 'failed');
    if (mode === 'partial') {
      assert.equal(receipt.damageBefore, 7);
      assert.equal(receipt.damageAfter, 0);
      assert.deepEqual(receipt.proposerPaid, { materials: 2, energy: 1 });
      assert.deepEqual(receipt.recipientPaid, { materials: 2, energy: 1 });
    } else {
      assert.deepEqual(result.state.civilizations, control.state.civilizations);
      assert.deepEqual(result.state.routes, control.state.routes);
      assert.deepEqual(receipt.proposerPaid, {});
      assert.deepEqual(receipt.recipientPaid, {});
    }
  }
});

await test('stopping consent remains visible until committed due and then invalidates without payment', () => {
  const j = prepared();
  const project = j.commit();
  j.act(0, { type: 'stop-trade', routeId: project.routeId });
  assert.equal(j.state.publicProjects?.length, 1);
  assert.ok(legalActions(j.state, 1, j.timestamp()).some(({ action }) => action.type === 'cancel-public-project' && action.projectId === project.id));
  j.until(() => j.state.publicProjects?.length === 0);
  const receipt = j.state.events.findLast((event) => event.publicProjectResult)?.publicProjectResult;
  assert.equal(receipt?.outcome, 'failed');
  assert.match(receipt.reason, /stopped/);
  assert.deepEqual(receipt.proposerPaid, {});
  assert.deepEqual(receipt.recipientPaid, {});
});

await test('isolated acceptance scarcity, missing institutions and pending recipient withdrawal refuse atomically', () => {
  const j = prepared();
  const project = j.propose();
  for (const mode of ['proposer-shortage', 'recipient-shortage', 'institution', 'recipient-cancel'] as const) {
    const fixture = structuredClone(j.state);
    if (mode.endsWith('shortage')) {
      const civilization = fixture.civilizations[mode === 'proposer-shortage' ? 0 : 1];
      assert.ok(civilization);
      civilization.resources.energy = 0;
    } else if (mode === 'institution') {
      const city = fixture.cities.find((candidate) => candidate.civId === 1);
      assert.ok(city);
      city.buildings = city.buildings.filter((building) => building !== 'monument');
    }
    assert.ok(isWorldState(fixture));
    const before = structuredClone(fixture);
    const action: GameAction = mode === 'recipient-cancel' ? { type: 'cancel-public-project', projectId: project.id } : { type: 'respond-public-project', projectId: project.id, accept: true };
    const result = applyCommand(fixture, { seat: 1, expectedRevision: fixture.revision, timestamp: j.timestamp(), action });
    assert.equal(result.ok, false);
    assert.deepEqual(result.state, before);
    assert.deepEqual(fixture, before);
  }
});

await test('canonical validation rejects hostile active records and terminal receipts while retaining historical terms', () => {
  const j = prepared();
  const project = j.commit();
  const terms = project.terms;
  const invalid: unknown[] = [null, Array(1), [project, project], Array.from({ length: 11 }, (_, n) => ({ ...project, id: `p-${n}` })),
    [{ ...project, proposer: project.recipient }], [{ ...project, dueRound: j.state.round }], [{ ...project, acceptedRound: -1 }], [{ ...project, extra: true }],
    [{ ...project, terms: { ...terms, proposerContribution: { energy: Infinity } } }], [{ ...project, terms: { ...terms, recipientContribution: { unknown: 1 } } }],
    [{ ...project, terms: { ...terms, damageReduction: 101 } }], [{ ...project, terms: { ...terms, completionDelayRounds: 0 } }], [{ ...project, agreementOfferId: '' }]];
  for (const publicProjects of invalid) assert.equal(isWorldState({ ...j.state, publicProjects }), false);
  assert.equal(isWorldState({ ...j.state, publicProjects: undefined }), false);
  const legacy = createWorld(17, epoch);
  assert.equal(isWorldState(legacy), true);
  assert.equal(isWorldState({ ...legacy, publicProjects: [] }), false);
  const historical = structuredClone(j.state);
  const old = historical.publicProjects?.[0];
  assert.ok(old);
  old.terms.recipeVersion = 2;
  old.terms.proposerContribution = { materials: 2.5, energy: 1 };
  assert.equal(isWorldState(historical), true);
  j.until(() => j.state.publicProjects?.length === 0);
  const event = j.state.events.findLast((candidate) => candidate.publicProjectResult);
  assert.ok(event?.publicProjectResult);
  for (const result of [{ ...event.publicProjectResult, proposerPaid: {} }, { ...event.publicProjectResult, damageAfter: 100 }, { ...event.publicProjectResult, reason: '' }, { ...event.publicProjectResult, outcome: 'failed' }]) {
    const fixture = structuredClone(j.state);
    const events: unknown[] = fixture.events.map((candidate) => candidate.id === event.id ? { ...candidate, publicProjectResult: result } : candidate);
    assert.equal(isWorldState({ ...fixture, events }), false);
  }
});


await test('isolated concurrent commitments allocate remaining stock in stable project-ID order', () => {
  const { state, timestamp, project } = dueFixture();
  const otherRoute = state.routes.find((candidate) => candidate.owner === 2 && candidate.partner === 0);
  const partner = state.civilizations[2];
  const partnerCity = state.cities.find((candidate) => candidate.civId === 2);
  const proposer = state.civilizations[0];
  assert.ok(otherRoute?.agreement && partner && partnerCity && proposer);
  partner.technologies.push('civic-institutions');
  partnerCity.buildings.push('monument');
  for (const city of state.cities) city.damage = 100;
  for (const route of state.routes) route.damage = 50;
  proposer.resources.materials = 2;
  proposer.resources.energy = 10;
  state.publicProjects = [{ ...structuredClone(project), id: 'project-z' }, { ...structuredClone(project), id: 'project-a', routeId: otherRoute.id, agreementOfferId: otherRoute.agreement.offerId, recipient: 2 }];
  const { result } = dueCompare(state, timestamp);
  const receipts = result.events.flatMap((event) => event.publicProjectResult ? [event.publicProjectResult] : []);
  assert.deepEqual(receipts.map((receipt) => [receipt.projectId, receipt.outcome]), [['project-a', 'completed'], ['project-z', 'failed']]);
  assert.equal(result.state.civilizations[0]?.resources.materials, 0);
  assert.deepEqual(receipts[1]?.proposerPaid, {});
  assert.deepEqual(receipts[1]?.recipientPaid, {});
});

await test('attached charter plans replay exactly and a resolved consent target invalidates the remaining intent', () => {
  const j = prepared();
  const project = j.propose();
  const action: GameAction = { type: 'respond-public-project', projectId: project.id, accept: true };
  const plan = [{ action, reason: 'Consent to the exact unfunded shared repair' }, { action, reason: 'Reassess this named consent before any later submission' }];
  const command = { seat: 1, action, plan, expectedRevision: j.state.revision, observedRevision: j.state.revision, timestamp: j.timestamp() };
  assert.equal(validateAttachedPlan(j.state, command, [{ action: { ...action, projectId: 'another-project' }, reason: 'Wrong target' }]).ok, false);
  const result = j.accept((state) => applyCommand(state, command));
  assert.equal(result.state.actionPlans?.[1]?.items[0]?.status, 'completed');
  j.time += 10_000;
  assert.equal(observe(j.state, 1, j.timestamp()).actionPlan?.items[1]?.status, 'invalidated');
});
