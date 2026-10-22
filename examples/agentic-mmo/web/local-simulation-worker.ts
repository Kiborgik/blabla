import { advanceLocalSimulation, parseActiveLocalSimulation, type LocalSimulation } from './local-simulation.ts';

export interface LocalSimulationRequest { id: number; run: unknown; steps: number }
export type LocalSimulationReply = { id: number; ok: true; run: LocalSimulation } | { id: number; ok: false; error: string };

export function processLocalSimulationRequest(value: unknown): LocalSimulationReply {
  const request = typeof value === 'object' && value !== null ? value as Partial<LocalSimulationRequest> : {};
  const id = typeof request.id === 'number' && Number.isSafeInteger(request.id) && request.id >= 0 ? request.id : -1;
  try {
    if (id < 0 || typeof request.steps !== 'number') throw new Error('Invalid local simulation request identity or work bound');
    const run = parseActiveLocalSimulation(request.run);
    if (!run) throw new Error('Local checkpoint is incompatible or corrupt; its saved data was not replaced');
    return { id, ok: true, run: advanceLocalSimulation(run, request.steps) };
  } catch (error) {
    return { id, ok: false, error: error instanceof Error ? error.message : 'Local simulation could not advance' };
  }
}

if (typeof document === 'undefined' && typeof globalThis.postMessage === 'function') {
  globalThis.addEventListener('message', (event: MessageEvent<LocalSimulationRequest>) => {
    globalThis.postMessage(processLocalSimulationRequest(event.data));
  });
}
