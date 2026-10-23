import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { createWorld } from '../core/engine.ts';
import { LEGACY_BEHAVIOR_POLICY_VERSION } from '../core/behavior-profiles.ts';
import { SHORE_LOCAL_RELEASE_ID, transitionLocalRelease } from '../web/local-release-transition.ts';
import { ACTIVE_LOCAL_RELEASE_ID, LOCAL_SIMULATION_STORAGE_KEY, LIVING_SIMULATION_STORAGE_KEY, PARTNERSHIPS_SIMULATION_STORAGE_KEY, PRIOR_GENERATED_SIMULATION_STORAGE_KEY, PREVIOUS_LOCAL_SIMULATION_STORAGE_KEY, advanceLocalSimulation, createFreshLocalSimulation, createLocalSimulation, localSimulationSnapshot, parseActiveLocalSimulation, type LocalSimulation } from '../web/local-simulation.ts';
import { createLocalWorldStorage, type LocalCheckpointResult, type LocalWorldStoragePorts } from '../web/local-world-storage.ts';
import { processLocalSimulationRequest } from '../web/local-simulation-worker.ts';

function shore(run: LocalSimulation): LocalSimulation {
  const changed = transitionLocalRelease(run, 'active-local');
  assert.equal(changed.status, 'changed');
  return changed.run;
}

function fixture(run: LocalSimulation, overrides: Partial<LocalWorldStoragePorts> = {}, noLock = false) {
  const bytes = ` \n${JSON.stringify(run)}\n`;
  const records = new Map([[LOCAL_SIMULATION_STORAGE_KEY, bytes]]);
  const writes: Array<[string, string]> = [];
  const order: string[] = [];
  let locked = false;
  const ports: LocalWorldStoragePorts = {
    read: key => { order.push(locked ? 'locked-read' : 'read'); return records.get(key) ?? null; },
    write: (key, value) => { assert.equal(locked, true); order.push('write'); writes.push([key, value]); records.set(key, value); },
    withLock: async (key, operation) => {
      assert.equal(key, LOCAL_SIMULATION_STORAGE_KEY);
      order.push('lock'); locked = true;
      try { return operation(); } finally { locked = false; order.push('unlock'); }
    },
    ...overrides,
  };
  if (noLock) delete ports.withLock;
  return { storage: createLocalWorldStorage(ports), records, writes, order, bytes, ports };
}

function terminal(run: LocalSimulation): LocalSimulation {
  const ended = structuredClone(run);
  ended.state.outcome = { kind: 'cultural', winners: [0], round: run.state.round, reason: 'Synthetic terminal storage fixture' };
  assert.ok(parseActiveLocalSimulation(ended));
  return ended;
}

for (const temperaments of [false, true]) {
  void test(`${temperaments ? 'v4' : 'v3'} active preparation commits the pure canonical release once before returning it`, async () => {
    const run = advanceLocalSimulation(temperaments ? createFreshLocalSimulation(1701) : createLocalSimulation(1701), 1);
    const expected = shore(run);
    const f = fixture(run);
    const restored = await f.storage.restore();
    assert.deepEqual(restored.run, run);
    assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY), f.bytes);
    assert.equal(f.writes.length, 0);
    const prepared = await f.storage.prepareCurrentRelease(() => restored.run);
    assert.equal(prepared.blocked, false);
    assert.equal(prepared.ephemeral, false);
    assert.deepEqual(prepared.run, expected);
    assert.deepEqual(JSON.parse(f.records.get(LOCAL_SIMULATION_STORAGE_KEY)!), expected);
    assert.deepEqual(f.writes.map(([key]) => key), [LOCAL_SIMULATION_STORAGE_KEY]);
    assert.deepEqual(f.order, ['read', 'lock', 'locked-read', 'write', 'unlock']);
    assert.equal(localSimulationSnapshot(prepared.run!).identity, localSimulationSnapshot(run).identity);
    assert.equal(prepared.run!.policyVersion, run.policyVersion);
    assert.deepEqual(prepared.run!.memories, run.memories);
    assert.deepEqual(prepared.run!.decisions, run.decisions);
    assert.equal(prepared.run!.timestamp, run.timestamp);
    assert.equal(prepared.run!.steps, run.steps);
    assert.equal(prepared.run!.state.eventCounts['release-applied'], 1);
    const again = await f.storage.prepareCurrentRelease(() => prepared.run);
    assert.deepEqual(again.run, expected);
    assert.equal(f.writes.length, 1);
    const restarted = createLocalWorldStorage(f.ports);
    const recovered = await restarted.restore();
    assert.deepEqual(recovered.run, expected);
    assert.deepEqual((await restarted.prepareCurrentRelease(() => recovered.run)).run, expected);
    assert.equal(f.writes.length, 1);
    const response = processLocalSimulationRequest({ id: 1, run: recovered.run, steps: 1 });
    if (!response.ok) throw new Error(response.error);
    assert.equal(response.ok, true);
    assert.equal(response.run.state.releaseId, SHORE_LOCAL_RELEASE_ID);
    assert.equal(response.run.policyVersion, run.policyVersion);
  });
}

void test('active parser permits only complete exact Food-family releases and leaves the default genesis unchanged', () => {
  const food = createFreshLocalSimulation(1701);
  const current = shore(food);
  assert.equal(food.state.releaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.deepEqual(parseActiveLocalSimulation(current), current);
  for (const change of [
    (run: LocalSimulation) => { run.state.unlockedFeatures = run.state.unlockedFeatures.filter(feature => feature !== 'shore-fisheries'); },
    (run: LocalSimulation) => { run.state.releaseId = ACTIVE_LOCAL_RELEASE_ID; },
    (run: LocalSimulation) => { run.state.releaseId = 'unknown-future-release'; },
    (run: LocalSimulation) => { run.policyVersion = 'wrong-policy'; },
    (run: LocalSimulation) => { run.state.origin!.initialReleaseId = 'settlement-regional-targets-1'; },
  ]) {
    const bad = structuredClone(current); change(bad);
    assert.equal(parseActiveLocalSimulation(bad), null);
  }
});

void test('restore and historical inspection never apply a release or rewrite existing records', async () => {
  const run = createFreshLocalSimulation(1701);
  const f = fixture(run);
  const previous = { ...createLocalSimulation(1701), version: 1, policyVersion: LEGACY_BEHAVIOR_POLICY_VERSION,
    state: createWorld(1701, run.timestamp), memories: Array(6).fill(null) };
  const records = [
    [LIVING_SIMULATION_STORAGE_KEY, createLocalSimulation(1701, 'settlement-regional-targets-1')],
    [PARTNERSHIPS_SIMULATION_STORAGE_KEY, createLocalSimulation(1701, 'settlement-living-partnerships-1')],
    [PRIOR_GENERATED_SIMULATION_STORAGE_KEY, createLocalSimulation(1701, 'settlement-interplanetary-1')],
    [PREVIOUS_LOCAL_SIMULATION_STORAGE_KEY, previous],
  ] as const;
  for (const [key, value] of records) f.records.set(key, ` \n${JSON.stringify(value)}\n`);
  const before = [...f.records];
  assert.deepEqual((await f.storage.restore()).run, run);
  for (const inspected of [f.storage.living(), f.storage.partnerships(), f.storage.priorGenerated(), f.storage.previous()]) assert.ok(inspected.run);
  assert.deepEqual([...f.records], before);
  assert.equal(f.writes.length, 0);
  assert.equal(f.order.includes('lock'), false);
  const rejected = await f.storage.prepareCurrentRelease(() => f.storage.living().run);
  assert.equal(rejected.run, null);
  assert.equal(rejected.blocked, true);
  assert.deepEqual([...f.records], before);
});

void test('terminal Food and shore checkpoints keep exact bytes during preparation and save', async () => {
  for (const run of [terminal(createFreshLocalSimulation(1701)), terminal(shore(createLocalSimulation(1701)))]) {
    const f = fixture(run);
    const restored = await f.storage.restore();
    assert.deepEqual((await f.storage.prepareCurrentRelease(() => restored.run)).run, run);
    assert.deepEqual((await f.storage.save(() => restored.run)).run, run);
    assert.equal(f.writes.length, 0);
    assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY), f.bytes);
  }
});

void test('missing Locks retains original ephemeral rules without any release or write', async () => {
  const run = createFreshLocalSimulation(1701);
  const f = fixture(run, {}, true);
  const restored = await f.storage.restore();
  const prepared = await f.storage.prepareCurrentRelease(() => restored.run);
  assert.equal(prepared.run, restored.run);
  assert.equal(prepared.run!.state.releaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.equal(prepared.ephemeral, true);
  assert.equal(prepared.blocked, false);
  assert.equal(f.writes.length, 0);
  assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY), f.bytes);
  assert.equal(f.order.includes('lock'), false);
});

void test('validated already-shore progress is an exact noop without a lock or checkpoint write', async () => {
  const released = shore(createFreshLocalSimulation(1701));
  const current = advanceLocalSimulation(released, 1);
  const f = fixture(released);
  const prepared = await f.storage.prepareCurrentRelease(() => current);
  assert.equal(prepared.run, current);
  assert.equal(prepared.blocked, false);
  assert.deepEqual(f.order, []);
  assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY), f.bytes);
  const corrupt = structuredClone(current); corrupt.policyVersion = 'wrong-policy';
  const refused = await f.storage.prepareCurrentRelease(() => corrupt);
  assert.equal(refused.run, null);
  assert.equal(refused.blocked, true);
  assert.equal(f.writes.length, 0);
});

void test('failed preparation reads, writes and locks refuse advancement while preserving stored bytes', async () => {
  for (const failure of ['read', 'write', 'lock'] as const) {
    const run = createFreshLocalSimulation(1701);
    const f = fixture(run);
    const restored = await f.storage.restore();
    if (failure === 'read') f.ports.read = () => { throw new Error('unavailable'); };
    if (failure === 'write') f.ports.write = () => { throw new Error('quota'); };
    if (failure === 'lock') f.ports.withLock = async () => { throw new Error('denied'); };
    const rejected = await f.storage.prepareCurrentRelease(() => restored.run);
    assert.equal(rejected.run, null, failure);
    assert.equal(rejected.blocked, true, failure);
    assert.match(rejected.message, /preserved|could not/i);
    assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY), f.bytes, failure);
    assert.equal(restored.run!.state.releaseId, ACTIVE_LOCAL_RELEASE_ID, failure);
    assert.equal((await f.storage.prepareCurrentRelease(() => restored.run)).run, null, failure);
  }
});

void test('missing, corrupt and different-identity checkpoints arriving after restore are never replaced', async () => {
  for (const other of [null, '{corrupt', JSON.stringify(createFreshLocalSimulation(1702))]) {
    const run = createFreshLocalSimulation(1701);
    const f = fixture(run);
    const restored = await f.storage.restore();
    if (other === null) f.records.delete(LOCAL_SIMULATION_STORAGE_KEY);
    else f.records.set(LOCAL_SIMULATION_STORAGE_KEY, other);
    const rejected = await f.storage.prepareCurrentRelease(() => restored.run);
    assert.equal(rejected.run, null);
    assert.equal(rejected.blocked, true);
    assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY) ?? null, other);
    assert.equal(f.writes.length, 0);
  }
});

void test('same-version differences, unsaved progress and crossed counters refuse without overwriting', async () => {
  const base = createFreshLocalSimulation(1701);
  const changed = structuredClone(base); changed.state.cities[0]!.name = 'Unsaved alternate name';
  const ahead = advanceLocalSimulation(base, 1);
  const crossed = structuredClone(base); crossed.steps = 1; crossed.timestamp = '2000-01-01T00:00:10.000Z';
  for (const [stored, current] of [[base, changed], [base, ahead], [shore(base), ahead], [shore(base), crossed]] as const) {
    assert.ok(parseActiveLocalSimulation(current));
    const f = fixture(stored);
    await f.storage.restore();
    const rejected = await f.storage.prepareCurrentRelease(() => current);
    assert.equal(rejected.run, null);
    assert.equal(rejected.blocked, true);
    assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY), f.bytes);
    assert.equal(f.writes.length, 0);
  }
});

void test('newer authoritative Food or shore checkpoints are adopted with coherent monotone counters', async () => {
  const stale = createFreshLocalSimulation(1701);
  for (const latest of [advanceLocalSimulation(stale, 1), shore(stale), advanceLocalSimulation(shore(stale), 1)]) {
    const f = fixture(stale);
    const restored = await f.storage.restore();
    const bytes = ` \n${JSON.stringify(latest)}\n`;
    f.records.set(LOCAL_SIMULATION_STORAGE_KEY, bytes);
    const prepared = await f.storage.prepareCurrentRelease(() => restored.run);
    const expected = latest.state.releaseId === ACTIVE_LOCAL_RELEASE_ID ? shore(latest) : latest;
    assert.deepEqual(prepared.run, expected);
    assert.equal(prepared.blocked, false);
    assert.deepEqual(JSON.parse(f.records.get(LOCAL_SIMULATION_STORAGE_KEY)!), expected);
    assert.equal(f.writes.length, latest.state.releaseId === ACTIVE_LOCAL_RELEASE_ID ? 1 : 0);
    if (latest.state.releaseId === SHORE_LOCAL_RELEASE_ID) assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY), bytes);
  }
});

void test('save cannot regress a release, overwrite equal-version divergence or restart a terminal', async () => {
  const food = createFreshLocalSimulation(1701);
  const released = shore(food);
  const divergent = structuredClone(released); divergent.state.cities[0]!.name = 'Divergent same-version checkpoint';
  const aheadFood = advanceLocalSimulation(food, 1);
  for (const [stored, current] of [[released, aheadFood], [released, divergent], [terminal(released), advanceLocalSimulation(released, 1)], [food, released]] as const) {
    const f = fixture(stored);
    await f.storage.restore();
    const rejected = await f.storage.save(() => current);
    assert.equal(rejected.blocked, true);
    assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY), f.bytes);
    assert.equal(f.writes.length, 0);
  }
  const f = fixture(released);
  await f.storage.restore();
  assert.deepEqual((await f.storage.save(() => food)).run, released);
  assert.equal(f.writes.length, 0);
});

void test('a source switch while waiting for the lock cancels preparation without touching storage', async () => {
  const f = fixture(createFreshLocalSimulation(1701));
  const restored = await f.storage.restore();
  let current = restored.run;
  let grant: (() => void) | undefined;
  f.ports.withLock = (_key, operation) => new Promise<LocalCheckpointResult>(resolve => { grant = () => resolve(operation()); });
  const pending = f.storage.prepareCurrentRelease(() => current);
  current = null;
  assert.ok(grant); grant();
  const canceled = await pending;
  assert.equal(canceled.run, null);
  assert.equal(canceled.blocked, false);
  assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY), f.bytes);
  assert.equal(f.writes.length, 0);
});

void test('the active getter is checked again after the authoritative read before persisting', async () => {
  const f = fixture(createFreshLocalSimulation(1701));
  const restored = await f.storage.restore();
  let current = restored.run;
  const read = f.ports.read;
  f.ports.read = key => { const raw = read(key); current = null; return raw; };
  const canceled = await f.storage.prepareCurrentRelease(() => current);
  assert.equal(canceled.run, null);
  assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY), f.bytes);
  assert.equal(f.writes.length, 0);
});

function browserTick(f: ReturnType<typeof fixture>, run: LocalSimulation) {
  const main = readFileSync(new URL('../web/main.ts', import.meta.url), 'utf8');
  const start = main.indexOf('async function tickLocalObservatory');
  const end = main.indexOf('window.setInterval', start);
  assert.ok(start >= 0 && end > start);
  const saveStart = main.indexOf('async function saveLocalSimulation');
  const saveEnd = main.indexOf('function observeLocalSimulation', saveStart);
  const source = stripTypeScriptTypes(`${main.slice(saveStart, saveEnd)}\n${main.slice(start, end)}`);
  const workerInputs: LocalSimulation[] = [];
  const context = {
    mode: 'local', document: { hidden: false }, localStopped: false, localAdvancing: false,
    localSimulation: run as LocalSimulation | null, localSaveBlocked: false, localEphemeral: false,
    localSaveMessage: '', localFailure: '', localFrames: 0, localWasObserved: true,
    localWorldStorage: f.storage, localSimulationSnapshot, Error,
    observeLocalSimulation: () => { f.order.push('observe'); },
    renderConnection: () => { f.order.push('render'); },
    advanceLocalSimulationAsync: async (input: LocalSimulation, steps: number) => {
      f.order.push('worker'); workerInputs.push(input);
      if (workerInputs.length === 1) assert.deepEqual(JSON.parse(f.records.get(LOCAL_SIMULATION_STORAGE_KEY)!), input);
      const response = processLocalSimulationRequest({ id: 1, run: input, steps });
      if (!response.ok) throw new Error(response.error);
      return response.run;
    },
  };
  const tick = runInNewContext(`${source}; tickLocalObservatory;`, context) as () => Promise<void>;
  return { context, workerInputs, tick };
}

void test('actual main tick persists preparation before Worker dispatch and retains the six-tick checkpoint cadence', async () => {
  const f = fixture(createFreshLocalSimulation(1701));
  const restored = await f.storage.restore();
  assert.ok(restored.run);
  const view = browserTick(f, restored.run);
  await view.tick();
  assert.equal(view.workerInputs.length, 1);
  assert.equal(view.workerInputs[0]!.state.releaseId, SHORE_LOCAL_RELEASE_ID);
  assert.ok(f.order.indexOf('write') < f.order.indexOf('worker'));
  assert.equal(f.writes.length, 1);
  for (let index = 1; index < 6; index += 1) await view.tick();
  assert.equal(view.workerInputs.length, 6);
  assert.deepEqual(JSON.parse(f.records.get(LOCAL_SIMULATION_STORAGE_KEY)!), view.context.localSimulation);
  assert.equal(f.writes.length, 2);
  assert.equal(view.context.localSimulation!.state.eventCounts['release-applied'], 1);
  assert.equal(view.context.localAdvancing, false);
});

void test('actual main caller dispatches no Worker for inactive, hidden or terminal views', async () => {
  for (const mode of ['living', 'partnerships', 'prior', 'previous', 'live', 'sample', 'loading']) {
    const f = fixture(createFreshLocalSimulation(1701));
    const view = browserTick(f, createFreshLocalSimulation(1701));
    view.context.mode = mode;
    await view.tick();
    assert.equal(view.workerInputs.length, 0, mode);
    assert.deepEqual(f.order, [], mode);
  }
  for (const hidden of [false, true]) {
    const run = hidden ? createFreshLocalSimulation(1701) : terminal(createFreshLocalSimulation(1701));
    const f = fixture(run);
    const view = browserTick(f, run); view.context.document.hidden = hidden;
    await view.tick();
    assert.equal(view.workerInputs.length, 0);
    assert.deepEqual(f.order, []);
  }
});

void test('actual main caller stops on preparation failure or conflict without sending a Worker request', async () => {
  for (const failure of ['write', 'read', 'lock', 'missing', 'corrupt', 'different', 'divergent', 'release'] as const) {
    const run = createFreshLocalSimulation(1701);
    if (failure === 'release') run.state.revision = Number.MAX_SAFE_INTEGER;
    const f = fixture(run);
    const restored = await f.storage.restore(); assert.ok(restored.run);
    const view = browserTick(f, restored.run);
    if (failure === 'write') f.ports.write = () => { throw new Error('quota'); };
    if (failure === 'read') f.ports.read = () => { throw new Error('read'); };
    if (failure === 'lock') f.ports.withLock = async () => { throw new Error('lock'); };
    if (failure === 'missing') f.records.delete(LOCAL_SIMULATION_STORAGE_KEY);
    if (failure === 'corrupt') f.records.set(LOCAL_SIMULATION_STORAGE_KEY, '{corrupt');
    if (failure === 'different') f.records.set(LOCAL_SIMULATION_STORAGE_KEY, JSON.stringify(createFreshLocalSimulation(1702)));
    if (failure === 'divergent') view.context.localSimulation!.state.cities[0]!.name = 'Unsaved';
    const before = f.records.get(LOCAL_SIMULATION_STORAGE_KEY);
    await view.tick(); await view.tick();
    assert.equal(view.workerInputs.length, 0, failure);
    assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY), before, failure);
    assert.equal(view.context.localAdvancing, false, failure);
    assert.equal(f.writes.length, 0, failure);
  }
});

void test('actual main caller keeps no-lock ephemeral advancement on the original Food rules', async () => {
  const f = fixture(createFreshLocalSimulation(1701), {}, true);
  const restored = await f.storage.restore(); assert.ok(restored.run);
  const view = browserTick(f, restored.run);
  await view.tick();
  assert.equal(view.workerInputs.length, 1);
  assert.equal(view.workerInputs[0]!.state.releaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.equal(view.context.localSimulation!.state.releaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.equal(view.context.localEphemeral, true);
  assert.equal(f.writes.length, 0);
  assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY), f.bytes);
});

void test('actual main caller adopts a newer terminal checkpoint without advancing it', async () => {
  const run = createFreshLocalSimulation(1701);
  const f = fixture(run);
  const restored = await f.storage.restore(); assert.ok(restored.run);
  const ended = terminal(advanceLocalSimulation(run, 1));
  const bytes = ` \n${JSON.stringify(ended)}\n`;
  f.records.set(LOCAL_SIMULATION_STORAGE_KEY, bytes);
  const view = browserTick(f, restored.run);
  await view.tick();
  assert.equal(view.workerInputs.length, 0);
  assert.deepEqual(view.context.localSimulation, ended);
  assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY), bytes);
  assert.equal(f.writes.length, 0);
});

void test('actual main caller rechecks source and visibility at lock entry and after awaiting preparation', async () => {
  for (const phase of ['before-lock', 'after-lock'] as const) {
    for (const change of ['source', 'visibility'] as const) {
      const run = createFreshLocalSimulation(1701);
      const f = fixture(run);
      const restored = await f.storage.restore(); assert.ok(restored.run);
      const view = browserTick(f, restored.run);
      const lock = f.ports.withLock!;
      let release: (() => void) | undefined;
      f.ports.withLock = (key, operation) => new Promise<LocalCheckpointResult>(resolve => {
        release = () => { void lock(key, operation).then(result => {
          if (phase === 'after-lock') {
            if (change === 'source') view.context.mode = 'living';
            else view.context.document.hidden = true;
          }
          resolve(result);
        }); };
      });
      const pending = view.tick();
      assert.ok(release);
      if (phase === 'before-lock') {
        if (change === 'source') view.context.mode = 'living';
        else view.context.document.hidden = true;
      }
      release(); await pending;
      assert.equal(view.workerInputs.length, 0, `${phase} ${change}`);
      assert.equal(view.context.localAdvancing, false);
      if (phase === 'before-lock') {
        assert.equal(f.records.get(LOCAL_SIMULATION_STORAGE_KEY), f.bytes);
        assert.equal(f.writes.length, 0);
      }
    }
  }
});
