import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { ACTIVE_LOCAL_RELEASE_ID, createLocalSimulation, LOCAL_SIMULATION_STORAGE_KEY } from '../web/local-simulation.ts';
import { createLocalWorldStorage, type LocalCheckpointResult, type LocalWorldStoragePorts } from '../web/local-world-storage.ts';

function fixture(initial: Array<[string, string]> = [], overrides: Partial<LocalWorldStoragePorts> = {}, withoutLock = false) {
  const records = new Map(initial);
  const writes: Array<[string, string]> = [];
  let entropyCalls = 0;
  let locked = false;
  const ports: LocalWorldStoragePorts = {
    read: key => records.get(key) ?? null,
    write: (key, value) => { assert.equal(locked, true); writes.push([key, value]); records.set(key, value); },
    withLock: async (_key, operation) => { locked = true; try { return operation(); } finally { locked = false; } },
    entropy: () => { assert.equal(locked, true); entropyCalls += 1; return 99123; },
    ...overrides,
  };
  if (withoutLock) delete ports.withLock;
  return { storage: createLocalWorldStorage(ports), records, writes, entropyCalls: () => entropyCalls };
}

void test('fresh current world persists its sampled zero-step current-release genesis before observation can begin', async () => {
  const f = fixture();
  assert.match(LOCAL_SIMULATION_STORAGE_KEY, /^civitas:procedural-observatory:/);
  const initialized = await f.storage.restore();
  assert.ok(initialized.run);
  assert.equal(initialized.ephemeral, false);
  assert.equal(initialized.run.seed, 99123);
  assert.equal(initialized.run.steps, 0);
  assert.equal(initialized.run.state.round, 0);
  assert.equal(initialized.run.state.revision, 0);
  assert.equal(initialized.run.state.releaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.equal(initialized.run.state.origin?.initialReleaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.equal(initialized.run.state.origin?.namingVersion, 'cultural-toponyms-v1');
  assert.equal(initialized.run.state.origin?.temperamentVersion, 'strategic-temperaments-v1');
  assert.ok(initialized.run.state.unlockedFeatures.includes('knowledge-compacts'));
  assert.ok(initialized.run.state.unlockedFeatures.includes('food-budget'));
  assert.ok(initialized.run.state.unlockedFeatures.includes('consented-relief'));
  assert.deepEqual(JSON.parse(f.records.get(LOCAL_SIMULATION_STORAGE_KEY)!), initialized.run);
  assert.equal(f.writes.length, 1);
  assert.equal(f.entropyCalls(), 1);
  const again = await f.storage.restore();
  assert.deepEqual(again.run, initialized.run);
  assert.equal(f.entropyCalls(), 1);
  assert.equal(f.writes.length, 1);
});

void test('concurrent first initializers reread within their lock and adopt one winner without drawing another seed', async () => {
  const records = new Map<string, string>();
  const pending: Array<() => void> = [];
  const draws: number[] = [];
  const writes: string[] = [];
  let locked = false;
  const ports = (seed: number): LocalWorldStoragePorts => ({
    read: key => records.get(key) ?? null,
    write: (key, value) => { assert.equal(locked, true); writes.push(value); records.set(key, value); },
    entropy: () => { assert.equal(locked, true); draws.push(seed); return seed; },
    withLock: (key, operation) => new Promise<LocalCheckpointResult>(resolve => {
      assert.equal(key, LOCAL_SIMULATION_STORAGE_KEY);
      pending.push(() => { locked = true; try { resolve(operation()); } finally { locked = false; } });
    }),
  });
  const first = createLocalWorldStorage(ports(11)).restore();
  const second = createLocalWorldStorage(ports(22)).restore();
  assert.equal(pending.length, 2);
  assert.deepEqual(draws, []);
  pending.shift()!(); pending.shift()!();
  const [a, b] = await Promise.all([first, second]);
  assert.ok(a.run); assert.ok(b.run);
  assert.deepEqual(a.run, b.run);
  assert.equal(a.run.seed, 11);
  assert.deepEqual(draws, [11]);
  assert.equal(writes.length, 1);
});

void test('a saved winner appearing during lock wait is restored without entropy or overwrite', async () => {
  const winner = createLocalSimulation(555);
  const pending: { grant?: () => void } = {};
  const f = fixture([], { withLock: (_key, operation) => new Promise(resolve => { pending.grant = () => resolve(operation()); }) });
  const wait = f.storage.restore();
  f.records.set(LOCAL_SIMULATION_STORAGE_KEY, JSON.stringify(winner));
  assert.ok(pending.grant); pending.grant();
  assert.deepEqual((await wait).run, winner);
  assert.equal(f.entropyCalls(), 0); assert.equal(f.writes.length, 0);
});

void test('corrupt or mismatched current record, including one arriving under lock, is never overwritten', async () => {
  const mismatched = createLocalSimulation();
  delete mismatched.state.origin!.temperamentVersion;
  for (const raw of ['{broken world', JSON.stringify(mismatched)]) {
    for (const arrivesDuringLock of [false, true]) {
      const f = fixture(arrivesDuringLock ? [] : [[LOCAL_SIMULATION_STORAGE_KEY, raw]], arrivesDuringLock ? { withLock: async (_key, operation) => { f.records.set(LOCAL_SIMULATION_STORAGE_KEY, raw); return operation(); } } : {});
      const restored = await f.storage.restore();
      assert.equal(restored.run, null); assert.equal(restored.blocked, true); assert.match(restored.message, /preserved/);
      await f.storage.save(() => createLocalSimulation());
      assert.equal(f.entropyCalls(), 0); assert.equal(f.writes.length, 0);
      assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY), raw);
    }
  }
});

void test('a changed current checkpoint is refused before persistence without replacing saved bytes', async () => {
  const current = createLocalSimulation(1701);
  const raw = JSON.stringify(current);
  const f = fixture([[LOCAL_SIMULATION_STORAGE_KEY, raw]]);
  assert.deepEqual((await f.storage.restore()).run, current);
  const mismatched = structuredClone(current);
  delete mismatched.state.origin!.namingVersion;
  const before = JSON.stringify(mismatched);
  const result = await f.storage.save(() => mismatched);
  assert.equal(result.blocked, true);
  assert.equal(result.ephemeral, true);
  assert.match(result.message, /Incompatible|corrupt/);
  assert.equal(f.writes.length, 0);
  assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY), raw);
  assert.equal(JSON.stringify(mismatched), before);
});

void test('no Locks or failed storage and locks stays ephemeral with no shared writes or unlocked entropy', async () => {
  const unavailable: Array<{ overrides: Partial<LocalWorldStoragePorts>; withoutLock: boolean }> = [
    { overrides: {}, withoutLock: true },
    { overrides: { read: () => { throw new Error('denied'); } }, withoutLock: false },
    { overrides: { withLock: async () => { throw new Error('denied'); } }, withoutLock: false },
  ];
  for (const { overrides, withoutLock } of unavailable) {
    const f = fixture([], overrides, withoutLock);
    const restored = await f.storage.restore();
    assert.ok(restored.run); assert.equal(restored.ephemeral, true); assert.match(restored.message, /This tab only · Not saved/);
    await f.storage.save(() => restored.run);
    assert.equal(f.writes.length, 0); assert.equal(f.entropyCalls(), 0);
  }
});

void test('failed genesis persistence retains one in-memory world and does not retry shared writes', async () => {
  let attempts = 0;
  const f = fixture([], { write: () => { attempts += 1; throw new Error('quota'); } });
  const restored = await f.storage.restore();
  assert.ok(restored.run); assert.equal(restored.run.seed, 99123);
  assert.equal(restored.ephemeral, true); assert.match(restored.message, /Not saved/);
  assert.equal((await f.storage.save(() => restored.run)).run, restored.run);
  assert.equal(attempts, 1); assert.equal(f.records.size, 0);
});

void test('entropy accepts both uint32 boundaries but refuses invalid samples without writing a checkpoint', async () => {
  for (const seed of [0, 0xffffffff]) {
    const f = fixture([], { entropy: () => seed });
    assert.equal((await f.storage.restore()).run?.seed, seed);
    assert.equal(f.writes.length, 1);
  }
  for (const seed of [-1, 0x100000000, 1.5, NaN, Infinity]) {
    const f = fixture([], { entropy: () => seed });
    const restored = await f.storage.restore();
    assert.equal(restored.ephemeral, true); assert.match(restored.message, /Not saved/);
    assert.equal(f.writes.length, 0);
  }
});

void test('actual browser initializer awaits the current genesis checkpoint and does not advance terminal observation', () => {
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  assert.match(main, /const restoredLocal = await localWorldStorage\.restore\(\)/);
  assert.match(main, /<option value="local">Autonomous world<\/option>/);
  assert.match(main, /mode !== 'local'[^\n]*localSimulation\.state\.outcome/);
});
