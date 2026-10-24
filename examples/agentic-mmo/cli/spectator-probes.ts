import type { GameEvent } from '../core/types.ts';
import { createEventCueTracker, type VisualEvent } from '../visuals/event-visuals.ts';
import { parseRelease, shouldReload, type Release } from '../web/viewer-state.ts';

const CURRENT: Release = { schemaVersion: 2, version: 'synthetic-current', buildId: 'current', preparedAt: '2026-10-16T00:00:00.000Z' };

function syntheticEvent(sequence: number, known: boolean, importance = 1): GameEvent {
  return { id: `synthetic:${sequence}`, round: 0, type: known ? 'population-growth' : 'synthetic-unknown-event', title: 'Synthetic policy input', detail: 'Synthetic event fixture', actor: 0, target: 0, tileId: 0, cause: 'Policy fixture', effects: ['Population +1'], importance };
}

export class SpectatorPolicyProbes {
  private remote: Release | null = null;
  private attempts: string[] = [];
  private offerSequence = 0;
  private requested = false;
  private requests = 0;
  private tracker = createEventCueTracker();
  private run = 0;
  private sequence = 0;
  private firstObservation = true;
  private appendedKnown = false;
  private events: GameEvent[] = [];
  private previous: GameEvent[] = [];
  private supplied: GameEvent[] = [];
  private cues: VisualEvent[] = [];

  reset(): void {
    this.remote = null;
    this.attempts = [];
    this.offerSequence = 0;
    this.requested = false;
    this.requests = 0;
    this.tracker = createEventCueTracker();
    this.run = 0;
    this.sequence = 0;
    this.firstObservation = true;
    this.appendedKnown = false;
    this.events = [];
    this.previous = [];
    this.supplied = [];
    this.cues = [];
  }

  snapshot() {
    return structuredClone({ current: CURRENT, remote: this.remote, attempts: this.attempts, identity: `synthetic-run:${this.run}`, events: this.events, previous: this.previous, supplied: this.supplied, cues: this.cues });
  }

  observe() {
    const windowIds = new Set(this.supplied.slice(-96).map((event) => event.id));
    const previousIds = new Set(this.previous.map((event) => event.id));
    return {
      reload_remote_valid: this.remote !== null,
      reload_distinct: this.remote !== null && this.remote.buildId !== CURRENT.buildId,
      reload_newer: this.remote !== null && Date.parse(this.remote.preparedAt) > Date.parse(CURRENT.preparedAt),
      reload_attempted: this.remote !== null && this.attempts.includes(this.remote.buildId),
      reload_requested: this.requested,
      reload_requests: this.requests,
      cue_count: this.cues.length,
      cue_ids_from_window: this.cues.every((cue) => windowIds.has(cue.eventId)),
      cue_ids_not_in_previous_window: this.cues.every((cue) => !previousIds.has(cue.eventId)),
      cue_first_observation: this.firstObservation,
      cue_appended_known: this.appendedKnown,
    };
  }

  deploymentOffer(kind: number): void {
    let input: unknown = { ...CURRENT, preparedAt: 'invalid' };
    if (kind === 1) input = { ...CURRENT, preparedAt: '2026-10-16T00:00:01.000Z' };
    if (kind === 2) input = { ...CURRENT, buildId: 'older', preparedAt: '2026-10-15T23:59:59.000Z' };
    if (kind === 3) input = { ...CURRENT, buildId: 'equal-time' };
    if (kind === 4 || kind === 5) {
      const sequence = kind === 4 ? ++this.offerSequence : 1;
      input = { ...CURRENT, buildId: `newer:${sequence}`, preparedAt: new Date(Date.parse(CURRENT.preparedAt) + sequence * 1000).toISOString() };
    }
    this.remote = parseRelease(input);
  }

  deploymentPoll(): void {
    this.requested = shouldReload(CURRENT, this.remote, this.attempts);
    if (this.requested && this.remote) {
      this.attempts = [...this.attempts, this.remote.buildId].slice(-20);
      this.requests += 1;
    }
  }

  private observeEvents(events: GameEvent[]): void {
    this.previous = this.events;
    this.supplied = events;
    this.cues = this.tracker.observe(`synthetic-run:${this.run}`, events);
    this.events = events.slice(-96);
    this.firstObservation = false;
  }

  cuePoll(): void { this.observeEvents(this.events); }

  cueAppend(kind: number): void {
    this.appendedKnown = kind === 0;
    this.observeEvents([...this.events, syntheticEvent(++this.sequence, this.appendedKnown)].slice(-96));
  }

  cueFlood(): void {
    this.observeEvents(Array.from({ length: 100 }, (_, index) => syntheticEvent(++this.sequence, true, index === 0 ? 9 : index === 10 ? 5 : 1)));
  }

  cueNewRun(): void {
    this.run += 1;
    this.observeEvents(this.events);
  }
}
