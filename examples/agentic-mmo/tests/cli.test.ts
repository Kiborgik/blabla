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
import { applyCommand, applyDirectorTick, catchUpClock } from '../core/engine.ts';
import { isWorldState } from '../core/validation.ts';

const cli = new URL('../cli/main.ts', import.meta.url).pathname;
const adapterScript = new URL('../cli/adapter.ts', import.meta.url).pathname;

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
            : catchUpClock(reproduced, entry.timestamp);
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
