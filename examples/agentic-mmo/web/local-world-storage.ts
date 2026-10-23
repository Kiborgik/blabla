import { LOCAL_SIMULATION_STORAGE_KEY, LIVING_SIMULATION_STORAGE_KEY, PARTNERSHIPS_SIMULATION_STORAGE_KEY, PRIOR_GENERATED_SIMULATION_STORAGE_KEY, PREVIOUS_LOCAL_SIMULATION_STORAGE_KEY, createLocalSimulation, localSimulationSnapshot, parseLocalSimulation, parseActiveLocalSimulation, parsePreviousLocalSimulation, type LocalSimulation, type PreviousLocalSimulation } from './local-simulation.ts';

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
      catch { ephemeral = true; message = 'This tab only · Not saved. Browser storage is unavailable.'; return result(createLocalSimulation()); }
      if (raw !== null) return restoreRecord(raw);
      if (ephemeral || !ports.withLock) {
        message = 'This tab only · Not saved. Browser locking or storage is unavailable.';
        return result(createLocalSimulation());
      }
      try {
        return await ports.withLock(LOCAL_SIMULATION_STORAGE_KEY, () => {
          let run: LocalSimulation | null = null;
          try {
            const latest = ports.read(LOCAL_SIMULATION_STORAGE_KEY);
            if (latest !== null) return restoreRecord(latest);
            const seed = (ports.entropy ?? randomSeed)();
            if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('Fresh world seed must be a uint32');
            run = createLocalSimulation(seed);
            ports.write(LOCAL_SIMULATION_STORAGE_KEY, JSON.stringify(run));
            message = `Saved through round ${run.state.round}.`;
          } catch { ephemeral = true; message = 'This tab only · Not saved. A fresh browser checkpoint could not be saved.'; }
          return result(run ?? createLocalSimulation());
        });
      } catch { ephemeral = true; message = 'This tab only · Not saved. Browser locking is unavailable.'; return result(createLocalSimulation()); }
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
    async save(current: () => LocalSimulation | null): Promise<LocalCheckpointResult> {
      if (ephemeral || blocked || !ports.withLock || !current()) return result(current());
      try {
        return await ports.withLock(LOCAL_SIMULATION_STORAGE_KEY, () => {
          const run = current();
          if (!run || ephemeral || blocked) return result(run);
          try {
            if (!parseActiveLocalSimulation(run)) {
              blocked = true; ephemeral = true; message = 'This tab only · Not saved. Historical or unavailable world rules were preserved.'; return result(run);
            }
            const raw = ports.read(LOCAL_SIMULATION_STORAGE_KEY);
            if (raw !== null) {
              const stored = decode(raw, parseActiveLocalSimulation);
              if (!stored || localSimulationSnapshot(stored).identity !== localSimulationSnapshot(run).identity) {
                blocked = true; ephemeral = true; message = 'This tab only · Not saved. A different or unavailable saved world was preserved.'; return result(run);
              }
              if (stored.steps > run.steps || stored.state.revision > run.state.revision) {
                message = `Saved through round ${stored.state.round} · Updated by another tab.`; return result(stored);
              }
            }
            ports.write(LOCAL_SIMULATION_STORAGE_KEY, JSON.stringify(run));
            message = `Saved through round ${run.state.round}.`;
          } catch { ephemeral = true; message = 'This tab only · Not saved. Browser storage is unavailable or full.'; }
          return result(run);
        });
      } catch { ephemeral = true; message = 'This tab only · Not saved. Browser locking is unavailable.'; return result(current()); }
    },
  };
}
