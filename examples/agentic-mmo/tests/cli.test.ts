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
import { applyCommand, applyDirectorTick, applyHistoryAdvance, applyRelease, catchUpClock, catchUpStrategy } from '../core/engine.ts';
import { isWorldState } from '../core/validation.ts';
import { TRADE_RECIPES } from '../core/content.ts';
import type { WorldState } from '../core/types.ts';

const cli = new URL('../cli/main.ts', import.meta.url).pathname;
const adapterScript = new URL('../cli/adapter.ts', import.meta.url).pathname;

function worldWithAgreement(): WorldState {
  const item = fixture();
  try {
    item.store.initialize(1701);
    const state = item.store.snapshot().state;
    const terms = TRADE_RECIPES[0]?.terms;
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

void test('independent CLI release accepts explicit concurrent intents and separate strategy pulses across restart', () => {
  const item = fixture();
  try {
    item.store.initialize(1701, false, '2026-10-16T00:00:00.000Z');
    for (const [expectedRevision, expectedFromReleaseId, targetReleaseId] of [[0, 'settlement-foundations-1', 'settlement-foundations-2'], [1, 'settlement-foundations-2', 'settlement-independent-1']] as const) {
      assert.equal(item.store.authoredTransition({ expectedRevision, expectedFromReleaseId, targetReleaseId, timestamp: '2026-10-16T01:00:00.000Z', model: 'gpt-6-astra', commandId: `release-${expectedRevision}` }, 'release-apply').ok, true);
    }
    assert.equal(item.store.observation(4).activeSeat, null);
    const input = { expectedRevision: 2, action: { type: 'focus', focus: 'industry' }, timestamp: '2026-10-16T01:00:00.000Z', model: 'gpt-6-astra' };
    assert.equal(item.store.submit({ ...input, seat: 4, commandId: 'vesper-independent' }).ok, true);
    assert.equal(item.store.submit({ ...input, seat: 1, commandId: 'verdant-independent' }).ok, true);
    assert.equal(item.store.snapshot().state.round, 0);
    const bytes = readFileSync(item.store.path, 'utf8');
    assert.equal(item.store.submit({ ...input, seat: 4, commandId: 'vesper-too-fast' }).ok, false);
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
    assert.equal(item.store.submit({ ...command(2, 0, 'stale-choice'), timestamp: input.timestamp }).ok, false);
    const protocol = new GameProtocol(new GameStore(item.store.path));
    const pulse = { op: 'strategy-catchup', expectedRevision: 4, timestamp: '2026-10-16T01:02:00.000Z', commandId: 'strategy-two' };
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
    run(item.directory, ['init', '--seed', '1701']);
    for (const [revision, from, to] of [['0', 'settlement-foundations-1', 'settlement-foundations-2'], ['1', 'settlement-foundations-2', 'settlement-independent-1']] as const) {
      assert.equal(run(item.directory, ['release-apply', '--revision', revision, '--from', from, '--to', to, '--at', '2026-10-16T01:00:00.000Z', '--model', 'gpt-6-astra', '--id', `cli-${revision}`]).ok, true);
    }
    assert.equal(run(item.directory, ['action', '--seat', '3', '--revision', '2', '--action', '{"type":"wait"}', '--at', '2026-10-16T01:00:10.000Z', '--model', 'gpt-6-astra', '--id', 'cli-independent']).ok, true);
    assert.equal(run(item.directory, ['strategy-catchup', '--revision', '3', '--at', '2026-10-16T01:01:00.000Z', '--id', 'cli-strategy']).ok, true);
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
              : entry.kind === 'history-advance' ? applyHistoryAdvance(reproduced, entry.command) : applyRelease(reproduced, entry.command);
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

void test('pre-clock histories reject system operations until an explicit host migration', () => {
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

function advanceRequest(revision = 1): Record<string, unknown> {
  return { op: 'history-advance', expectedRevision: revision, cause: { kind: 'feature', id: 'history-advancement' }, reason: 'Verified explicit history delivery', deltaYears: 75, timestamp: '2026-10-16T00:01:00.000Z', model: 'gpt-6.1-sol', commandId: 'advance-history-delivery' };
}

void test('explicit compatible release and history advances persist exact targets and retain the normal clock', () => {
  const item = fixture();
  try {
    item.store.initialize(31, false, '2026-10-16T00:00:00.000Z');
    const before = item.store.snapshot();
    const protocol = new GameProtocol(item.store);
    assert.equal(record(protocol.handle(releaseRequest())).ok, true);
    assert.equal(record(protocol.handle(advanceRequest())).ok, true);
    assert.equal(record(protocol.handle(advanceRequest())).duplicate, true);
    assert.equal(item.store.catchUp({ expectedRevision: 2, timestamp: '2026-10-16T00:06:00.000Z', commandId: 'clock-after-advance' }).ok, true);
    const reopened = new GameStore(item.store.path).snapshot();
    assert.equal(reopened.state.revision, 3);
    assert.equal(reopened.state.year, before.state.year + 85);
    assert.equal(reopened.state.clockEpoch, before.state.clockEpoch);
    assert.equal(reopened.state.clockTicks, 1);
    assert.equal(reopened.state.phase, before.state.phase);
    assert.equal(reopened.state.round, before.state.round);
    assert.equal(reopened.state.releaseId, 'settlement-foundations-2');
    assert.deepEqual(reopened.initial, before.initial);
    assert.deepEqual(reopened.timeline.map((entry) => entry.kind), ['release-apply', 'history-advance', 'clock-catchup']);
    assert.equal(record(record(reopened.timeline[0]).command).targetReleaseId, 'settlement-foundations-2');
    assert.equal(reopened.provenance[1]?.model, 'gpt-6.1-sol');
    assert.equal(Object.keys(reopened.state.historyAdvances ?? {}).length, 1);
    let reproduced = reopened.initial;
    for (const transition of reopened.timeline) {
      const result = transition.kind === 'release-apply' ? applyRelease(reproduced, transition.command)
        : transition.kind === 'history-advance' ? applyHistoryAdvance(reproduced, transition.command)
          : transition.kind === 'clock-catchup' ? catchUpClock(reproduced, transition.timestamp) : null;
      assert.ok(result?.ok);
      reproduced = result.state;
    }
    assert.deepEqual(reproduced, reopened.state);
  } finally { item.cleanup(); }
});

void test('release and history requests reject invalid, stale or changed retries without changing the world', () => {
  const item = fixture();
  try {
    item.store.initialize(31);
    const protocol = new GameProtocol(item.store);
    const initial = item.store.snapshot().state;
    for (const request of [advanceRequest(0), { ...releaseRequest(), targetReleaseId: 'unknown' }, { ...releaseRequest(), expectedFromReleaseId: 'unknown' }, { ...releaseRequest(), expectedRevision: 99 }, { ...releaseRequest(), model: '' }, { ...releaseRequest(), commandId: '' }]) {
      assert.equal(record(protocol.handle(request)).ok, false);
      assert.deepEqual(item.store.snapshot().state, initial);
    }
    assert.equal(record(protocol.handle(releaseRequest())).ok, true);
    const released = item.store.snapshot().state;
    for (const patch of [{ deltaYears: -1 }, { deltaYears: Number.MAX_SAFE_INTEGER + 1 }, { reason: '' }, { cause: { kind: 'event', id: 'missing' } }, { timestamp: 'tomorrow' }, { expectedRevision: 0 }]) {
      assert.equal(record(protocol.handle({ ...advanceRequest(), ...patch })).ok, false);
      assert.deepEqual(item.store.snapshot().state, released);
    }
    assert.equal(record(protocol.handle(advanceRequest())).ok, true);
    assert.equal(record(protocol.handle({ ...advanceRequest(), deltaYears: 76 })).ok, false);
    assert.equal(record(protocol.handle({ ...advanceRequest(2), commandId: 'same-cause-again' })).ok, false);
    assert.equal(item.store.snapshot().state.revision, 2);
  } finally { item.cleanup(); }
});

void test('optional history ledgers are checked before loading without rewriting corrupt bytes', () => {
  const item = fixture();
  try {
    item.store.initialize(31);
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

void test('one-shot release and history commands survive separate processes', () => {
  const item = fixture();
  try {
    run(item.directory, ['init', '--seed', '31']);
    assert.equal(run(item.directory, ['release-apply', '--revision', '0', '--from', 'settlement-foundations-1', '--to', 'settlement-foundations-2', '--model', 'gpt-6.1-sol', '--id', 'release-2']).ok, true);
    assert.equal(run(item.directory, ['history-advance', '--revision', '1', '--cause-kind', 'feature', '--cause-id', 'history-advancement', '--reason', 'Verified delivery', '--years', '75', '--at', '2026-10-16T00:01:00.000Z', '--model', 'gpt-6.1-sol', '--id', 'advance']).ok, true);
    assert.equal(run(item.directory, ['observe']).year, -9925);
  } finally { item.cleanup(); }
});

void test('authored receipt namespaces permit the same caller id across distinct operations', () => {
  const item = fixture();
  try {
    item.store.initialize(31);
    const protocol = new GameProtocol(item.store);
    const release = { ...releaseRequest(), commandId: 'shared-user-id' };
    const advance = { ...advanceRequest(), commandId: 'shared-user-id' };
    assert.equal(record(protocol.handle(release)).ok, true);
    assert.equal(record(protocol.handle(advance)).ok, true);
    assert.equal(item.store.submit(command(2, 0, 'shared-user-id')).ok, true);
    assert.equal(record(protocol.handle(release)).duplicate, true);
    assert.equal(record(protocol.handle(advance)).duplicate, true);
    assert.equal(item.store.snapshot().state.revision, 3);
    assert.equal(item.store.snapshot().provenance.length, 3);
  } finally { item.cleanup(); }
});

void test('valid history receipt numeric, causal and evidence invariants reject persisted corruption', () => {
  const item = fixture();
  try {
    item.store.initialize(31);
    const protocol = new GameProtocol(item.store);
    assert.equal(record(protocol.handle(releaseRequest())).ok, true);
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

void test('JSONL accepts release and history requests then continues after malformed authored input', () => {
  const item = fixture();
  try {
    const lines = [
      { id: 'init', op: 'init', seed: 31 },
      { id: 'release', ...releaseRequest() },
      { id: 'bad', ...advanceRequest(), cause: null },
      { id: 'advance', ...advanceRequest() },
      { id: 'read', op: 'observe' },
    ].map((entry) => JSON.stringify(entry)).join('\n');
    const result = spawnSync(process.execPath, [cli], { cwd: item.directory, input: `${lines}\n`, encoding: 'utf8' });
    assert.equal(result.status, 0);
    const replies = result.stdout.trim().split('\n').map(parse);
    assert.equal(record(replies[1]?.result).ok, true);
    assert.equal(record(replies[2]?.result).ok, false);
    assert.equal(record(replies[3]?.result).ok, true);
    assert.equal(record(replies[4]?.result).year, -9925);
  } finally { item.cleanup(); }
});
