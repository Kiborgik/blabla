import { planDeploymentUpdate, prepareDeploymentUpdate, restoreDeploymentPreferences, UPDATE_COOLDOWN_MS, UPDATE_RETRY_PARAM } from './deployment-update.ts';
import type { PreferenceCarry, UpdatePlan, UpdateStorage } from './deployment-update.ts';
import { parsePreferences } from './viewer-state.ts';
import type { Release, ViewerPreferences } from './viewer-state.ts';

export interface UpdateNotice { message: string; action: 'check' | 'update' | null }
export interface ViewerUpdatePorts {
  current: Release; fetchRelease: () => Promise<unknown>; now: () => number; href: () => string; preferences: () => ViewerPreferences;
  attempts: UpdateStorage; readHistory: () => unknown; replaceHistory: (state: unknown, href: string) => void;
  savePreferences: (preferences: ViewerPreferences) => void; navigate: (href: string, reload: boolean) => void; notice: (notice: UpdateNotice | null) => void;
}
interface HistoryCarry { tag: 'civitas-viewer-update-v1'; carry: unknown; previous: unknown }
function carriedHistory(state: unknown): HistoryCarry | null {
  if (state === null || typeof state !== 'object' || !('tag' in state) || state.tag !== 'civitas-viewer-update-v1' || !('carry' in state) || !('previous' in state)) return null;
  return { tag: state.tag, carry: state.carry, previous: state.previous };
}
export function updateHistoryState(state: unknown): unknown { const carried = carriedHistory(state); return carried ? carried.previous : state; }
export function preferencesAfterUpdate(build: string, stored: unknown, history: unknown): ViewerPreferences {
  return restoreDeploymentPreferences(build, stored, carriedHistory(history)?.carry);
}

export function createViewerUpdates(ports: ViewerUpdatePorts): { check: () => Promise<void>; act: () => void; dispose: () => void } {
  let inFlight = false; let consumed = false; let disposed = false; let attemptedAt = 0; let awaitingManual = false;
  let manual: { href: string; to: string } | null = null;
  try {
    const history = ports.readHistory();
    const clean = planDeploymentUpdate({ current: ports.current, remote: ports.current, now: ports.now(), url: ports.href(), preferences: ports.preferences() });
    if (carriedHistory(history) || clean.href) ports.replaceHistory(updateHistoryState(history), clean.href ?? ports.href());
  } catch { }
  function notice(message: string, action: UpdateNotice['action']): void { if (!disposed) ports.notice({ message, action }); }
  function navigate(explicit: boolean): void {
    if (!manual || disposed) return;
    consumed = true;
    attemptedAt = ports.now();
    const preferences = parsePreferences(ports.preferences());
    const carry: PreferenceCarry = { schemaVersion: 1, from: ports.current.buildId, to: manual.to, preferences };
    let saved = false; let retained = false;
    try { ports.savePreferences(preferences); saved = true; } catch { }
    try {
      const previous = updateHistoryState(ports.readHistory());
      ports.replaceHistory({ tag: 'civitas-viewer-update-v1', carry, previous } satisfies HistoryCarry, manual.href);
      retained = true;
    } catch { }
    if (!saved && !retained && !explicit) { awaitingManual = true; notice('A newer view is ready. Your settings may reset because this browser cannot save them.', 'update'); return; }
    awaitingManual = false;
    notice('A newer view is ready. Updating…', null);
    try { ports.navigate(manual.href, retained); }
    catch { notice('The new view did not open. You can try updating it yourself.', 'update'); }
  }
  function remember(plan: UpdatePlan): void {
    if (!plan.attempt) return;
    const href = new URL(ports.href());
    href.searchParams.set(UPDATE_RETRY_PARAM, JSON.stringify(plan.attempt));
    manual = { href: plan.href ?? href.href, to: plan.attempt.to };
  }
  async function check(): Promise<void> {
    if (disposed || inFlight) return;
    if (consumed) {
      if (!awaitingManual && ports.now() >= attemptedAt + UPDATE_COOLDOWN_MS) notice('The new view has not opened. You can update it yourself.', 'update');
      return;
    }
    inFlight = true;
    try {
      const remote = await ports.fetchRelease();
      if (disposed) return;
      const { plan } = prepareDeploymentUpdate({ current: ports.current, remote, now: ports.now(), url: ports.href(), preferences: ports.preferences() }, ports.attempts);
      remember(plan);
      if (plan.status === 'reload') navigate(false);
      else if (plan.status === 'exhausted') notice('The new view did not load after two tries. You can update it yourself.', 'update');
      else if (plan.status === 'cooldown') notice('A newer view is ready. Retrying shortly…', 'update');
      else if (plan.status === 'invalid') { manual = null; notice('Could not read the viewer update. The world view is still open.', 'check'); }
      else {
        manual = null;
        if (plan.href) try { ports.replaceHistory(updateHistoryState(ports.readHistory()), plan.href); } catch { }
        ports.notice(null);
      }
    } catch { manual = null; notice('Could not check for a viewer update. The world view is still open.', 'check'); }
    finally { inFlight = false; }
  }
  return { check, act: () => { if (!disposed && !inFlight) { if (manual) navigate(true); else void check(); } }, dispose: () => { disposed = true; } };
}
