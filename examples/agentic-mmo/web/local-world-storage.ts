import { SHORE_LOCAL_RELEASE_ID, transitionLocalRelease } from './local-release-transition.ts';
import { LOCAL_SIMULATION_STORAGE_KEY, LIVING_SIMULATION_STORAGE_KEY, PARTNERSHIPS_SIMULATION_STORAGE_KEY, PRIOR_GENERATED_SIMULATION_STORAGE_KEY, PREVIOUS_LOCAL_SIMULATION_STORAGE_KEY, createFreshLocalSimulation, localSimulationSnapshot, parseLocalSimulation, parseActiveLocalSimulation, parsePreviousLocalSimulation, type LocalSimulation, type PreviousLocalSimulation } from './local-simulation.ts';

export interface LocalCheckpointResult {
  run: LocalSimulation | null;
  message: string;
  ephemeral: boolean;
  blocked: boolean;
}

export interface LocalWorldStoragePorts {
  read: (key: string) => string | null;
  write: (key: string, value: string) => void;
  withLock?: (key: string, operation: () => LocalCheckpointResult) => Promise<LocalCheckpointResult>;
  entropy?: () => number;
}

function decode<T>(raw: string, parse: (value: unknown) => T | null): T | null {
  try { return parse(JSON.parse(raw) as unknown); } catch { return null; }
}

function randomSeed(): number {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0]!;
}

export function createLocalWorldStorage(ports: LocalWorldStoragePorts) {
  let ephemeral = !ports.withLock;
  let blocked = false;
  let message = '';
  const result = (run: LocalSimulation | null): LocalCheckpointResult => ({ run, ephemeral, blocked, message });
  const refuse = (reason: string, run: LocalSimulation | null = null): LocalCheckpointResult => {
    blocked = true; ephemeral = true;
    message = `Not saved. ${reason} The stored checkpoint is preserved.`;
    return result(run);
  };
  const adopt = (run: LocalSimulation): LocalCheckpointResult => {
    message = `Saved through round ${run.state.round} · Updated by another tab.`;
    return result(run);
  };
  const restoreRecord = (raw: string): LocalCheckpointResult => {
    const run = decode(raw, parseActiveLocalSimulation);
    if (run) {
      message = ephemeral ? 'This tab only · Not saved. Continuing a copy of the saved world without saving.' : `Saved through round ${run.state.round}.`;
      return result(run);
    }
    blocked = true;
    message = 'The saved Food-budget world could not be read with its original rules. Its record is preserved. Choose another world in Settings.';
    return result(null);
  };
  const historical = (key: string, label: string): { run: LocalSimulation | null; message: string } => {
    let raw: string | null;
    try { raw = ports.read(key); }
    catch { return { run: null, message: `The ${label} cannot be read because browser storage is unavailable.` }; }
    if (raw === null) return { run: null, message: `No ${label} is saved in this browser.` };
    const run = decode(raw, parseLocalSimulation);
    return { run, message: run ? `${label} · Read-only at round ${run.state.round}. Its original save and rules are unchanged.` : `The ${label} could not be read. Its original save is preserved.` };
  };
  return {
    async restore(): Promise<LocalCheckpointResult> {
      let raw: string | null;
      try { raw = ports.read(LOCAL_SIMULATION_STORAGE_KEY); }
      catch { ephemeral = true; message = 'This tab only · Not saved. Browser storage is unavailable.'; return result(createFreshLocalSimulation()); }
      if (raw !== null) return restoreRecord(raw);
      if (ephemeral || !ports.withLock) {
        message = 'This tab only · Not saved. Browser locking or storage is unavailable.';
        return result(createFreshLocalSimulation());
      }
      try {
        return await ports.withLock(LOCAL_SIMULATION_STORAGE_KEY, () => {
          let run: LocalSimulation | null = null;
          try {
            const latest = ports.read(LOCAL_SIMULATION_STORAGE_KEY);
            if (latest !== null) return restoreRecord(latest);
            const seed = (ports.entropy ?? randomSeed)();
            if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Fresh world seed must be a uint32');
            run = createFreshLocalSimulation(seed);
            ports.write(LOCAL_SIMULATION_STORAGE_KEY, JSON.stringify(run));
            message = `Saved through round ${run.state.round}.`;
          } catch { ephemeral = true; message = 'This tab only · Not saved. A fresh browser checkpoint could not be saved.'; }
          return result(run ?? createFreshLocalSimulation());
        });
      } catch { ephemeral = true; message = 'This tab only · Not saved. Browser locking is unavailable.'; return result(createFreshLocalSimulation()); }
    },
    previous(): { run: PreviousLocalSimulation | null; message: string } {
      let raw: string | null;
      try { raw = ports.read(PREVIOUS_LOCAL_SIMULATION_STORAGE_KEY); }
      catch { return { run: null, message: 'The previous local world cannot be read because browser storage is unavailable.' }; }
      if (raw === null) return { run: null, message: 'No previous local world is saved in this browser.' };
      const run = decode(raw, parsePreviousLocalSimulation);
      return { run, message: run ? `Previous local world · Read-only at round ${run.state.round}. Its original save is unchanged.` : 'The previous local world could not be read. Its original save is preserved.' };
    },
    living(): { run: LocalSimulation | null; message: string } {
      return historical(LIVING_SIMULATION_STORAGE_KEY, 'Previous living world');
    },
    partnerships(): { run: LocalSimulation | null; message: string } {
      return historical(PARTNERSHIPS_SIMULATION_STORAGE_KEY, 'Living partnerships world');
    },
    priorGenerated(): { run: LocalSimulation | null; message: string } {
      return historical(PRIOR_GENERATED_SIMULATION_STORAGE_KEY, 'previous generated world');
    },
    async prepareCurrentRelease(current: () => LocalSimulation | null): Promise<LocalCheckpointResult> {
      try {
        const initial = current();
        if (!initial || blocked) return result(null);
        if (!parseActiveLocalSimulation(initial)) return refuse('The active world is incompatible or corrupt.');
        if (ephemeral || !ports.withLock || initial.state.releaseId === SHORE_LOCAL_RELEASE_ID || initial.state.outcome) return result(initial);
        return await ports.withLock(LOCAL_SIMULATION_STORAGE_KEY, () => {
          const run = current();
          if (!run || blocked || ephemeral) return result(null);
          if (!parseActiveLocalSimulation(run)) return refuse('The active world is incompatible or corrupt.');
          if (run.state.releaseId === SHORE_LOCAL_RELEASE_ID || run.state.outcome) return result(run);
          try {
            const raw = ports.read(LOCAL_SIMULATION_STORAGE_KEY);
            const stored = raw === null ? null : decode(raw, parseActiveLocalSimulation);
            if (!stored || localSimulationSnapshot(stored).identity !== localSimulationSnapshot(run).identity)
              return refuse('The saved world is missing, different or unavailable.');
            if (stored.steps < run.steps || stored.state.revision < run.state.revision
              || stored.steps === run.steps && stored.state.revision === run.state.revision && JSON.stringify(stored) !== JSON.stringify(run))
              return refuse('The active world conflicts with its saved checkpoint.');
            const prepared = transitionLocalRelease(stored, 'active-local');
            if (prepared.status === 'refused') return refuse('The compatible release could not be prepared.');
            if (current() !== run) return result(null);
            if (prepared.status === 'changed') {
              ports.write(LOCAL_SIMULATION_STORAGE_KEY, JSON.stringify(prepared.run));
              message = `Saved through round ${prepared.run.state.round}.`;
            } else message = `Saved through round ${stored.state.round}.`;
            return result(prepared.run);
          } catch { return refuse('The compatible release could not be saved.'); }
        });
      } catch { return refuse('Browser locking or storage is unavailable.'); }
    },
    async save(current: () => LocalSimulation | null): Promise<LocalCheckpointResult> {
      if (ephemeral || blocked || !ports.withLock || !current()) return result(current());
      try {
        return await ports.withLock(LOCAL_SIMULATION_STORAGE_KEY, () => {
          const run = current();
          if (!run || ephemeral || blocked) return result(run);
          try {
            if (!parseActiveLocalSimulation(run)) return refuse('Historical or unavailable world rules cannot be saved here.', run);
            const raw = ports.read(LOCAL_SIMULATION_STORAGE_KEY);
            const stored = raw === null ? null : decode(raw, parseActiveLocalSimulation);
            if (!stored || localSimulationSnapshot(stored).identity !== localSimulationSnapshot(run).identity)
              return refuse('A missing, different or unavailable saved world cannot be replaced.', run);
            if (stored.state.releaseId === SHORE_LOCAL_RELEASE_ID && run.state.releaseId !== SHORE_LOCAL_RELEASE_ID) {
              if (stored.steps >= run.steps && stored.state.revision >= run.state.revision) return adopt(stored);
              return refuse('An older world release cannot replace its compatible successor.', run);
            }
            if (stored.state.releaseId !== run.state.releaseId) return refuse('A release must be saved through active preparation.', run);
            if (stored.steps === run.steps && stored.state.revision === run.state.revision) {
              if (JSON.stringify(stored) !== JSON.stringify(run)) return refuse('The active world conflicts with its saved checkpoint.', run);
              message = `Saved through round ${stored.state.round}.`;
              return result(run);
            }
            if (stored.steps >= run.steps && stored.state.revision >= run.state.revision) return adopt(stored);
            if (stored.state.outcome || stored.steps > run.steps || stored.state.revision > run.state.revision)
              return refuse('The active world conflicts with a newer or finished checkpoint.', run);
            ports.write(LOCAL_SIMULATION_STORAGE_KEY, JSON.stringify(run));
            message = `Saved through round ${run.state.round}.`;
          } catch { return refuse('Browser storage is unavailable or full.', run); }
          return result(run);
        });
      } catch { return refuse('Browser locking is unavailable.', current()); }
    },
  };
}
