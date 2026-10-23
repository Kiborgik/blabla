import { seedLocalWorld } from './fixtures/current-world.ts';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Adapter, ProtocolError } from '../../../adapters/typescript/blabla_adapter.ts';
import { createCampaignAdapter } from '../cli/adapter.ts';
import { GameProtocol } from '../cli/protocol.ts';
import { GameStore, isRecord } from '../cli/store.ts';
import { applyCommand, applyDirectorTick, applyHistoryAdvance, createWorld, catchUpClock, catchUpStrategy } from '../core/engine.ts';
import { isGameAction } from '../core/planning.ts';
import { isWorldState } from '../core/validation.ts';
import { TRADE_RECIPES, ECONOMY_RULES } from '../core/content.ts';
import type { WorldState } from '../core/types.ts';

const cli = new URL('../cli/main.ts', import.meta.url).pathname;
const adapterScript = new URL('../cli/adapter.ts', import.meta.url).pathname;

function worldWithAgreement(): WorldState {
  const item = fixture();
  try {
    item.store.initialize(1701);
    const state = item.store.snapshot().state;
    const terms = TRADE_RECIPES.find(recipe => recipe.id === 'harvest-for-materials')?.terms;
    const proposer = state.cities[0];
    const recipient = state.cities[1];
    assert.ok(terms && proposer && recipient);
    state.round = 4;
    state.tradeOffers = [{ id: 'offer-fixture', proposer: proposer.civId, recipient: recipient.civId, from: proposer.id, to: recipient.id, createdRound: 0, expiresRound: 8, status: 'accepted', terms: structuredClone(terms), routeId: 'route-fixture' }];
    state.routes = [{ id: 'route-fixture', from: proposer.id, to: recipient.id, owner: proposer.civId, partner: recipient.civId, active: true, damage: 0, volume: 7, agreement: { offerId: 'offer-fixture', terms: structuredClone(terms), enabled: true, acceptedRound: 0, nextDeliveryRound: 8, lastAttemptRound: 4, lastDeliveryRound: 4, deliveryCount: 1, blockedBy: null, blockedReason: null, closedRound: null } }];
    return state;
  } finally { item.cleanup(); }
}

void test('optional trade snapshots preserve legacy worlds and immutable archived terms after stopped due dates', () => {
  const state = worldWithAgreement();
  assert.equal(isWorldState(state), true);
  const legacy = structuredClone(state);
  delete legacy.tradeOffers;
  const legacyRoute = legacy.routes[0];
  assert.ok(legacyRoute);
  delete legacyRoute.agreement;
  assert.equal(isWorldState(legacy), true);
  const offer = state.tradeOffers?.[0];
  const route = state.routes[0];
  assert.ok(offer && route?.agreement);
  offer.terms.recipeId = 'archived-recipe';
  offer.terms.recipeVersion = 37;
  route.agreement.terms = structuredClone(offer.terms);
  assert.equal(isWorldState(state), true);
  route.agreement.enabled = false;
  route.agreement.closedRound = 4;
  route.active = false;
  route.volume = 0;
  state.round = 12;
  assert.equal(isWorldState(state), true);
});

void test('pending and enabled trade pairs are bounded while blocked delivery preserves its last success', () => {
  const pending = worldWithAgreement();
  const offer = pending.tradeOffers?.[0];
  assert.ok(offer);
  offer.status = 'pending';
  offer.routeId = null;
  pending.routes = [];
  assert.equal(isWorldState(pending), true);
  pending.tradeOffers?.push({ ...structuredClone(offer), id: 'reverse-offer', proposer: offer.recipient, recipient: offer.proposer, from: offer.to, to: offer.from });
  assert.equal(isWorldState(pending), false);
  const reverse = pending.tradeOffers?.[1];
  assert.ok(reverse);
  reverse.status = 'declined';
  assert.equal(isWorldState(pending), true);
  const blocked = worldWithAgreement();
  const connection = blocked.routes[0];
  assert.ok(connection?.agreement);
  blocked.round = 8;
  connection.active = false;
  connection.volume = 0;
  connection.agreement.lastAttemptRound = 8;
  connection.agreement.nextDeliveryRound = 12;
  connection.agreement.blockedBy = connection.partner;
  connection.agreement.blockedReason = 'Combined cargo and upkeep shortage';
  assert.equal(isWorldState(blocked), true);
  const duplicateOffer = structuredClone(blocked.tradeOffers?.[0]);
  assert.ok(duplicateOffer);
  duplicateOffer.id = 'second-accepted-offer';
  duplicateOffer.routeId = 'second-agreement';
  blocked.tradeOffers?.push(duplicateOffer);
  const duplicateRoute = structuredClone(connection);
  assert.ok(duplicateRoute.agreement);
  duplicateRoute.id = 'second-agreement';
  duplicateRoute.agreement.offerId = duplicateOffer.id;
  blocked.routes.push(duplicateRoute);
  assert.equal(isWorldState(blocked), false);
});

void test('canonical validation rejects malformed optional offers, terms, references and agreement counters', () => {
  const mutations: Array<[string, (state: Record<string, unknown>, offer: Record<string, unknown>, agreement: Record<string, unknown>) => void]> = [
    ['offers are an array', (state) => { state.tradeOffers = {}; }],
    ['offer IDs are unique', (state, offer) => { state.tradeOffers = [offer, offer]; }],
    ['offer parties differ', (_state, offer) => { offer.recipient = offer.proposer; }],
    ['offer parties exist', (_state, offer) => { offer.recipient = 8; }],
    ['owned endpoints exist', (_state, offer) => { offer.to = offer.from; }],
    ['creation is not future', (_state, offer) => { offer.createdRound = 5; }],
    ['expiry follows creation', (_state, offer) => { offer.expiresRound = 0; }],
    ['status is known', (_state, offer) => { offer.status = 'paid'; }],
    ['accepted route exists', (_state, offer) => { offer.routeId = 'missing'; }],
    ['accepted offer requires route', (_state, offer) => { offer.routeId = null; }],
    ['pending offer has no route', (_state, offer) => { offer.status = 'pending'; }],
    ['terms cannot contain unknown resources', (_state, offer) => { record(offer.terms).proposerCargo = { gold: 1 }; }],
    ['terms amounts are nonnegative', (_state, offer) => { record(offer.terms).proposerCargo = { food: -1 }; }],
    ['terms amounts are finite', (_state, offer) => { record(offer.terms).proposerCargo = { food: Infinity }; }],
    ['recipe version is a positive integer', (_state, offer) => { record(offer.terms).recipeVersion = 0; }],
    ['cadence is positive', (_state, offer) => { record(offer.terms).cadenceRounds = 0; }],
    ['damage threshold is bounded', (_state, offer) => { record(offer.terms).damageDisableAt = 101; }],
    ['agreement refers to accepted offer', (_state, _offer, agreement) => { agreement.offerId = 'missing'; }],
    ['agreement terms match consent', (_state, _offer, agreement) => { record(agreement.terms).proposerCargo = { food: 99 }; }],
    ['acceptance is not future', (_state, _offer, agreement) => { agreement.acceptedRound = 5; }],
    ['due round is a later strategic beat', (_state, _offer, agreement) => { agreement.nextDeliveryRound = 7; }],
    ['enabled route has no overdue unresolved shipment', (_state, _offer, agreement) => { agreement.nextDeliveryRound = 4; }],
    ['attempt follows acceptance', (_state, _offer, agreement) => { agreement.lastAttemptRound = 0; }],
    ['delivery is not future', (_state, _offer, agreement) => { agreement.lastDeliveryRound = 8; }],
    ['delivery requires an attempt', (_state, _offer, agreement) => { agreement.lastAttemptRound = null; }],
    ['delivery count is safe nonnegative integer', (_state, _offer, agreement) => { agreement.deliveryCount = -1; }],
    ['delivery count agrees with last delivery', (_state, _offer, agreement) => { agreement.deliveryCount = 0; }],
    ['blocker is a participant', (_state, _offer, agreement) => { agreement.blockedBy = 4; agreement.blockedReason = 'shortage'; }],
    ['block reason has string shape', (_state, _offer, agreement) => { agreement.blockedReason = 8; }],
    ['enabled agreement is not closed', (_state, _offer, agreement) => { agreement.closedRound = 4; }],
    ['disabled agreement records closure', (_state, _offer, agreement) => { agreement.enabled = false; }],
  ];
  for (const [label, mutate] of mutations) {
    const state = record(structuredClone(worldWithAgreement()));
    const offer = record(array(state.tradeOffers)[0]);
    const agreement = record(record(array(state.routes)[0]).agreement);
    mutate(state, offer, agreement);
    assert.equal(isWorldState(state), false, label);
  }
});

void test('corrupt optional trade data is refused by durable CLI reads without rewriting original bytes', () => {
  const item = fixture();
  try {
    item.store.initialize(1701);
    const stored = parse(readFileSync(item.store.path, 'utf8'));
    record(stored.state).tradeOffers = { forged: true };
    const bytes = JSON.stringify(stored);
    writeFileSync(item.store.path, bytes);
    assert.throws(() => item.store.snapshot(), ProtocolError);
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
  } finally { item.cleanup(); }
});

function fixture(): { directory: string; store: GameStore; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), 'agentic-cli-'));
  return {
    directory,
    store: new GameStore(join(directory, '.blabla/world.json')),
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function command(revision = 0, seat = 0, commandId = 'real-test-turn'): Record<string, unknown> {
  return { seat, expectedRevision: revision, choice: 0, model: 'gpt-6.1-sol', commandId };
}

void test('explicit action timestamps survive CLI provenance and distinguish changed idempotency requests', () => {
  const item = fixture();
  try {
    item.store.initialize(1701);
    const input = { ...command(), timestamp: '2026-10-16T01:00:00.000Z' };
    assert.equal(item.store.submit(input).ok, true);
    assert.equal(item.store.snapshot().commands[0]?.timestamp, input.timestamp);
    assert.equal(item.store.submit({ ...input, timestamp: '2026-10-16T01:00:10.000Z' }).ok, false);
    assert.equal(item.store.submit(input).duplicate, true);
  } finally { item.cleanup(); }
});

void test('unreleased attached CLI plans are refused without rewriting campaign bytes', () => {
  const item = fixture();
  try {
    item.store.initialize(1701);
    const bytes = readFileSync(item.store.path, 'utf8');
    const result = item.store.submit({ ...command(), plan: [{ action: { type: 'wait' }, reason: 'A real intended action' }] });
    assert.equal(result.ok, false);
    assert.equal(result.actionOutcome?.status, 'failed');
    assert.equal(result.actionOutcome?.code, 'plan_not_released');
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
  } finally { item.cleanup(); }
});

function planningCampaign(store: GameStore, rulesId = 'settlement-plans-1'): void {
  seedLocalWorld(store, createWorld(1701, '2026-10-16T01:00:00.000Z', rulesId));
}

void test('targeted focus and construction use shared optional historical action shapes', () => {
  for (const action of [{ type: 'focus', focus: 'industry' }, { type: 'build', project: 'farm' }]) {
    assert.equal(isGameAction({ ...action, cityId: 'city-0' }), true);
    assert.equal(isGameAction(action), true);
    for (const cityId of [null, 7, '', ' ', 'x'.repeat(129)]) assert.equal(isGameAction({ ...action, cityId }), false);
    assert.equal(isGameAction({ ...action, cityId: 'city-0', fallback: 'city-1' }), false);
  }
});

function frontierCampaign(store: GameStore, rulesId = 'settlement-frontiers-1'): void {
  planningCampaign(store, rulesId);
}

void test('city repair uses one strict shared action shape', () => {
  assert.equal(isGameAction({ type: 'repair-city', cityId: 'city-0' }), true);
  for (const action of [{ type: 'repair-city' }, ...[null, 4, '', ' ', 'x'.repeat(129)].map((cityId) => ({ type: 'repair-city', cityId })), { type: 'repair-city', cityId: 'city-0', amount: 100 }])
    assert.equal(isGameAction(action), false);
});

function recoveryCampaign(store: GameStore): void {
  planningCampaign(store, 'settlement-recovery-1');
}

void test('city recovery CLI process retries charge once and replay released earthquakes exactly', () => {
  const item = fixture();
  try {
    recoveryCampaign(item.store);
    const before = item.store.snapshot().state;
    const quake = { expectedRevision: before.revision, kind: 'event', intervalId: 'cli-recovery-quake', timestamp: '2026-10-16T01:00:00.000Z', event: 'earthquake', target: 0, model: 'gpt-6-astra' };
    assert.equal(item.store.directorTick(quake).ok, true);
    assert.equal(item.store.directorTick(quake).duplicate, true);
    const damaged = item.store.snapshot().state;
    assert.equal(damaged.cities[0]?.damage, 35);
    assert.equal(damaged.cities[0]?.infrastructure, before.cities[0]?.infrastructure);
    const repair = { type: 'repair-city', cityId: 'city-0' };
    const args = ['action', '--seat', '0', '--revision', String(damaged.revision), '--action', JSON.stringify(repair), '--plan', JSON.stringify([{ action: repair, reason: 'Restore the named damaged city' }]), '--at', '2026-10-16T01:00:00.000Z', '--model', 'gpt-6-astra', '--id', 'cli-repair-once'];
    assert.equal(run(item.directory, args).ok, true);
    const first = new GameStore(item.store.path).snapshot();
    assert.equal(first.state.cities[0]?.damage, 10);
    assert.equal(first.state.civilizations[0]?.resources.materials, (damaged.civilizations[0]?.resources.materials ?? 0) - ECONOMY_RULES.repair.cost.materials);
    assert.equal(run(item.directory, args).duplicate, true);
    assert.deepEqual(item.store.snapshot(), first);
    const second = item.store.submit({ seat: 0, expectedRevision: damaged.revision, action: repair, timestamp: '2026-10-16T01:00:10.000Z', model: 'gpt-6-astra', commandId: 'cli-partial-repair' });
    assert.equal(second.ok, true, second.error);
    const repaired = item.store.snapshot();
    assert.equal(repaired.state.cities[0]?.damage, 0);
    assert.equal(repaired.state.civilizations[0]?.resources.materials, (damaged.civilizations[0]?.resources.materials ?? 0) - 2 * ECONOMY_RULES.repair.cost.materials);
    assert.equal(repaired.state.civilizations[0]?.resources.energy, (damaged.civilizations[0]?.resources.energy ?? 0) - 2 * ECONOMY_RULES.repair.cost.energy);
    assert.deepEqual(repaired.state.cities.slice(1), damaged.cities.slice(1));
    const bytes = readFileSync(item.store.path, 'utf8');
    for (const cityId of ['city-0', 'city-1', 'missing-city', '', null]) {
      assert.equal(item.store.submit({ seat: 0, expectedRevision: repaired.state.revision, action: { type: 'repair-city', cityId }, timestamp: '2026-10-16T01:00:20.000Z', model: 'gpt-6-astra', commandId: `refused-repair-${String(cityId)}` }).ok, false);
      assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
    }
    const changed = [...args];
    changed[changed.indexOf('--action') + 1] = JSON.stringify({ ...repair, cityId: 'city-1' });
    assert.equal(run(item.directory, changed).ok, false);
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
    let reproduced = repaired.initial;
    for (const transition of repaired.timeline) {
      const result = transition.kind === 'action' ? applyCommand(reproduced, transition.command)
          : transition.kind === 'director-tick' ? applyDirectorTick(reproduced, transition.command) : null;
      assert.ok(result?.ok);
      reproduced = result.state;
    }
    assert.deepEqual(reproduced, repaired.state);
  } finally { item.cleanup(); }
});

void test('synthetic historical earthquake saves retain their original infrastructure loss during replay', () => {
  const item = fixture();
  try {
    item.store.initialize(1701, false, '2026-10-16T01:00:00.000Z');
    const saved = item.store.snapshot();
    saved.initial.unlockedFeatures.push('disaster-recovery');
    saved.state.unlockedFeatures.push('disaster-recovery');
    writeFileSync(item.store.path, JSON.stringify(saved));
    const historical = item.store.snapshot().state;
    assert.equal(historical.unlockedFeatures.includes('city-repair'), false);
    assert.equal(isWorldState(historical), true);
    const quake = { expectedRevision: historical.revision, kind: 'event', intervalId: 'historical-quake', timestamp: '2026-10-16T01:00:00.000Z', event: 'earthquake', target: 0, model: 'gpt-6-astra' };
    assert.equal(item.store.directorTick(quake).ok, true);
    const damaged = new GameStore(item.store.path).snapshot();
    assert.equal(damaged.state.cities[0]?.infrastructure, (historical.cities[0]?.infrastructure ?? 0) - 1);
    assert.equal(damaged.state.cities[0]?.damage, 35);
    const transition = damaged.timeline[0];
    assert.ok(transition?.kind === 'director-tick');
    const replayed = applyDirectorTick(damaged.initial, transition.command);
    assert.equal(replayed.ok, true);
    assert.deepEqual(replayed.state, damaged.state);
    assert.equal(item.store.directorTick(quake).duplicate, true);
    assert.deepEqual(item.store.snapshot(), damaged);
  } finally { item.cleanup(); }
});

void test('malformed stored city repair actions fail closed without rewriting campaign bytes', () => {
  const item = fixture();
  try {
    recoveryCampaign(item.store);
    const state = item.store.snapshot().state;
    assert.equal(item.store.directorTick({ expectedRevision: state.revision, kind: 'event', intervalId: 'corrupt-repair-quake', timestamp: '2026-10-16T01:00:00.000Z', event: 'earthquake', target: 0, model: 'gpt-6-astra' }).ok, true);
    assert.equal(item.store.submit({ seat: 0, expectedRevision: item.store.snapshot().state.revision, action: { type: 'repair-city', cityId: 'city-0' }, timestamp: '2026-10-16T01:00:00.000Z', model: 'gpt-6-astra', commandId: 'repair-shape-fixture' }).ok, true);
    const saved = parse(readFileSync(item.store.path, 'utf8'));
    for (const action of [{ type: 'repair-city' }, { type: 'repair-city', cityId: null }, { type: 'repair-city', cityId: ' ' }, { type: 'repair-city', cityId: 'city-0', amount: 999 }]) {
      for (const field of ['commands', 'timeline']) {
        const corrupted = structuredClone(saved);
        const entry = array(corrupted[field]).map(record).find((candidate) => field === 'commands' || candidate.kind === 'action');
        assert.ok(entry);
        const storedCommand = field === 'commands' ? entry : record(entry.command);
        storedCommand.action = action;
        const bytes = JSON.stringify(corrupted);
        writeFileSync(item.store.path, bytes);
        assert.throws(() => item.store.snapshot(), ProtocolError);
        assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
      }
    }
  } finally { item.cleanup(); }
});

void test('city-targeted CLI actions preserve exact current town targets and process retries', () => {
  const item = fixture();
  try {
    frontierCampaign(item.store, 'settlement-specialization-1');
    const act = (action: Record<string, unknown>, timestamp: string, commandId: string) => {
      const reply = item.store.submit({ seat: 0, expectedRevision: item.store.snapshot().state.revision, action, timestamp, model: 'gpt-6-astra', commandId });
      assert.equal(reply.ok, true, reply.error);
    };
    const founding = item.store.observation(0).legalActions.find((option) => option.action.type === 'settle')?.action;
    assert.ok(founding);
    act(founding, '2026-10-16T01:00:00.000Z', 'city-target-frontier');
    act({ type: 'research', technology: 'agriculture' }, '2026-10-16T01:00:10.000Z', 'city-target-cultivation');
    assert.equal(item.store.strategyCatchUp({ expectedRevision: item.store.snapshot().state.revision, timestamp: '2026-10-16T01:02:00.000Z', commandId: 'city-target-research-beats' }).ok, true);
    act({ type: 'focus', focus: 'industry', cityId: 'city-0' }, '2026-10-16T01:02:00.000Z', 'legacy-wide-focus');
    act({ type: 'build', project: 'farm', cityId: 'city-0' }, '2026-10-16T01:02:10.000Z', 'legacy-first-building');
    const legacy = item.store.snapshot().state;
    const cities = legacy.cities.filter((city) => city.civId === 0);
    const target = cities.find((city) => city.id !== 'city-0');
    assert.ok(target);
    assert.equal(cities.length, 2);
    assert.equal(cities[0]?.focus, 'industry');
    assert.equal(cities[0]?.buildings.includes('farm'), true);
    assert.equal(target.buildings.includes('farm'), false);
    const revision = item.store.snapshot().state.revision;
    const focus = { type: 'focus', focus: 'growth', cityId: target.id };
    const build = { type: 'build', project: 'farm', cityId: target.id };
    const plan = [{ action: focus, reason: 'Feed the frontier while the capital supplies materials' }, { action: build, reason: 'Review a farm at this named settlement' }];
    const args = ['action', '--seat', '0', '--revision', String(revision), '--action', JSON.stringify(focus), '--plan', JSON.stringify(plan), '--at', '2026-10-16T01:02:20.000Z', '--model', 'gpt-6-astra', '--id', 'cli-target-focus'];
    assert.equal(run(item.directory, args).ok, true);
    assert.equal(run(item.directory, args).duplicate, true);
    const focused = item.store.snapshot().state;
    assert.equal(focused.cities.find((city) => city.id === target.id)?.focus, 'growth');
    assert.deepEqual(focused.cities.find((city) => city.id === 'city-0'), legacy.cities.find((city) => city.id === 'city-0'));
    const buildReply = item.store.submit({ seat: 0, expectedRevision: revision, action: build, plan: [{ action: build, reason: 'Build the reviewed frontier farm' }], timestamp: '2026-10-16T01:02:30.000Z', model: 'gpt-6-astra', commandId: 'cli-target-build' });
    assert.equal(buildReply.ok, true, buildReply.error);
    const built = item.store.snapshot();
    assert.equal(built.state.cities.find((city) => city.id === target.id)?.buildings.includes('farm'), true);
    assert.equal(built.state.actionPlans?.[0]?.observedRevision, revision);
    const bytes = readFileSync(item.store.path, 'utf8');
    for (const action of [{ type: 'focus', focus: 'research' }, { ...focus, cityId: 'city-1' }, { ...build, cityId: target.id }]) {
      assert.equal(item.store.submit({ seat: 0, expectedRevision: built.state.revision, action, timestamp: '2026-10-16T01:02:40.000Z', model: 'gpt-6-astra', commandId: `refused-${JSON.stringify(action)}` }).ok, false);
      assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
    }
    const changed = [...args];
    changed[changed.indexOf('--action') + 1] = JSON.stringify({ ...focus, cityId: 'city-0' });
    assert.equal(run(item.directory, changed).ok, false);
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
    let reproduced = built.initial;
    for (const transition of built.timeline) {
      const result = transition.kind === 'action' ? applyCommand(reproduced, transition.command)
          : transition.kind === 'strategy-catchup' ? catchUpStrategy(reproduced, transition.timestamp) : null;
      assert.ok(result?.ok);
      reproduced = result.state;
    }
    assert.deepEqual(reproduced, built.state);
  } finally { item.cleanup(); }
});

void test('stored targeted focus and build reject malformed city IDs in both command collections', () => {
  const item = fixture();
  try {
    item.store.initialize(1701);
    assert.equal(item.store.submit(command()).ok, true);
    const saved = parse(readFileSync(item.store.path, 'utf8'));
    for (const action of [{ type: 'focus', focus: 'industry', cityId: 4 }, { type: 'build', project: 'farm', cityId: '' }]) {
      for (const field of ['commands', 'timeline']) {
        const corrupted = structuredClone(saved);
        const entry = record(array(corrupted[field])[0]);
        const storedCommand = field === 'commands' ? entry : record(entry.command);
        storedCommand.action = action;
        const bytes = JSON.stringify(corrupted);
        writeFileSync(item.store.path, bytes);
        assert.throws(() => item.store.snapshot(), ProtocolError);
        assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
      }
    }
  } finally { item.cleanup(); }
});

void test('CLI frontier founding requires explicit source and survives separate process retry', () => {
  const item = fixture();
  try {
    frontierCampaign(item.store);
    const before = item.store.snapshot().state;
    const view = item.store.observation(0);
    const action = view.legalActions.find((option) => option.action.type === 'settle')?.action;
    assert.ok(action?.type === 'settle');
    assert.equal(action.sourceCityId, 'city-0');
    const bytes = readFileSync(item.store.path, 'utf8');
    const missing = item.store.submit({ seat: 0, expectedRevision: before.revision, action: { type: 'settle', tileId: action.tileId }, timestamp: '2026-10-16T01:00:00.000Z', model: 'gpt-6-astra', commandId: 'missing-source' });
    assert.equal(missing.ok, false);
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
    const args = ['action', '--seat', '0', '--revision', String(before.revision), '--action', JSON.stringify(action), '--at', '2026-10-16T01:00:00.000Z', '--model', 'gpt-6-astra', '--id', 'cli-frontier'];
    assert.equal(run(item.directory, args).ok, true);
    assert.equal(run(item.directory, args).duplicate, true);
    const after = item.store.snapshot();
    assert.equal(after.state.cities[0]?.population, (before.cities[0]?.population ?? 0) - ECONOMY_RULES.settle.population);
    assert.equal(after.state.cities.length, before.cities.length + 1);
    assert.deepEqual(after.commands.at(-1)?.action, action);
    assert.equal(isWorldState(after.state), true);
    const replay = item.store.replay();
    let reproduced = replay.initial;
    for (const transition of replay.timeline) {
      const next = transition.kind === 'action' ? applyCommand(reproduced, transition.command) : null;
      assert.ok(next?.ok);
      reproduced = next.state;
    }
    assert.deepEqual(reproduced, after.state);
  } finally { item.cleanup(); }
});

void test('historical source-less founding remains shape-valid and replays its original population behavior', () => {
  const item = fixture();
  try {
    item.store.initialize(1701);
    const legacy = item.store.snapshot();
    legacy.initial.unlockedFeatures.push('settlement-expansion');
    legacy.state.unlockedFeatures.push('settlement-expansion');
    writeFileSync(item.store.path, JSON.stringify(legacy));
    const founding = item.store.observation(0).legalActions.find((option) => option.action.type === 'settle')?.action;
    assert.ok(founding?.type === 'settle');
    assert.equal(Object.hasOwn(founding, 'sourceCityId'), false);
    assert.equal(item.store.submit({ seat: 0, expectedRevision: 0, action: founding, model: 'gpt-6-astra', commandId: 'archived-source-less' }).ok, true);
    const bytes = readFileSync(item.store.path, 'utf8');
    const replay = item.store.replay();
    const archived = replay.commands[0];
    assert.ok(archived);
    const result = applyCommand(replay.initial, archived);
    assert.equal(result.ok, true);
    assert.deepEqual(result.state, item.store.snapshot().state);
    assert.equal(result.state.cities[0]?.population, legacy.state.cities[0]?.population);
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
  } finally { item.cleanup(); }
});

void test('stored founding command shapes reject malformed present sources without rewriting campaign bytes', () => {
  const item = fixture();
  try {
    item.store.initialize(1701);
    assert.equal(item.store.submit(command()).ok, true);
    const saved = parse(readFileSync(item.store.path, 'utf8'));
    for (const sourceCityId of [7, null, '', '   ', 'x'.repeat(129)]) {
      for (const field of ['commands', 'timeline']) {
        const corrupt = structuredClone(saved);
        const first = record(array(corrupt[field])[0]);
        const storedCommand = field === 'commands' ? first : record(first.command);
        storedCommand.action = { type: 'settle', tileId: 0, sourceCityId };
        const bytes = JSON.stringify(corrupt);
        writeFileSync(item.store.path, bytes);
        assert.throws(() => item.store.replay(), ProtocolError, `${field}: ${String(sourceCityId)}`);
        assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
      }
    }
  } finally { item.cleanup(); }
});

void test('unconstructed operation records are rejected without rewriting legacy campaign bytes', () => {
  const item = fixture();
  try {
    item.store.initialize(1701);
    const current = item.store.snapshot();
    assert.equal(Object.hasOwn(current.state.cities[0] ?? {}, 'buildingOperations'), false);
    const corrupt = record(structuredClone(current));
    const city = record(array(record(corrupt.state).cities)[0]);
    city.buildingOperations = { 'unconstructed-operation': { enabled: true, lastResult: null } };
    assert.equal(isWorldState(corrupt.state), false);
    const bytes = JSON.stringify(corrupt);
    writeFileSync(item.store.path, bytes);
    assert.throws(() => item.store.observation(0), ProtocolError);
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
  } finally { item.cleanup(); }
});

function worldWithOperation(): WorldState {
  const item = fixture();
  try {
    planningCampaign(item.store, 'settlement-production-1');
    const state = item.store.snapshot().state;
    const city = state.cities[0];
    const civilization = state.civilizations[0];
    assert.ok(city && civilization);
    state.round = 4;
    civilization.technologies = ['agriculture', 'water-management'];
    city.buildings.push('irrigation');
    city.buildingOperations = { irrigation: { enabled: true, lastResult: { round: 3, status: 'operated', paid: { materials: 1 }, produced: { food: 5.75 }, shortages: [] } } };
    return state;
  } finally { item.cleanup(); }
}

void test('canonical operation records reject malformed shape, accounting and chronology', () => {
  assert.equal(isWorldState(worldWithOperation()), true);
  const mutations: Array<[string, (state: Record<string, unknown>, city: Record<string, unknown>, operation: Record<string, unknown>, result: Record<string, unknown>) => void]> = [
    ['map must be an object', (_state, city) => { city.buildingOperations = []; }],
    ['required paid operation cannot be absent', (_state, city) => { delete city.buildingOperations; }],
    ['required paid operation cannot be omitted', (_state, city) => { city.buildingOperations = {}; }],
    ['unconstructed operations are forbidden', (_state, city, operation) => { record(city.buildingOperations).kiln = operation; }],
    ['free buildings cannot have paid operation records', (_state, city, operation) => { array(city.buildings).push('farm'); record(city.buildingOperations).farm = operation; }],
    ['operation requires enabled boolean', (_state, _city, operation) => { operation.enabled = 'yes'; }],
    ['operation requires last result or null', (_state, _city, operation) => { delete operation.lastResult; }],
    ['operation rejects unknown fields', (_state, _city, operation) => { operation.reserved = 1; }],
    ['result status must be known', (_state, _city, _operation, result) => { result.status = 'queued'; }],
    ['result round cannot be future', (_state, _city, _operation, result) => { result.round = 5; }],
    ['result round must be nonnegative integer', (_state, _city, _operation, result) => { result.round = -1; }],
    ['result rejects unknown fields', (_state, _city, _operation, result) => { result.current = true; }],
    ['paid amounts must use known resources', (_state, _city, _operation, result) => { result.paid = { gold: 1 }; }],
    ['paid amounts cannot be negative', (_state, _city, _operation, result) => { result.paid = { materials: -1 }; }],
    ['paid amounts must be finite', (_state, _city, _operation, result) => { result.paid = { materials: Infinity }; }],
    ['produced amounts must use known resources', (_state, _city, _operation, result) => { result.produced = { gold: 1 }; }],
    ['produced amounts cannot be negative', (_state, _city, _operation, result) => { result.produced = { food: -1 }; }],
    ['shortages must be an array', (_state, _city, _operation, result) => { result.shortages = {}; }],
    ['operated result cannot have shortages', (_state, _city, _operation, result) => { result.shortages = [{ resource: 'materials', required: 1, available: 0 }]; }],
    ['paused result cannot report payment', (_state, _city, _operation, result) => { result.status = 'paused'; result.produced = {}; }],
    ['blocked result requires shortages', (_state, _city, _operation, result) => { result.status = 'blocked'; result.paid = {}; result.produced = {}; }],
    ['operations require their released capability', (state) => { state.unlockedFeatures = array(state.unlockedFeatures).filter((feature) => feature !== 'building-operations'); }],
  ];
  for (const [label, mutate] of mutations) {
    const state = record(worldWithOperation());
    const city = record(array(state.cities)[0]);
    const operation = record(record(city.buildingOperations).irrigation);
    const result = record(operation.lastResult);
    mutate(state, city, operation, result);
    assert.equal(isWorldState(state), false, label);
  }
});

void test('historical operation facts survive toggles and tuning while malformed shortages fail closed', () => {
  const state = worldWithOperation();
  const city = state.cities[0];
  const operation = city?.buildingOperations?.irrigation;
  assert.ok(city && operation);
  operation.enabled = false;
  assert.equal(isWorldState(state), true);
  operation.lastResult = { round: 1, status: 'operated', paid: { energy: 2.25 }, produced: {}, shortages: [] };
  assert.equal(isWorldState(state), true);
  operation.enabled = true;
  operation.lastResult = { round: 2, status: 'paused', paid: {}, produced: {}, shortages: [] };
  assert.equal(isWorldState(state), true);
  const blocked = { round: 3, status: 'blocked', paid: {}, produced: {}, shortages: [{ resource: 'materials', required: 2, available: 0.25 }] } as const;
  operation.lastResult = structuredClone({ ...blocked, shortages: [...blocked.shortages] });
  assert.equal(isWorldState(state), true);
  const corruptions: unknown[] = [
    [{ resource: 'gold', required: 2, available: 0 }],
    [{ resource: 'materials', required: 1, available: 1 }],
    [{ resource: 'materials', required: 0, available: 0 }],
    [{ resource: 'materials', required: 1, available: -1 }],
    [{ resource: 'materials', required: Infinity, available: 0 }],
    [{ resource: 'materials', required: 1, available: NaN }],
    [{ resource: 'materials', required: 1, available: 0, extra: true }],
    [blocked.shortages[0], blocked.shortages[0]],
    Array.from({ length: 1 }),
  ];
  for (const shortages of corruptions) {
    const corrupted = record(structuredClone(state));
    const result = record(record(record(record(array(corrupted.cities)[0]).buildingOperations).irrigation).lastResult);
    result.shortages = shortages;
    assert.equal(isWorldState(corrupted), false);
  }
  operation.lastResult = null;
  assert.equal(isWorldState(state), true);
  city.buildings = [];
  city.buildingOperations = {};
  assert.equal(isWorldState(state), true);
  delete city.buildingOperations;
  assert.equal(isWorldState(state), true);
});

void test('CLI paid operations survive restarted pause and resume commands with exact replay', () => {
  const item = fixture();
  try {
    planningCampaign(item.store, 'settlement-production-1');
    const act = (action: Record<string, unknown>, timestamp: string, commandId: string) => {
      const reply = item.store.submit({ seat: 0, expectedRevision: item.store.snapshot().state.revision, action, timestamp, model: 'gpt-6-astra', commandId });
      assert.equal(reply.ok, true, reply.error);
    };
    const beat = (timestamp: string, commandId: string) => {
      const reply = item.store.strategyCatchUp({ expectedRevision: item.store.snapshot().state.revision, timestamp, commandId });
      assert.equal(reply.ok, true, reply.error);
    };
    act({ type: 'research', technology: 'agriculture' }, '2026-10-16T01:00:00.000Z', 'cultivation');
    beat('2026-10-16T01:04:00.000Z', 'four-beats');
    act({ type: 'research', technology: 'water-management' }, '2026-10-16T01:04:00.000Z', 'water');
    beat('2026-10-16T01:06:00.000Z', 'water-beats');
    act({ type: 'build', project: 'irrigation' }, '2026-10-16T01:06:00.000Z', 'irrigation');
    beat('2026-10-16T01:07:00.000Z', 'first-operation');
    const before = item.store.snapshot().state;
    const previousResult = before.cities[0]?.buildingOperations?.irrigation?.lastResult;
    assert.equal(previousResult?.status, 'operated');
    const pause = { type: 'set-building-operation', cityId: 'city-0', buildingId: 'irrigation', enabled: false };
    const plan = [{ action: pause, reason: 'Reserve materials for the next improvement' }, { action: { ...pause, enabled: true }, reason: 'Review reserves before resuming irrigation' }];
    const args = ['action', '--seat', '0', '--revision', String(before.revision), '--action', JSON.stringify(pause), '--plan', JSON.stringify(plan), '--at', '2026-10-16T01:07:00.000Z', '--model', 'gpt-6-astra', '--id', 'pause-paid'];
    assert.equal(run(item.directory, args).ok, true);
    assert.equal(run(item.directory, args).duplicate, true);
    assert.deepEqual(item.store.snapshot().state.cities[0]?.buildingOperations?.irrigation, { enabled: false, lastResult: previousResult });
    const bytes = readFileSync(item.store.path, 'utf8');
    const rejected = item.store.submit({ seat: 1, expectedRevision: before.revision, action: pause, timestamp: '2026-10-16T01:07:00.000Z', model: 'gpt-6-astra', commandId: 'outsider-pause' });
    assert.equal(rejected.ok, false);
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
    beat('2026-10-16T01:08:00.000Z', 'paused-beat');
    const paused = item.store.snapshot().state;
    assert.equal(paused.cities[0]?.buildingOperations?.irrigation?.lastResult?.status, 'paused');
    const observed = run(item.directory, ['observe', '--seat', '0', '--at', '2026-10-16T01:08:00.000Z']);
    assert.deepEqual(observed.buildingRecipes, [{ buildingId: 'irrigation', inputs: { materials: 1 }, outputs: { food: 5 } }]);
    assert.equal(record(array(record(observed.actionPlan).items)[1]).status, 'ready');
    act({ ...pause, enabled: true }, '2026-10-16T01:08:00.000Z', 'explicit-resume');
    beat('2026-10-16T01:09:00.000Z', 'resumed-beat');
    assert.equal(item.store.snapshot().state.cities[0]?.buildingOperations?.irrigation?.lastResult?.status, 'operated');
    const replay = item.store.replay();
    let reproduced = replay.initial;
    for (const transition of replay.timeline) {
      const result = transition.kind === 'action' ? applyCommand(reproduced, transition.command)
          : transition.kind === 'strategy-catchup' ? catchUpStrategy(reproduced, transition.timestamp) : null;
      assert.ok(result?.ok);
      reproduced = result.state;
    }
    assert.deepEqual(reproduced, item.store.snapshot().state);
  } finally { item.cleanup(); }
});

void test('attached CLI plans survive process restart, retain original revision and require explicit successor submission', () => {
  const item = fixture();
  try {
    planningCampaign(item.store);
    const plan = [{ action: { type: 'focus', focus: 'industry' }, reason: 'Stock materials' }, { action: { type: 'wait' }, reason: 'Reassess stock before spending' }];
    const args = ['action', '--seat', '0', '--revision', '0', '--action', JSON.stringify(plan[0]?.action), '--plan', JSON.stringify(plan), '--at', '2026-10-16T01:00:00.000Z', '--model', 'gpt-6-astra', '--id', 'planned-cli'];
    const reply = run(item.directory, args);
    assert.equal(reply.ok, true);
    assert.equal(record(reply.actionOutcome).status, 'completed');
    const stale = item.store.submit({ seat: 1, expectedRevision: 0, observedRevision: 999, action: plan[0]?.action, plan, timestamp: '2026-10-16T01:00:00.000Z', model: 'gpt-6-astra', commandId: 'second-planned-cli' });
    assert.equal(stale.ok, true);
    assert.equal(item.store.snapshot().state.actionPlans?.[1]?.observedRevision, 0);
    assert.equal(item.store.snapshot().commands[1]?.observedRevision, 0);
    assert.equal(run(item.directory, args).duplicate, true);
    const changedArgs = [...args];
    changedArgs[changedArgs.indexOf('--plan') + 1] = JSON.stringify([{ ...plan[0], reason: 'Changed intent' }]);
    const beforeFailure = readFileSync(item.store.path, 'utf8');
    assert.equal(run(item.directory, changedArgs).ok, false);
    assert.equal(readFileSync(item.store.path, 'utf8'), beforeFailure);
    const blocked = run(item.directory, ['observe', '--seat', '0', '--at', '2026-10-16T01:00:00.000Z']);
    assert.equal(record(array(record(blocked.actionPlan).items)[1]).status, 'blocked');
    const ready = run(item.directory, ['observe', '--seat', '0', '--at', '2026-10-16T01:00:10.000Z']);
    assert.equal(record(array(record(ready.actionPlan).items)[1]).status, 'ready');
    assert.equal(readFileSync(item.store.path, 'utf8'), beforeFailure);
    assert.equal(item.store.strategyCatchUp({ expectedRevision: 2, timestamp: '2026-10-16T01:01:00.000Z', commandId: 'planning-beat' }).ok, true);
    const afterBeat = item.store.snapshot();
    assert.equal(afterBeat.commands.length, 2);
    assert.equal(afterBeat.state.actionPlans?.[0]?.items[1]?.status, 'needs-review');
    const failureBytes = readFileSync(item.store.path, 'utf8');
    const refusal = item.store.submit({ seat: 0, expectedRevision: 3, action: { type: 'wait' }, plan: [{ action: { type: 'wait' }, reason: '' }], timestamp: '2026-10-16T01:01:00.000Z', model: 'gpt-6-astra', commandId: 'invalid-replan' });
    assert.equal(refusal.actionOutcome?.status, 'failed');
    assert.equal(readFileSync(item.store.path, 'utf8'), failureBytes);
    assert.equal(item.store.submit({ seat: 0, expectedRevision: 3, action: { type: 'wait' }, timestamp: '2026-10-16T01:01:00.000Z', model: 'gpt-6-astra', commandId: 'explicit-follow-up' }).ok, true);
    assert.equal(item.store.snapshot().state.actionPlans?.[0], null);
    assert.notEqual(item.store.snapshot().state.actionPlans?.[1], null);
    const replay = item.store.replay();
    let reproduced = replay.initial;
    for (const transition of replay.timeline) {
      const result = transition.kind === 'action' ? applyCommand(reproduced, transition.command)
          : transition.kind === 'strategy-catchup' ? catchUpStrategy(reproduced, transition.timestamp) : null;
      assert.ok(result?.ok);
      reproduced = result.state;
    }
    assert.deepEqual(reproduced, item.store.snapshot().state);
  } finally { item.cleanup(); }
});

void test('corrupt durable plan slots fail before observation without rewriting bytes', () => {
  const item = fixture();
  try {
    planningCampaign(item.store);
    const campaign = parse(readFileSync(item.store.path, 'utf8'));
    record(campaign.state).actionPlans = [];
    const bytes = JSON.stringify(campaign);
    writeFileSync(item.store.path, bytes);
    assert.throws(() => item.store.observation(0), ProtocolError);
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
  } finally { item.cleanup(); }
});

void test('canonical plans reject malformed slots and persisted derived statuses', () => {
  const item = fixture();
  try {
    planningCampaign(item.store);
    for (let revision = 0; revision < 2; revision++) assert.equal(item.store.submit({ seat: 0, expectedRevision: revision, action: { type: 'wait' }, timestamp: `2026-10-16T01:00:${revision}0.000Z`, commandId: `plan-validation-${revision}`, model: 'gpt-6.1-sol' }).ok, true);
    const state = item.store.snapshot().state;
    assert.equal(isWorldState(state), true);
    const plan = { observedRevision: 1, committedRevision: 2, items: [{ action: { type: 'wait' }, reason: 'Hold resources', status: 'completed', result: 'Accepted' }, { action: { type: 'wait' }, reason: 'Reassess later', status: 'needs-review', result: 'Needs model review' }] };
    const valid = { ...state, actionPlans: [plan, null, null, null, null, null] };
    assert.equal(isWorldState(valid), true);
    const invalid: unknown[] = [undefined, null, {}, [], Array.from({ length: 6 }), [plan], [...valid.actionPlans, null], [{ ...plan, observedRevision: 2 }, ...valid.actionPlans.slice(1)], [{ ...plan, committedRevision: 4 }, ...valid.actionPlans.slice(1)], [{ ...plan, items: [...plan.items, plan.items[1]] }, ...valid.actionPlans.slice(1)], [{ ...plan, items: plan.items.map((entry, index) => ({ ...entry, status: index === 0 ? 'completed' : 'ready' })) }, ...valid.actionPlans.slice(1)]];
    const sparse = Array.from({ length: 6 }, () => null);
    Reflect.deleteProperty(sparse, '0');
    invalid.push(sparse);
    for (const actionPlans of invalid) assert.equal(isWorldState({ ...state, actionPlans }), false, JSON.stringify(actionPlans));
    const absent = { ...state };
    delete absent.actionPlans;
    assert.equal(isWorldState(absent), false);
    const legacy = createWorld(1701, '2026-10-16T01:00:00.000Z');
    assert.equal(isWorldState(legacy), true);
    assert.equal(isWorldState({ ...legacy, actionPlans: Array.from({ length: 6 }, () => null) }), false);
  } finally { item.cleanup(); }
});

void test('canonical independent admission data rejects corrupt counters and feature mismatches', () => {
  const item = fixture();
  try {
    item.store.initialize(1701);
    const state = record(item.store.snapshot().state);
    state.unlockedFeatures = [...array(state.unlockedFeatures), 'independent-actions'];
    state.independentTurns = { epoch: '2026-10-16T01:00:00.000Z', strategyTicks: 0, lastActionWindow: [-1, -1, -1, -1, -1, -1], actionsInWindow: [0, 0, 0, 0, 0, 0] };
    assert.equal(isWorldState(state), true);
    const mutations: Array<[string, (world: Record<string, unknown>, admission: Record<string, unknown>) => void]> = [
      ['missing independent state', (world) => { delete world.independentTurns; }],
      ['feature absent', (world) => { world.unlockedFeatures = array(world.unlockedFeatures).filter((id) => id !== 'independent-actions'); }],
      ['null admission', (world) => { world.independentTurns = null; }],
      ['invalid epoch', (_world, admission) => { admission.epoch = 'yesterday'; }],
      ['negative ticks', (_world, admission) => { admission.strategyTicks = -1; }],
      ['fractional ticks', (_world, admission) => { admission.strategyTicks = 0.5; }],
      ['ticks exceed total rounds', (_world, admission) => { admission.strategyTicks = 1; }],
      ['missing Director window', (_world, admission) => { admission.lastActionWindow = [-1, -1, -1, -1, -1]; }],
      ['window lower bound', (_world, admission) => { admission.lastActionWindow = [-2, -1, -1, -1, -1, -1]; }],
      ['future unsafe window', (_world, admission) => { admission.lastActionWindow = [Number.MAX_SAFE_INTEGER, -1, -1, -1, -1, -1]; admission.actionsInWindow = [1, 0, 0, 0, 0, 0]; }],
      ['action cannot cross unrealized strategy boundary', (_world, admission) => { admission.lastActionWindow = [6, -1, -1, -1, -1, -1]; admission.actionsInWindow = [1, 0, 0, 0, 0, 0]; }],
      ['missing action counts', (_world, admission) => { delete admission.actionsInWindow; }],
      ['excess budget', (_world, admission) => { admission.lastActionWindow = [0, -1, -1, -1, -1, -1]; admission.actionsInWindow = [2, 0, 0, 0, 0, 0]; }],
      ['unspent window has no count', (_world, admission) => { admission.actionsInWindow = [1, 0, 0, 0, 0, 0]; }],
    ];
    for (const [label, mutate] of mutations) {
      const changed = structuredClone(state);
      mutate(changed, record(changed.independentTurns));
      assert.equal(isWorldState(changed), false, label);
    }
  } finally { item.cleanup(); }
});

void test('independent CLI fixture accepts explicit concurrent intents and separate strategy pulses across restart', () => {
  const item = fixture();
  try {
    seedLocalWorld(item.store, createWorld(1701, '2026-10-16T01:00:00.000Z', 'settlement-independent-1'));
    assert.equal(item.store.observation(4).activeSeat, null);
    const input = { expectedRevision: 0, action: { type: 'focus', focus: 'industry' }, timestamp: '2026-10-16T01:00:00.000Z', model: 'gpt-6-astra' };
    assert.equal(item.store.submit({ ...input, seat: 4, commandId: 'vesper-independent' }).ok, true);
    assert.equal(item.store.submit({ ...input, seat: 1, commandId: 'verdant-independent' }).ok, true);
    assert.equal(item.store.snapshot().state.round, 0);
    const bytes = readFileSync(item.store.path, 'utf8');
    assert.equal(item.store.submit({ ...input, seat: 4, commandId: 'vesper-too-fast' }).ok, false);
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
    assert.equal(item.store.submit({ ...command(0, 0, 'stale-choice'), timestamp: input.timestamp }).ok, false);
    const protocol = new GameProtocol(new GameStore(item.store.path));
    const pulse = { op: 'strategy-catchup', expectedRevision: 2, timestamp: '2026-10-16T01:02:00.000Z', commandId: 'strategy-two' };
    assert.equal(record(protocol.handle(pulse)).ok, true);
    assert.equal(record(protocol.handle(pulse)).duplicate, true);
    const state = item.store.snapshot().state;
    assert.equal(state.round, 2);
    assert.equal(state.clockTicks, 0);
    assert.equal(state.independentTurns?.strategyTicks, 2);
    assert.equal(item.store.replay().timeline.at(-1)?.kind, 'strategy-catchup');
    assert.equal(item.store.replay().provenance.at(-1)?.kind, 'clock-service');
    const noDue = { op: 'strategy-catchup', expectedRevision: state.revision, timestamp: pulse.timestamp, commandId: 'strategy-no-due' };
    assert.equal(record(protocol.handle(noDue)).ok, true);
    const restarted = new GameProtocol(new GameStore(item.store.path));
    assert.equal(record(restarted.handle({ ...noDue, timestamp: '2026-10-16T01:03:00.000Z' })).ok, false);
    assert.equal(record(restarted.handle(noDue)).duplicate, true);
    assert.equal(item.store.snapshot().state.round, 2);
  } finally { item.cleanup(); }
});

void test('one-shot independent commands preserve explicit timestamps and strategy catchup across processes', () => {
  const item = fixture();
  try {
    seedLocalWorld(item.store, createWorld(1701, '2026-10-16T01:00:00.000Z', 'settlement-independent-1'));
    assert.equal(run(item.directory, ['action', '--seat', '3', '--revision', '0', '--action', '{"type":"wait"}', '--at', '2026-10-16T01:00:10.000Z', '--model', 'gpt-6-astra', '--id', 'cli-independent']).ok, true);
    assert.equal(run(item.directory, ['strategy-catchup', '--revision', '1', '--at', '2026-10-16T01:01:00.000Z', '--id', 'cli-strategy']).ok, true);
    const view = run(item.directory, ['observe', '--seat', '0']);
    assert.equal(view.activeSeat, null);
    assert.equal(view.round, 1);
  } finally { item.cleanup(); }
});

function record(value: unknown): Record<string, unknown> {
  assert.ok(isRecord(value));
  return value;
}

function array(value: unknown): unknown[] {
  assert.ok(Array.isArray(value));
  return value;
}

function parse(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  return record(value);
}

function run(directory: string, args: string[], input?: string) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: directory,
    encoding: 'utf8',
    ...(input === undefined ? {} : { input }),
  });
  assert.equal(result.status, 0, result.stderr);
  return parse(result.stdout);
}

function child(directory: string, args: string[]): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const processChild = spawn(process.execPath, [cli, ...args], { cwd: directory });
    let stdout = '';
    let stderr = '';
    processChild.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });
    processChild.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });
    processChild.on('error', reject);
    processChild.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr));
        return;
      }
      try {
        resolve(parse(stdout));
      } catch (failure) {
        reject(failure instanceof Error ? failure : new Error(String(failure)));
      }
    });
  });
}

void test('initialization is durable and never silently overwrites an existing world', () => {
  const item = fixture();
  try {
    const initialized = item.store.initialize(31);
    assert.equal(initialized.ok, true);
    const before = item.store.snapshot();
    assert.equal(new GameStore(item.store.path).snapshot().state.seed, 31);
    assert.equal(item.store.initialize(99).ok, false);
    assert.deepEqual(item.store.snapshot(), before);
  } finally {
    item.cleanup();
  }
});

void test('structured observations enumerate legal choices and accepted turns preserve real provenance', () => {
  const item = fixture();
  try {
    item.store.initialize(31);
    const protocol = new GameProtocol(item.store);
    assert.ok(protocol instanceof Adapter);
    const observation = record(protocol.handle({ op: 'observe', seat: 0 }));
    assert.equal(observation.revision, 0);
    assert.equal(record(array(observation.choices)[0]).choice, 0);
    assert.equal(item.store.submit(command()).ok, true);
    const snapshot = item.store.snapshot();
    assert.equal(snapshot.state.revision, 1);
    assert.equal(snapshot.provenance[0]?.model, 'gpt-6.1-sol');
    assert.equal(snapshot.provenance[0]?.kind, 'development-agent');
    assert.equal(snapshot.provenance[0]?.seat, 0);
    assert.deepEqual(snapshot.provenance[0]?.action, snapshot.commands[0]?.action);
  } finally {
    item.cleanup();
  }
});

void test('invalid choices, malformed commands and stale revisions never change the engine state', () => {
  const item = fixture();
  try {
    item.store.initialize(31);
    const before = item.store.snapshot().state;
    for (const input of [
      { ...command(), choice: -1 },
      { ...command(), choice: Number.MAX_SAFE_INTEGER },
      { ...command(), choice: 0.5 },
      { ...command(), seat: 5 },
      { ...command(), expectedRevision: 99 },
      { ...command(), model: '' },
      { ...command(), action: { type: 'unknown' }, choice: undefined },
      { ...command(), choice: undefined },
      { ...command(), seat: '0' },
    ]) {
      const result = item.store.submit(input);
      assert.equal(result.ok, false);
      assert.equal(result.last_valid, false);
      assert.deepEqual(item.store.snapshot().state, before);
      assert.equal(item.store.snapshot().commands.length, 0);
    }
  } finally {
    item.cleanup();
  }
});

void test('idempotency retries accept the same command once and reject reused ids with changed payloads', () => {
  const item = fixture();
  try {
    item.store.initialize(31);
    assert.equal(item.store.submit(command()).ok, true);
    const duplicate = item.store.submit(command());
    assert.equal(duplicate.ok, true);
    assert.equal(duplicate.duplicate, true);
    assert.equal(item.store.snapshot().state.revision, 1);
    assert.equal(item.store.submit({ ...command(), choice: 1 }).ok, false);
    assert.equal(new GameStore(item.store.path).submit(command()).duplicate, true);
    assert.equal(item.store.snapshot().lastValid, true);
    assert.equal(item.store.snapshot().commands.length, 1);
  } finally {
    item.cleanup();
  }
});

void test('exported unfinished replay reproduces every accepted frame without invented actions', () => {
  const item = fixture();
  try {
    item.store.initialize(31);
    for (let seat = 0; seat < 6; seat += 1)
      assert.equal(item.store.submit(command(seat, seat, `turn-${seat}`)).ok, true);
    const replay = item.store.replay();
    assert.equal(replay.source, 'development-agents');
    assert.equal(replay.commands.length, 6);
    assert.equal(replay.provenance.length, 6);
    let state = replay.initial;
    for (const [index, action] of replay.commands.entries()) {
      const result = applyCommand(state, action);
      assert.equal(result.ok, true);
      state = result.state;
      assert.deepEqual(replay.frames[index]?.state, state);
    }
    assert.equal(state.round, replay.initial.round + 1);
    assert.equal(state.outcome, null);
    assert.equal(state.releaseId, replay.initial.releaseId);
    assert.deepEqual(state.unlockedFeatures, replay.initial.unlockedFeatures);
  } finally {
    item.cleanup();
  }
});

void test('CLI restarts load the caller working directory and stale subprocess writes are refused', () => {
  const item = fixture();
  try {
    assert.equal(run(item.directory, ['init', '--seed', '73']).ok, true);
    assert.equal(
      run(item.directory, [
        'action',
        '--seat',
        '0',
        '--revision',
        '0',
        '--choice',
        '0',
        '--model',
        'gpt-6.1-sol',
        '--id',
        'cli-turn',
      ]).ok,
      true,
    );
    assert.equal(run(item.directory, ['observe']).revision, 1);
    assert.equal(
      run(item.directory, [
        'action',
        '--seat',
        '1',
        '--revision',
        '0',
        '--choice',
        '0',
        '--model',
        'gpt-6.1-sol',
      ]).ok,
      false,
    );
    const exported = run(item.directory, ['replay', '--out', 'replay.json']);
    assert.equal(exported.ok, true);
    const replay = parse(readFileSync(join(item.directory, 'replay.json'), 'utf8'));
    assert.equal(array(replay.commands).length, 1);
  } finally {
    item.cleanup();
  }
});

void test('concurrent processes cannot both accept the same expected revision', async () => {
  const item = fixture();
  try {
    run(item.directory, ['init']);
    const args = [
      'action',
      '--seat',
      '0',
      '--revision',
      '0',
      '--choice',
      '0',
      '--model',
      'gpt-6.1-sol',
    ];
    const results = await Promise.all([
      child(item.directory, [...args, '--id', 'a']),
      child(item.directory, [...args, '--id', 'b']),
    ]);
    assert.equal(results.filter((result) => result.ok === true).length, 1);
    assert.equal(run(item.directory, ['observe']).revision, 1);
  } finally {
    item.cleanup();
  }
});

void test('BlaBla uses the actual shared transport, bounded choices and durable restart action', () => {
  const item = fixture();
  try {
    const adapter = createCampaignAdapter(item.store);
    assert.ok(adapter instanceof Adapter);
    adapter.handle({ op: 'reset' });
    adapter.handle({ op: 'call', name: 'play', args: [0, -1] });
    assert.equal(record(adapter.handle({ op: 'observe' })).last_valid, false);
    adapter.handle({ op: 'call', name: 'play', args: [0, 0] });
    const before = adapter.handle({ op: 'observe' });
    assert.equal(record(before).revision, 1);
    adapter.handle({ op: 'call', name: 'restart', args: [] });
    assert.deepEqual(adapter.handle({ op: 'observe' }), before);
    assert.equal(item.store.snapshot().provenance[0]?.kind, 'contract-probe');
    assert.equal(item.store.replay().source, 'contract-probes');
    const result = spawnSync(process.execPath, [adapterScript], {
      cwd: item.directory,
      input:
        '{"id":1,"op":"reset"}\n{"id":2,"op":"call","name":"play","args":[0,0]}\n{"id":3,"op":"call","name":"restart","args":[]}\n{"id":4,"op":"observe"}\n',
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const responses = result.stdout
      .trim()
      .split('\n')
      .map((line) => parse(line));
    assert.equal(record(responses[3]?.result).revision, 1);
    assert.equal(item.store.snapshot().state.revision, 1);
    const restarted = spawnSync(process.execPath, [adapterScript], {
      cwd: item.directory,
      input: '{"id":5,"op":"observe"}\n',
      encoding: 'utf8',
    });
    assert.equal(restarted.status, 0, restarted.stderr);
    assert.equal(record(parse(restarted.stdout).result).revision, 1);
  } finally {
    item.cleanup();
  }
});

void test('six adapter holds commit a real round and preserve it through durable restart', () => {
  const item = fixture();
  try {
    const adapter = createCampaignAdapter(item.store);
    const initial = item.store.snapshot().state;
    for (let seat = 0; seat < 6; seat += 1) {
      assert.equal(item.store.snapshot().state.phase, seat);
      assert.doesNotThrow(() => adapter.handle({ op: 'call', name: 'hold', args: [] }));
      assert.equal(record(adapter.handle({ op: 'observe' })).revision, seat + 1);
    }
    const completed = item.store.snapshot();
    assert.equal(completed.state.round, initial.round + 1);
    assert.equal(completed.state.phase, 0);
    assert.equal(completed.state.year, initial.year);
    assert.notDeepEqual(completed.state.civilizations, initial.civilizations);
    assert.deepEqual(
      completed.commands.map((entry) => entry.seat),
      [0, 1, 2, 3, 4, 5],
    );
    assert.ok(completed.commands.every((entry) => entry.action.type === 'wait'));
    assert.ok(
      completed.provenance.every(
        (entry) => entry.kind === 'contract-probe' && entry.model === null,
      ),
    );
    const restartedStore = new GameStore(item.store.path);
    const restarted = createCampaignAdapter(restartedStore);
    assert.deepEqual(restarted.handle({ op: 'observe' }), adapter.handle({ op: 'observe' }));
    restarted.handle({ op: 'call', name: 'restart', args: [] });
    assert.deepEqual(restartedStore.snapshot(), completed);
    assert.equal(restartedStore.replay().source, 'contract-probes');
  } finally {
    item.cleanup();
  }
});

void test('malformed JSONL is rejected without breaking subsequent requests or resetting the world', () => {
  const item = fixture();
  try {
    const result = spawnSync(process.execPath, [cli], {
      cwd: item.directory,
      input:
        'bad json\n[]\n{"id":1,"op":"init","seed":17}\n{"id":2,"op":"action","seat":"bad"}\n{"id":3,"op":"observe"}\n',
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr.trim().split('\n').length, 2);
    const responses = result.stdout
      .trim()
      .split('\n')
      .map((line) => parse(line));
    assert.deepEqual(
      responses.map((response) => response.id),
      [1, 2, 3],
    );
    assert.equal(record(responses[1]?.result).ok, false);
    assert.equal(record(responses[2]?.result).revision, 0);
  } finally {
    item.cleanup();
  }
});

void test('corrupt and incompatible durable stores fail safely without overwriting data', () => {
  const item = fixture();
  try {
    item.store.initialize(31);
    for (const text of ['broken', '{"schemaVersion":99}']) {
      writeFileSync(item.store.path, text);
      assert.throws(() => item.store.snapshot(), ProtocolError);
      assert.equal(readFileSync(item.store.path, 'utf8'), text);
    }
  } finally {
    item.cleanup();
  }
});

void test('replay export refuses to overwrite the durable campaign', () => {
  const item = fixture();
  try {
    run(item.directory, ['init']);
    const before = readFileSync(item.store.path, 'utf8');
    const result = spawnSync(process.execPath, [cli, 'replay', '--out', item.store.path], {
      cwd: item.directory,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.equal(parse(result.stdout).ok, false);
    assert.equal(readFileSync(item.store.path, 'utf8'), before);
  } finally {
    item.cleanup();
  }
});

void test('a dead writer lock is recovered without resetting the committed world', () => {
  const item = fixture();
  try {
    item.store.initialize(31);
    const before = item.store.snapshot();
    const exited = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
    assert.equal(exited.status, 0);
    writeFileSync(`${item.store.path}.lock`, JSON.stringify({ pid: exited.pid }));
    assert.deepEqual(item.store.snapshot(), before);
  } finally {
    item.cleanup();
  }
});

function tickCommand(revision = 0): Record<string, unknown> {
  return {
    expectedRevision: revision,
    kind: 'event',
    intervalId: '2026-10-16T00:00:00.000Z/event',
    timestamp: '2026-10-16T00:00:00.000Z',
    event: 'calm',
    target: 0,
    model: 'gpt-6.1-sol',
  };
}

void test('Director ticks have durable interval guards and do not consume civilization turns', () => {
  const item = fixture();
  try {
    item.store.initialize(31, false, '2026-10-16T00:00:00.000Z');
    const before = item.store.snapshot().state;
    const accepted = item.store.directorTick(tickCommand());
    assert.equal(accepted.ok, true);
    const state = item.store.snapshot().state;
    assert.equal(state.phase, before.phase);
    assert.equal(state.year, before.year);
    assert.equal(item.store.directorTick(tickCommand()).duplicate, true);
    assert.equal(item.store.directorTick({ ...tickCommand(), event: 'drought' }).ok, false);
    assert.equal(item.store.snapshot().state.revision, state.revision);
    assert.equal(item.store.snapshot().commands.length, 0);
    assert.equal(item.store.snapshot().timeline.length, 1);
    assert.equal(item.store.snapshot().provenance[0]?.operation, 'director-tick');
  } finally {
    item.cleanup();
  }
});

void test('explicit clock catchup persists bounded ticks and mixed replay reproduces its timeline', () => {
  const item = fixture();
  try {
    const epoch = '2026-10-16T00:00:00.000Z';
    item.store.initialize(31, false, epoch);
    assert.equal(item.store.submit(command()).ok, true);
    const before = item.store.snapshot().state;
    const timestamp = '2026-10-16T00:18:00.000Z';
    const caught = item.store.catchUp({
      expectedRevision: before.revision,
      timestamp,
      commandId: 'three-clock-ticks',
      model: 'gpt-6.1-sol',
    });
    assert.equal(caught.ok, true);
    assert.equal(caught.remainingTicks, 0);
    const state = new GameStore(item.store.path).snapshot().state;
    assert.equal(state.clockTicks, 3);
    assert.equal(state.phase, before.phase);
    assert.equal(state.year, before.year + 30);
    assert.equal(
      item.store.catchUp({
        expectedRevision: before.revision,
        timestamp,
        commandId: 'three-clock-ticks',
        model: 'gpt-6.1-sol',
      }).duplicate,
      true,
    );
    const replay = item.store.replay();
    let reproduced = replay.initial;
    for (const entry of replay.timeline) {
      const result =
        entry.kind === 'action'
          ? applyCommand(reproduced, entry.command)
          : entry.kind === 'director-tick'
            ? applyDirectorTick(reproduced, entry.command)
            : entry.kind === 'clock-catchup' ? catchUpClock(reproduced, entry.timestamp)
              : entry.kind === 'strategy-catchup' ? catchUpStrategy(reproduced, entry.timestamp)
              : entry.kind === 'history-advance' ? applyHistoryAdvance(reproduced, entry.command) : assert.fail('Only current recorded operations are executable');
      assert.equal(result.ok, true);
      reproduced = result.state;
    }
    assert.deepEqual(reproduced, state);
    assert.equal(replay.commands.length, 1);
    assert.equal(replay.timeline.length, 2);
  } finally {
    item.cleanup();
  }
});

void test('clock requests require explicit timestamps and stale writes cannot apply catchup', () => {
  const item = fixture();
  try {
    item.store.initialize(31, false, '2026-10-16T00:00:00.000Z');
    const before = item.store.snapshot().state;
    for (const request of [
      { expectedRevision: 99, timestamp: '2026-10-16T00:12:00.000Z', model: 'gpt-6.1-sol' },
      { expectedRevision: 0, timestamp: 'bad', model: 'gpt-6.1-sol' },
      { expectedRevision: 0, model: 'gpt-6.1-sol' },
    ]) {
      assert.equal(item.store.catchUp(request).ok, false);
      assert.deepEqual(item.store.snapshot().state, before);
    }
  } finally {
    item.cleanup();
  }
});

void test('an invalid clock epoch is a recoverable JSONL request error', () => {
  const item = fixture();
  try {
    const result = spawnSync(process.execPath, [cli], {
      cwd: item.directory,
      input: '{"id":1,"op":"init","seed":17,"clockEpoch":"bad"}\n{"id":2,"op":"init","seed":17}\n',
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const responses = result.stdout
      .trim()
      .split('\n')
      .map((line) => parse(line));
    assert.equal(record(responses[0]?.result).ok, false);
    assert.equal(record(responses[1]?.result).ok, true);
  } finally {
    item.cleanup();
  }
});

void test('large clock catchup reports remaining work and deterministic service provenance', () => {
  const item = fixture();
  try {
    item.store.initialize(31, false, '2026-10-16T00:00:00.000Z');
    const request = {
      expectedRevision: 0,
      timestamp: '2026-10-17T00:06:00.000Z',
      commandId: 'bounded-clock-batch',
    };
    const first = item.store.catchUp(request);
    assert.equal(first.ok, true);
    assert.equal(first.remainingTicks, 1);
    assert.equal(item.store.snapshot().state.clockTicks, 240);
    assert.equal(item.store.snapshot().provenance[0]?.kind, 'clock-service');
    assert.equal(item.store.snapshot().provenance[0]?.model, null);
    assert.equal(item.store.catchUp(request).remainingTicks, 1);
    assert.equal(
      item.store.catchUp({
        ...request,
        commandId: 'last-clock-tick',
        expectedRevision: first.revision,
      }).remainingTicks,
      0,
    );
    assert.equal(item.store.snapshot().state.clockTicks, 241);
    assert.equal(item.store.replay().source, 'builtin-policies');
  } finally {
    item.cleanup();
  }
});

void test('legacy action-only campaigns expose inferred timeline without rewriting original history', () => {
  const item = fixture();
  try {
    item.store.initialize(31);
    item.store.submit(command());
    const legacy = parse(readFileSync(item.store.path, 'utf8'));
    delete legacy.timeline;
    for (const entry of array(legacy.provenance)) delete record(entry).operation;
    const original = JSON.stringify(legacy);
    writeFileSync(item.store.path, original);
    const replay = item.store.replay();
    assert.equal(replay.timeline[0]?.kind, 'action');
    assert.equal(replay.provenance[0]?.operation, 'action');
    assert.equal(readFileSync(item.store.path, 'utf8'), original);
  } finally {
    item.cleanup();
  }
});

void test('CLI host operations preserve an explicit epoch across catchup and Director review', () => {
  const item = fixture();
  try {
    const epoch = '2026-10-16T00:00:00.000Z';
    assert.equal(run(item.directory, ['init', '--clock-epoch', epoch]).ok, true);
    const caught = run(item.directory, [
      'catchup',
      '--revision',
      '0',
      '--at',
      '2026-10-16T00:12:00.000Z',
      '--id',
      'host-check',
    ]);
    assert.equal(caught.ok, true);
    assert.equal(caught.revision, 2);
    assert.equal(caught.remainingTicks, 0);
    assert.equal(
      run(item.directory, [
        'tick',
        '--revision',
        '2',
        '--kind',
        'review',
        '--interval',
        'review-1',
        '--at',
        '2026-10-16T00:12:00.000Z',
        '--model',
        'gpt-6.1-sol',
      ]).ok,
      true,
    );
    const observation = run(item.directory, ['observe']);
    assert.equal(observation.clockEpoch, epoch);
    assert.equal(observation.clockTicks, 2);
    assert.equal(observation.activeSeat, 0);
    assert.equal(observation.revision, 3);
  } finally {
    item.cleanup();
  }
});

void test('valid JSON with a corrupt persisted year is refused before observation or clock writes', () => {
  const item = fixture();
  try {
    item.store.initialize(31, false, '2026-10-16T00:00:00.000Z');
    const campaign = parse(readFileSync(item.store.path, 'utf8'));
    record(campaign.state).year = 'broken';
    const original = JSON.stringify(campaign);
    writeFileSync(item.store.path, original);
    assert.throws(() => item.store.snapshot(), ProtocolError);
    assert.throws(() => item.store.observation(), ProtocolError);
    assert.throws(
      () =>
        item.store.catchUp({
          expectedRevision: 0,
          timestamp: '2026-10-16T00:06:00.000Z',
          commandId: 'corrupt-clock',
        }),
      ProtocolError,
    );
    assert.equal(readFileSync(item.store.path, 'utf8'), original);
  } finally {
    item.cleanup();
  }
});

void test('actor supplied IDs cannot occupy the Director interval receipt namespace', () => {
  const item = fixture();
  try {
    item.store.initialize(31, false, '2026-10-16T00:00:00.000Z');
    const actor = command(0, 0, 'director:clock:1');
    assert.equal(item.store.submit(actor).ok, true);
    const tick = {
      expectedRevision: 1,
      kind: 'clock',
      intervalId: '1',
      timestamp: '2026-10-16T00:06:00.000Z',
      event: 'calm',
      target: 0,
    };
    const receipt = item.store.directorTick(tick);
    assert.equal(receipt.ok, true);
    assert.equal(item.store.snapshot().state.clockTicks, 1);
    assert.equal(item.store.submit(actor).duplicate, true);
    assert.equal(item.store.directorTick(tick).duplicate, true);
    assert.equal(item.store.snapshot().state.revision, 2);
    assert.deepEqual(
      item.store.snapshot().provenance.map((entry) => entry.operation),
      ['action', 'director-tick'],
    );
  } finally {
    item.cleanup();
  }
});

void test('contract adapter projects the canonical year and ordinary probe turns preserve it', () => {
  const item = fixture();
  try {
    const adapter = createCampaignAdapter(item.store);
    const initial = record(adapter.handle({ op: 'observe' }));
    assert.equal(initial.year, item.store.snapshot().state.year);
    assert.ok(Number.isSafeInteger(initial.year));
    for (let seat = 0; seat < 6; seat += 1)
      adapter.handle({ op: 'call', name: 'play', args: [seat, 0] });
    const after = record(adapter.handle({ op: 'observe' }));
    assert.equal(after.year, initial.year);
    adapter.handle({ op: 'call', name: 'restart', args: [] });
    assert.equal(record(adapter.handle({ op: 'observe' })).year, after.year);
  } finally {
    item.cleanup();
  }
});

const corruptWorldChanges: Array<{
  name: string;
  mutate: (state: Record<string, unknown>) => void;
}> = [
  {
    name: 'clock tick type',
    mutate: (state) => {
      state.clockTicks = 'one';
    },
  },
  {
    name: 'clock epoch',
    mutate: (state) => {
      state.clockEpoch = 'not-utc';
    },
  },
  {
    name: 'partial clock fields',
    mutate: (state) => {
      delete state.clockTicks;
    },
  },
  {
    name: 'nonfinite resource shape',
    mutate: (state) => {
      record(record(array(state.civilizations)[0]).resources).food = null;
    },
  },
  {
    name: 'negative resource stock',
    mutate: (state) => {
      record(record(array(state.civilizations)[0]).resources).food = -1;
    },
  },
  {
    name: 'city population type',
    mutate: (state) => {
      record(array(state.cities)[0]).population = 'six';
    },
  },
  {
    name: 'city reference',
    mutate: (state) => {
      record(array(state.cities)[0]).civId = 99;
    },
  },
  {
    name: 'duplicate civilization ID',
    mutate: (state) => {
      record(array(state.civilizations)[1]).id = 0;
    },
  },
  {
    name: 'event count type',
    mutate: (state) => {
      record(state.eventCounts)['world-founded'] = 'one';
    },
  },
  {
    name: 'Director interval timestamp',
    mutate: (state) => {
      record(state.directorIntervals)['event:invalid'] = 'not-utc';
    },
  },
];

for (const change of corruptWorldChanges) {
  void test(`stored canonical worlds reject ${change.name} without rewriting history`, () => {
    const item = fixture();
    try {
      item.store.initialize(31, false, '2026-10-16T00:00:00.000Z');
      const campaign = parse(readFileSync(item.store.path, 'utf8'));
      change.mutate(record(campaign.state));
      const original = JSON.stringify(campaign);
      writeFileSync(item.store.path, original);
      assert.throws(() => item.store.snapshot(), ProtocolError);
      assert.equal(readFileSync(item.store.path, 'utf8'), original);
    } finally {
      item.cleanup();
    }
  });
}

void test('legacy pre-clock action-only worlds stay readable without installing a clock or rewriting bytes', () => {
  const item = fixture();
  try {
    item.store.initialize(31);
    item.store.submit(command());
    const legacy = parse(readFileSync(item.store.path, 'utf8'));
    const states = [
      record(legacy.initial),
      record(legacy.state),
      ...array(legacy.frames).map((frame) => record(record(frame).state)),
    ];
    for (const state of states) {
      delete state.clockEpoch;
      delete state.clockTicks;
    }
    const original = JSON.stringify(legacy);
    writeFileSync(item.store.path, original);
    const observation = item.store.observation();
    assert.equal(observation.revision, 1);
    assert.equal(observation.clockEpoch, null);
    assert.equal(observation.clockTicks, 0);
    assert.equal(readFileSync(item.store.path, 'utf8'), original);
  } finally {
    item.cleanup();
  }
});

void test('canonical validation is strict by default and legacy support never mutates its input', () => {
  const item = fixture();
  try {
    item.store.initialize(31);
    const world = record(parse(readFileSync(item.store.path, 'utf8')).state);
    assert.equal(isWorldState(world), true);
    delete world.clockEpoch;
    delete world.clockTicks;
    const before = JSON.stringify(world);
    assert.equal(isWorldState(world), false);
    assert.equal(isWorldState(world, { allowLegacyClock: true }), true);
    assert.equal(JSON.stringify(world), before);
    world.directorIntervals = { 'clock:1': '2026-10-16T00:06:00.000Z' };
    assert.equal(isWorldState(world, { allowLegacyClock: true }), false);
  } finally {
    item.cleanup();
  }
});

void test('pre-clock historical records remain readable but cannot execute current system operations', () => {
  const item = fixture();
  try {
    item.store.initialize(31);
    const legacy = parse(readFileSync(item.store.path, 'utf8'));
    for (const world of [record(legacy.initial), record(legacy.state)]) {
      delete world.clockEpoch;
      delete world.clockTicks;
    }
    writeFileSync(item.store.path, JSON.stringify(legacy));
    assert.equal(item.store.directorTick(tickCommand()).ok, false);
    assert.equal(item.store.snapshot().state.revision, 0);
    assert.equal(item.store.snapshot().timeline.length, 0);
    assert.equal(item.store.observation().clockEpoch, null);
  } finally {
    item.cleanup();
  }
});

for (const location of ['initial', 'frame']) {
  void test(`corrupt ${location} world cannot enter a valid current replay`, () => {
    const item = fixture();
    try {
      item.store.initialize(31);
      item.store.submit(command());
      const campaign = parse(readFileSync(item.store.path, 'utf8'));
      const world =
        location === 'initial'
          ? record(campaign.initial)
          : record(record(array(campaign.frames)[0]).state);
      world.year = 'broken';
      const original = JSON.stringify(campaign);
      writeFileSync(item.store.path, original);
      assert.throws(() => item.store.replay(), ProtocolError);
      assert.equal(readFileSync(item.store.path, 'utf8'), original);
    } finally {
      item.cleanup();
    }
  });
}

function releaseRequest(revision = 0): Record<string, unknown> {
  return { op: 'release-apply', expectedRevision: revision, expectedFromReleaseId: 'settlement-foundations-1', targetReleaseId: 'settlement-foundations-2', model: 'gpt-6.1-sol', commandId: 'release-2' };
}

function advanceRequest(revision = 0): Record<string, unknown> {
  return { op: 'history-advance', expectedRevision: revision, cause: { kind: 'feature', id: 'history-advancement' }, reason: 'Verified explicit history delivery', deltaYears: 75, timestamp: '2026-10-16T00:01:00.000Z', model: 'gpt-6.1-sol', commandId: 'advance-history-delivery' };
}

void test('fresh configured genesis supports current history advances and retains exact replay and normal clock', () => {
  const item = fixture();
  try {
    seedLocalWorld(item.store, createWorld(31, '2026-10-16T00:00:00.000Z', 'settlement-foundations-2'));
    const before = item.store.snapshot();
    const protocol = new GameProtocol(item.store);

    assert.equal(record(protocol.handle(advanceRequest())).ok, true);
    assert.equal(record(protocol.handle(advanceRequest())).duplicate, true);
    assert.equal(item.store.catchUp({ expectedRevision: 1, timestamp: '2026-10-16T00:06:00.000Z', commandId: 'clock-after-advance' }).ok, true);
    const reopened = new GameStore(item.store.path).snapshot();
    assert.equal(reopened.state.revision, 2);
    assert.equal(reopened.state.year, before.state.year + 85);
    assert.equal(reopened.state.clockEpoch, before.state.clockEpoch);
    assert.equal(reopened.state.clockTicks, 1);
    assert.equal(reopened.state.phase, before.state.phase);
    assert.equal(reopened.state.round, before.state.round);
    assert.equal(reopened.state.releaseId, 'settlement-foundations-2');
    assert.deepEqual(reopened.initial, before.initial);
    assert.deepEqual(reopened.timeline.map((entry) => entry.kind), ['history-advance', 'clock-catchup']);
    assert.equal(reopened.provenance[0]?.model, 'gpt-6.1-sol');
    assert.equal(Object.keys(reopened.state.historyAdvances ?? {}).length, 1);
    let reproduced = reopened.initial;
    for (const transition of reopened.timeline) {
      const result = transition.kind === 'history-advance' ? applyHistoryAdvance(reproduced, transition.command)
          : transition.kind === 'clock-catchup' ? catchUpClock(reproduced, transition.timestamp) : null;
      assert.ok(result?.ok);
      reproduced = result.state;
    }
    assert.deepEqual(reproduced, reopened.state);
  } finally { item.cleanup(); }
});

void test('release requests are always disabled without writes while history rejects invalid and stale retries', () => {
  const item = fixture();
  try {
    seedLocalWorld(item.store, createWorld(31, '2026-10-16T00:00:00.000Z', 'settlement-foundations-2'));
    const protocol = new GameProtocol(item.store);
    const initial = item.store.snapshot().state;
    const initialBytes = readFileSync(item.store.path, 'utf8');
    for (const request of [releaseRequest(), { ...releaseRequest(), targetReleaseId: 'unknown' }, { ...releaseRequest(), expectedFromReleaseId: 'unknown' }, { ...releaseRequest(), expectedRevision: 99 }, { ...releaseRequest(), model: '' }, { ...releaseRequest(), commandId: '' }]) {
      assert.equal(record(protocol.handle(request)).ok, false);
      assert.deepEqual(item.store.snapshot().state, initial);
      assert.equal(readFileSync(item.store.path, 'utf8'), initialBytes);
    }
    assert.throws(() => item.store.authoredTransition(releaseRequest(), 'release-apply'), /pre_release_migration_disabled/);
    assert.equal(readFileSync(item.store.path, 'utf8'), initialBytes);

    const released = item.store.snapshot().state;
    for (const patch of [{ deltaYears: -1 }, { deltaYears: Number.MAX_SAFE_INTEGER + 1 }, { reason: '' }, { cause: { kind: 'event', id: 'missing' } }, { timestamp: 'tomorrow' }, { expectedRevision: 99 }]) {
      assert.equal(record(protocol.handle({ ...advanceRequest(), ...patch })).ok, false);
      assert.deepEqual(item.store.snapshot().state, released);
    }
    assert.equal(record(protocol.handle(advanceRequest())).ok, true);
    assert.equal(record(protocol.handle({ ...advanceRequest(), deltaYears: 76 })).ok, false);
    assert.equal(record(protocol.handle({ ...advanceRequest(1), commandId: 'same-cause-again' })).ok, false);
    assert.equal(item.store.snapshot().state.revision, 1);
  } finally { item.cleanup(); }
});

void test('optional history ledgers are checked before loading without rewriting corrupt bytes', () => {
  const item = fixture();
  try {
    seedLocalWorld(item.store, createWorld(31, '2026-10-16T00:00:00.000Z', 'settlement-foundations-2'));
    const original = item.store.snapshot();
    assert.equal(original.state.historyAdvances, undefined);
    for (const ledger of [null, [], { 'feature:x': { cause: { kind: 'feature', id: 'x' }, reason: 'proof', deltaYears: 'bad' } }, { 'feature:x': { cause: { kind: 'feature', id: 'x' }, reason: 'proof', deltaYears: 1, timestamp: '2026-10-16T00:00:00.000Z', revision: 0, yearBefore: -10000, yearAfter: -9999, evidence: ['x'] } }]) {
      const corrupted = structuredClone(original);
      record(corrupted.state).historyAdvances = ledger;
      const bytes = JSON.stringify(corrupted);
      writeFileSync(item.store.path, bytes);
      assert.throws(() => item.store.snapshot(), ProtocolError);
      assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
    }
  } finally { item.cleanup(); }
});

void test('one-shot release command is unavailable without save writes while history remains usable', () => {
  const item = fixture();
  try {
    seedLocalWorld(item.store, createWorld(31, '2026-10-16T00:00:00.000Z', 'settlement-foundations-2'));
    const bytes = readFileSync(item.store.path, 'utf8');
    const refused = spawnSync(process.execPath, [cli, 'release-apply', '--revision', '0', '--from', 'settlement-foundations-1', '--to', 'settlement-foundations-2', '--model', 'gpt-6.1-sol', '--id', 'release-2'], { cwd: item.directory, encoding: 'utf8' });
    assert.notEqual(refused.status, 0); assert.match(refused.stderr + refused.stdout, /unknown command|pre_release_migration_disabled/);
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);

    assert.equal(run(item.directory, ['history-advance', '--revision', '0', '--cause-kind', 'feature', '--cause-id', 'history-advancement', '--reason', 'Verified delivery', '--years', '75', '--at', '2026-10-16T00:01:00.000Z', '--model', 'gpt-6.1-sol', '--id', 'advance']).ok, true);
    assert.equal(run(item.directory, ['observe']).year, -9925);
  } finally { item.cleanup(); }
});

void test('current history and action receipts share caller ids without reenabling historical release requests', () => {
  const item = fixture();
  try {
    seedLocalWorld(item.store, createWorld(31, '2026-10-16T00:00:00.000Z', 'settlement-foundations-2'));
    const protocol = new GameProtocol(item.store);
    const release = { ...releaseRequest(), commandId: 'shared-user-id' };
    const advance = { ...advanceRequest(), commandId: 'shared-user-id' };

    assert.equal(record(protocol.handle(advance)).ok, true);
    assert.equal(item.store.submit(command(1, 0, 'shared-user-id')).ok, true);
    const bytes = readFileSync(item.store.path, 'utf8');
    assert.equal(record(protocol.handle(release)).ok, false);
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
    assert.equal(record(protocol.handle(advance)).duplicate, true);
    assert.equal(item.store.snapshot().state.revision, 2);
    assert.equal(item.store.snapshot().provenance.length, 2);
  } finally { item.cleanup(); }
});

void test('valid history receipt numeric, causal and evidence invariants reject persisted corruption', () => {
  const item = fixture();
  try {
    seedLocalWorld(item.store, createWorld(31, '2026-10-16T00:00:00.000Z', 'settlement-foundations-2'));
    const protocol = new GameProtocol(item.store);

    assert.equal(record(protocol.handle(advanceRequest())).ok, true);
    const original = item.store.snapshot();
    for (const patch of [{ deltaYears: -1 }, { deltaYears: 0.5 }, { revision: 99 }, { revision: 0 }, { yearBefore: 'bad' }, { yearAfter: -9999 }, { reason: ' ' }, { reason: 'x'.repeat(1001) }, { timestamp: 'invalid' }, { evidence: [] }, { evidence: [''] }, { cause: { kind: 'feature', id: 'unreleased' } }, { cause: { kind: 'event', id: 'history-advancement' } }]) {
      const corrupted = structuredClone(original);
      const receipt = corrupted.state.historyAdvances?.['feature:history-advancement'];
      assert.ok(receipt);
      Object.assign(receipt, patch);
      const bytes = JSON.stringify(corrupted);
      writeFileSync(item.store.path, bytes);
      assert.throws(() => item.store.snapshot(), ProtocolError);
      assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
    }
  } finally { item.cleanup(); }
});

void test('JSONL refuses release migration then continues with valid current history requests', () => {
  const item = fixture();
  try {
    seedLocalWorld(item.store, createWorld(31, '2026-10-16T00:00:00.000Z', 'settlement-foundations-2'));
    const lines = [
      { id: 'release', ...releaseRequest() },
      { id: 'bad', ...advanceRequest(), cause: null },
      { id: 'advance', ...advanceRequest() },
      { id: 'read', op: 'observe' },
    ].map((entry) => JSON.stringify(entry)).join('\n');
    const result = spawnSync(process.execPath, [cli], { cwd: item.directory, input: `${lines}\n`, encoding: 'utf8' });
    assert.equal(result.status, 0);
    const replies = result.stdout.trim().split('\n').map(parse);
    assert.equal(record(replies[0]?.result).ok, false);
    assert.match(String(record(replies[0]?.result).error), /pre_release_migration_disabled|unknown op/);
    assert.equal(record(replies[1]?.result).ok, false);
    assert.equal(record(replies[2]?.result).ok, true);
    assert.equal(record(replies[3]?.result).year, -9925);
  } finally { item.cleanup(); }
});

void test('fresh registered rules are selected through store protocol and one-shot initialization without migration or overwrite', () => {
  const direct = fixture(); const protocolItem = fixture(); const oneShot = fixture();
  const epoch = '2026-10-16T00:00:00.000Z'; const rules = 'settlement-independent-1';
  try {
    assert.throws(() => direct.store.initialize(1701, false, epoch, 'unknown-rules'), /registered rules ID/);
    assert.throws(() => direct.store.initialize(1701, false, undefined, rules), /explicit epoch/);
    assert.throws(() => readFileSync(direct.store.path), { code: 'ENOENT' });
    assert.equal(direct.store.initialize(1701, false, epoch, rules).ok, true);
    assert.deepEqual(direct.store.snapshot().initial, createWorld(1701, epoch, rules));
    assert.deepEqual(direct.store.snapshot().state, direct.store.snapshot().initial);
    assert.deepEqual(direct.store.snapshot().timeline, []);
    const directBytes = readFileSync(direct.store.path, 'utf8');
    assert.equal(direct.store.initialize(31, false, epoch, 'settlement-foundations-2').ok, false);
    assert.equal(readFileSync(direct.store.path, 'utf8'), directBytes);

    const protocol = new GameProtocol(protocolItem.store);
    for (const registeredRulesId of ['unknown-rules', '', 42, null]) {
      const refused = record(protocol.handle({ op: 'init', seed: 1701, clockEpoch: epoch, registeredRulesId }));
      assert.equal(refused.ok, false); assert.match(String(refused.error), /registered rules ID/);
    }
    const missingEpoch = record(protocol.handle({ op: 'init', seed: 1701, registeredRulesId: rules }));
    assert.equal(missingEpoch.ok, false); assert.match(String(missingEpoch.error), /explicit epoch/);
    assert.throws(() => readFileSync(protocolItem.store.path), { code: 'ENOENT' });
    assert.equal(record(protocol.handle({ op: 'init', seed: 1701, clockEpoch: epoch, registeredRulesId: rules })).ok, true);
    assert.deepEqual(protocolItem.store.snapshot().state, direct.store.snapshot().initial);
    const protocolBytes = readFileSync(protocolItem.store.path, 'utf8');
    assert.equal(record(protocol.handle({ op: 'init', seed: 31, clockEpoch: epoch, registeredRulesId: 'settlement-foundations-2' })).ok, false);
    assert.equal(readFileSync(protocolItem.store.path, 'utf8'), protocolBytes);

    const unknown = run(oneShot.directory, ['init', '--rules', 'unknown-rules', '--clock-epoch', epoch]);
    assert.equal(unknown.ok, false); assert.match(String(unknown.error), /registered rules ID/);
    const absent = run(oneShot.directory, ['init', '--rules', rules]);
    assert.equal(absent.ok, false); assert.match(String(absent.error), /explicit epoch/);
    assert.throws(() => readFileSync(oneShot.store.path), { code: 'ENOENT' });
    assert.equal(run(oneShot.directory, ['init', '--seed', '1701', '--rules', rules, '--clock-epoch', epoch]).ok, true);
    assert.deepEqual(oneShot.store.snapshot().state, direct.store.snapshot().initial);
    const oneShotBytes = readFileSync(oneShot.store.path, 'utf8');
    assert.equal(run(oneShot.directory, ['init', '--rules', 'settlement-foundations-2', '--clock-epoch', epoch]).ok, false);
    assert.equal(readFileSync(oneShot.store.path, 'utf8'), oneShotBytes);
  } finally { direct.cleanup(); protocolItem.cleanup(); oneShot.cleanup(); }
});
