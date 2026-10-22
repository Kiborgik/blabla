import { parseLocalSimulation, type LocalSimulation } from './local-simulation.ts';
import type { LocalSimulationReply, LocalSimulationRequest } from './local-simulation-worker.ts';

interface PendingStep { id: number; timer: ReturnType<typeof setTimeout>; resolve: (run: LocalSimulation) => void; reject: (error: Error) => void }
let worker: Worker | null = null;
let pending: PendingStep | null = null;
let nextId = 1;

function stopWorker(error: Error): void {
  worker?.terminate();
  worker = null;
  if (!pending) return;
  const current = pending;
  pending = null;
  clearTimeout(current.timer);
  current.reject(error);
}

function simulationWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./local-simulation-worker.ts', import.meta.url), { type: 'module', name: 'civitas-local-world' });
  worker.addEventListener('error', () => stopWorker(new Error('The local simulation worker stopped; the last completed checkpoint is preserved')));
  worker.addEventListener('messageerror', () => stopWorker(new Error('The local simulation reply could not be read; the last completed checkpoint is preserved')));
  worker.addEventListener('message', (event: MessageEvent<LocalSimulationReply>) => {
    const current = pending;
    if (!current || event.data?.id !== current.id) return;
    const run = event.data.ok ? parseLocalSimulation(event.data.run) : null;
    if (!event.data.ok || !run) {
      stopWorker(new Error(event.data.ok ? 'The local simulation returned an invalid checkpoint' : event.data.error));
      return;
    }
    pending = null;
    clearTimeout(current.timer);
    current.resolve(run);
  });
  return worker;
}

export function advanceLocalSimulationAsync(run: LocalSimulation, steps = 1): Promise<LocalSimulation> {
  if (pending) return Promise.reject(new Error('A local simulation step is already in progress'));
  if (typeof Worker === 'undefined') return Promise.reject(new Error('This browser cannot run the background local simulation; shared history remains available'));
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => stopWorker(new Error('Local simulation exceeded its bounded work timeout; the last completed checkpoint is preserved')), 30_000);
    pending = { id, timer, resolve, reject };
    try {
      const request: LocalSimulationRequest = { id, run, steps };
      simulationWorker().postMessage(request);
    } catch (error) {
      stopWorker(error instanceof Error ? error : new Error('The local simulation could not start'));
    }
  });
}

export function disposeLocalSimulationWorker(): void {
  stopWorker(new Error('The local simulation view was closed; the last completed checkpoint is preserved'));
}
