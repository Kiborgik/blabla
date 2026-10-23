import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GameProtocol } from '../cli/protocol.ts';
import { GameStore, isRecord } from '../cli/store.ts';
import { observe } from '../core/engine.ts';
import { observeCompactTrade } from '../core/observation.ts';

const cli = new URL('../cli/main.ts', import.meta.url).pathname;
const epoch = '2026-10-16T00:00:00.000Z';
const format = 'compact-trade-v1';

function record(value: unknown): Record<string, unknown> { assert.ok(isRecord(value)); return value; }
function array(value: unknown): unknown[] { assert.ok(Array.isArray(value)); return value; }
function parse(text: string): Record<string, unknown> { const value: unknown = JSON.parse(text); return record(value); }
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'compact-cli-'));
  return { directory, store: new GameStore(join(directory, '.blabla/world.json')), cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
function processRead(directory: string, args: string[], input?: string) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: directory, encoding: 'utf8', ...(input === undefined ? {} : { input }) });
}
function compactMatches(value: Record<string, unknown>, store: GameStore): void {
  const pure = observeCompactTrade(store.snapshot().state, 0, epoch);
  assert.equal(value.observationFormat, format);
  assert.equal('choices' in value, false);
  assert.deepEqual(value.tradeFacts, pure.tradeFacts);
  assert.deepEqual(value.legalActions, pure.legalActions.map((option, choice) => ({ choice, ...option })));
  assert.deepEqual(value.actionPlan, pure.actionPlan);
  assert.deepEqual(value.admission, pure.admission);
}

await test('separate-process explicit compact CLI returns every indexed action and canonical fact without changing save bytes', (context) => {
  const item = fixture();
  try {
    assert.equal(item.store.initialize(17, false, epoch, 'settlement-endpoints-1').ok, true);
    const bytes = readFileSync(item.store.path, 'utf8');
    const full = new GameProtocol(item.store).handle({ op: 'observe', seat: 0, timestamp: epoch });
    const result = processRead(item.directory, ['observe', '--state', item.store.path, '--seat', '0', '--at', epoch, '--observation-format', format]);
    assert.equal(result.status, 0, result.stderr);
    compactMatches(parse(result.stdout), item.store);
    context.diagnostic(JSON.stringify({ source: 'finite five-city CLI fixture with default duplicate choices alias', fullBytes: Buffer.byteLength(JSON.stringify(full)), compactBytes: Buffer.byteLength(JSON.stringify(parse(result.stdout))) }));
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
    const repeated = processRead(item.directory, ['observe', '--state', item.store.path, '--seat', '0', '--at', epoch, '--observation-format', format]);
    assert.equal(repeated.stdout, result.stdout);
    const defaultRead = processRead(item.directory, ['observe', '--state', item.store.path, '--seat', '0', '--at', epoch]);
    assert.equal(defaultRead.status, 0, defaultRead.stderr);
    assert.deepEqual(parse(defaultRead.stdout), full);
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
  } finally { item.cleanup(); }
});

await test('JSONL protocol accepts compact opt-in and keeps default responses and later requests intact', () => {
  const item = fixture();
  try {
    assert.equal(item.store.initialize(17, false, epoch, 'settlement-endpoints-1').ok, true);
    const bytes = readFileSync(item.store.path, 'utf8');
    const requests = [
      { id: 1, op: 'observe', seat: 0, timestamp: epoch, observationFormat: format },
      { id: 2, op: 'observe', seat: 0, timestamp: epoch, observationFormat: 'unknown' },
      { id: 3, op: 'observe', seat: 0, timestamp: epoch },
    ];
    const result = processRead(item.directory, ['serve'], requests.map(request => JSON.stringify(request)).join('\n') + '\n');
    assert.equal(result.status, 0, result.stderr);
    const replies = result.stdout.trim().split('\n').map(parse);
    assert.deepEqual(replies.map(reply => reply.id), [1, 2, 3]);
    compactMatches(record(replies[0]?.result), item.store);
    const rejected = record(replies[1]?.result);
    assert.equal(rejected.ok, false);
    assert.match(String(rejected.error), /observationFormat/);
    assert.deepEqual(replies[2]?.result, new GameProtocol(item.store).handle({ op: 'observe', seat: 0, timestamp: epoch }));
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
  } finally { item.cleanup(); }
});

await test('malformed selectors fail before creating a save directory or reading corrupt durable data', () => {
  const item = fixture();
  try {
    const protocol = new GameProtocol(item.store);
    for (const observationFormat of ['', 'unknown', null, false, 1, [], {}]) {
      const result = record(protocol.handle({ op: 'observe', observationFormat }));
      assert.equal(result.ok, false);
      assert.match(String(result.error), /observationFormat/);
      assert.equal(existsSync(join(item.directory, '.blabla')), false);
    }
    item.store.initialize(17, false, epoch);
    writeFileSync(item.store.path, 'intentionally corrupt fixture');
    const result = record(protocol.handle({ op: 'observe', observationFormat: 'unknown' }));
    assert.match(String(result.error), /observationFormat/);
    assert.equal(readFileSync(item.store.path, 'utf8'), 'intentionally corrupt fixture');
    const child = processRead(item.directory, ['observe', '--state', item.store.path, '--observation-format', 'unknown']);
    assert.equal(parse(child.stdout).ok, false);
    assert.match(String(parse(child.stdout).error), /observationFormat/);
    assert.equal(readFileSync(item.store.path, 'utf8'), 'intentionally corrupt fixture');
  } finally { item.cleanup(); }
});

await test('format selector is observation-only and cannot be silently ignored by mutating protocol operations', () => {
  const item = fixture();
  try {
    const protocol = new GameProtocol(item.store);
    for (const observationFormat of [format, 'unknown', null]) {
      const result = record(protocol.handle({ op: 'init', seed: 17, observationFormat }));
      assert.equal(result.ok, false);
      assert.match(String(result.error), /observationFormat/);
      assert.equal(existsSync(join(item.directory, '.blabla')), false);
    }
    item.store.initialize(17, false, epoch);
    const bytes = readFileSync(item.store.path, 'utf8');
    const refused = record(protocol.handle({ op: 'action', seat: 0, expectedRevision: 0, action: { type: 'wait' }, model: 'test-fixture', commandId: 'not-executed', observationFormat: format }));
    assert.equal(refused.ok, false);
    assert.match(String(refused.error), /observationFormat/);
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
  } finally { item.cleanup(); }
});

await test('compact protocol output is detached and legacy default keeps its exact historical aliases', () => {
  const item = fixture();
  try {
    item.store.initialize(17, false, epoch);
    const state = item.store.snapshot().state;
    const pure = observe(state, 0, epoch);
    const protocol = new GameProtocol(item.store);
    const full = record(protocol.handle({ op: 'observe', seat: 0, timestamp: epoch }));
    assert.equal('observationFormat' in full, false);
    assert.equal('tradeFacts' in full, false);
    assert.deepEqual(full.legalActions, pure.legalActions);
    assert.deepEqual(full.choices, pure.legalActions.map((option, choice) => ({ choice, ...option })));
    const bytes = readFileSync(item.store.path, 'utf8');
    const compact = record(protocol.handle({ op: 'observe', seat: 0, timestamp: epoch, observationFormat: format }));
    compactMatches(compact, item.store);
    record(compact.tradeFacts).cities = [{ cityId: 'forged' }];
    array(compact.legalActions).splice(0);
    const fresh = record(protocol.handle({ op: 'observe', seat: 0, timestamp: epoch, observationFormat: format }));
    compactMatches(fresh, item.store);
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
  } finally { item.cleanup(); }
});

await test('an indexed compact choice submits the same legal action only after an explicit separate CLI command', () => {
  const item = fixture();
  try {
    item.store.initialize(17, false, epoch);
    const bytes = readFileSync(item.store.path, 'utf8');
    const read = processRead(item.directory, ['observe', '--seat', '0', '--at', epoch, '--observation-format', format]);
    assert.equal(read.status, 0, read.stderr);
    const observed = parse(read.stdout);
    const selected = array(observed.legalActions).map(record).find(option => record(option.action).type === 'wait');
    assert.ok(selected);
    assert.equal(readFileSync(item.store.path, 'utf8'), bytes);
    const acted = processRead(item.directory, ['action', '--seat', '0', '--revision', String(observed.revision), '--choice', String(selected.choice), '--model', 'test-fixture', '--id', 'explicit-compact-choice']);
    assert.equal(acted.status, 0, acted.stderr);
    assert.equal(parse(acted.stdout).ok, true);
    assert.deepEqual(item.store.snapshot().commands[0]?.action, selected.action);
    assert.equal(item.store.snapshot().state.revision, 1);
  } finally { item.cleanup(); }
});


await test('malformed compact CLI flags and non-observe use fail before creating any durable directory', () => {
  const item = fixture();
  try {
    for (const args of [
      ['observe', '--observation-format'],
      ['observe', '--observation-format', format, '--observation-format', format],
      ['init', '--observation-format', format],
    ]) {
      const result = processRead(item.directory, args);
      assert.equal(result.status, 1);
      assert.equal(parse(result.stdout).ok, false);
      assert.equal(existsSync(join(item.directory, '.blabla')), false);
    }
    const unknown = processRead(item.directory, ['observe', '--observation-format', 'unknown']);
    assert.equal(parse(unknown.stdout).ok, false);
    assert.match(String(parse(unknown.stdout).error), /observationFormat/);
    assert.equal(existsSync(join(item.directory, '.blabla')), false);
  } finally { item.cleanup(); }
});
