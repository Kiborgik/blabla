import { LOCAL_SIMULATION_STORAGE_KEY, createFreshLocalSimulation, localSimulationSnapshot, parseLocalSimulation, type LocalSimulation } from './local-simulation.ts';

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

function decode(raw: string): LocalSimulation | null {
  try { return parseLocalSimulation(JSON.parse(raw) as unknown); } catch { return null; }
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
    const run = decode(raw);
    if (run) {
      message = ephemeral ? 'This tab only · Not saved. Continuing a copy of the saved world without saving.' : `Saved through round ${run.state.round}.`;
      return result(run);
    }
    blocked = true;
    message = 'The current-version world could not be read. Its record is preserved. Shared history remains available in Settings.';
    return result(null);
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
            message = `New world · Current development version · Saved through round ${run.state.round}.`;
          } catch { ephemeral = true; message = 'This tab only · Not saved. A fresh browser checkpoint could not be saved.'; }
          return result(run ?? createFreshLocalSimulation());
        });
      } catch { ephemeral = true; message = 'This tab only · Not saved. Browser locking is unavailable.'; return result(createFreshLocalSimulation()); }
    },
    async save(current: () => LocalSimulation | null): Promise<LocalCheckpointResult> {
      if (ephemeral || blocked || !ports.withLock || !current()) return result(current());
      try {
        return await ports.withLock(LOCAL_SIMULATION_STORAGE_KEY, () => {
          const run = current();
          if (!run || ephemeral || blocked) return result(run);
          try {
            if (!parseLocalSimulation(run)) return refuse('Incompatible or corrupt world rules cannot be saved here.', run);
            const raw = ports.read(LOCAL_SIMULATION_STORAGE_KEY);
            const stored = raw === null ? null : decode(raw);
            if (!stored || localSimulationSnapshot(stored).identity !== localSimulationSnapshot(run).identity)
              return refuse('A missing, different or unavailable saved world cannot be replaced.', run);
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
