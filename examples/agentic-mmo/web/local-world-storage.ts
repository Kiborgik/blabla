import { LOCAL_SIMULATION_STORAGE_KEY, PRIOR_GENERATED_SIMULATION_STORAGE_KEY, PREVIOUS_LOCAL_SIMULATION_STORAGE_KEY, createLocalSimulation, localSimulationSnapshot, parseLocalSimulation, parsePreviousLocalSimulation, type LocalSimulation, type PreviousLocalSimulation } from './local-simulation.ts';

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
}

function decode<T>(raw: string, parse: (value: unknown) => T | null): T | null {
  try { return parse(JSON.parse(raw) as unknown); } catch { return null; }
}

export function createLocalWorldStorage(ports: LocalWorldStoragePorts) {
  let ephemeral = !ports.withLock;
  let blocked = false;
  let message = '';
  const result = (run: LocalSimulation | null): LocalCheckpointResult => ({ run, ephemeral, blocked, message });
  return {
    restore(): LocalCheckpointResult {
      let raw: string | null;
      try { raw = ports.read(LOCAL_SIMULATION_STORAGE_KEY); }
      catch { ephemeral = true; message = 'This tab only · Not saved. Browser storage is unavailable.'; return result(createLocalSimulation()); }
      if (raw === null) {
        message = ephemeral ? 'This tab only · Not saved. Browser locking is unavailable.' : 'First browser checkpoint pending.';
        return result(createLocalSimulation());
      }
      const run = decode(raw, parseLocalSimulation);
      if (run) { message = ephemeral ? 'This tab only · Continuing a copy of the saved world without saving.' : `Saved through round ${run.state.round}.`; return result(run); }
      blocked = true; message = 'The saved generated world could not be read. Its record is preserved. Choose another world in Settings.';
      return result(null);
    },
    previous(): { run: PreviousLocalSimulation | null; message: string } {
      let raw: string | null;
      try { raw = ports.read(PREVIOUS_LOCAL_SIMULATION_STORAGE_KEY); }
      catch { return { run: null, message: 'The previous local world cannot be read because browser storage is unavailable.' }; }
      if (raw === null) return { run: null, message: 'No previous local world is saved in this browser.' };
      const run = decode(raw, parsePreviousLocalSimulation);
      return { run, message: run ? `Previous local world · Read-only at round ${run.state.round}. Its original save is unchanged.` : 'The previous local world could not be read. Its original save is preserved.' };
    },
    priorGenerated(): { run: LocalSimulation | null; message: string } {
      let raw: string | null;
      try { raw = ports.read(PRIOR_GENERATED_SIMULATION_STORAGE_KEY); }
      catch { return { run: null, message: 'The previous generated world cannot be read because browser storage is unavailable.' }; }
      if (raw === null) return { run: null, message: 'No previous generated world is saved in this browser.' };
      const run = decode(raw, parseLocalSimulation);
      return { run, message: run ? `Previous generated world · Read-only at round ${run.state.round}. Its original save and rules are unchanged.` : 'The previous generated world could not be read. Its original save is preserved.' };
    },
    async save(current: () => LocalSimulation | null): Promise<LocalCheckpointResult> {
      if (ephemeral || blocked || !ports.withLock || !current()) return result(current());
      try {
        return await ports.withLock(LOCAL_SIMULATION_STORAGE_KEY, () => {
          const run = current();
          if (!run || ephemeral || blocked) return result(run);
          try {
            const raw = ports.read(LOCAL_SIMULATION_STORAGE_KEY);
            if (raw !== null) {
              const stored = decode(raw, parseLocalSimulation);
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
