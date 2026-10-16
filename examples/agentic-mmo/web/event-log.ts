import type { GameEvent } from '../core/types.ts';
import { eventVisual, type VisualDelta } from '../visuals/event-visuals.ts';
import type { VisualIcon } from '../visuals/visual-language.ts';
import type { RouteResultCue } from '../visuals/route-cues.ts';
import { deltaNumber, routeResultPresentation, visualIcon } from './world-cues.ts';

export interface EventLogOptions {
  civilizations: readonly { id: number; name: string; color: string }[];
  receipts?: readonly RouteResultCue[];
}
export interface EventLogEntry {
  id: string; round: number; title: string; category: string; family: string; icon: VisualIcon;
  participants: Array<{ name: string; color: string | null }>;
  cause: string; detail: string; effects: string[]; deltas: VisualDelta[];
  qualifiers: string[]; receiptDetails: string[];
}
const GROUPS: ReadonlyArray<{ prefix: string; category: string; family: string; icon: VisualIcon }> = [
  { prefix: 'research', category: 'Research', family: 'research', icon: 'science' },
  { prefix: 'trade', category: 'Trade result', family: 'trade', icon: 'cargo' },
  { prefix: 'public-project', category: 'Shared project', family: 'trade', icon: 'influence' },
  { prefix: 'building', category: 'Building result', family: 'building', icon: 'infrastructure' },
  { prefix: 'settlement-production', category: 'Production', family: 'production', icon: 'food' },
  { prefix: 'settlement', category: 'Settlement', family: 'building', icon: 'infrastructure' },
  { prefix: 'city-repaired', category: 'City repair', family: 'building', icon: 'repair' },
  { prefix: 'population', category: 'Population', family: 'population', icon: 'population' },
  { prefix: 'focus', category: 'Town choice', family: 'choice', icon: 'influence' },
  { prefix: 'earthquake', category: 'Earthquake', family: 'disruption', icon: 'damage' },
  { prefix: 'drought', category: 'Dry season', family: 'disruption', icon: 'drought' },
  { prefix: 'supply-shortage', category: 'Shortage', family: 'disruption', icon: 'food' },
  { prefix: 'clock', category: 'Calendar', family: 'world', icon: 'discovery' },
  { prefix: 'history', category: 'History', family: 'world', icon: 'discovery' },
];

function participant(id: number | null, options: EventLogOptions): EventLogEntry['participants'][number] {
  const civ = options.civilizations.find(candidate => candidate.id === id);
  return {
    name: civ?.name ?? (id === null ? 'World' : id === 5 ? 'World Director' : `Civilization ${id}`),
    color: civ && /^#[0-9a-f]{6}$/i.test(civ.color) ? civ.color : null,
  };
}
function retainedReceipt(event: GameEvent, receipts: readonly RouteResultCue[]): RouteResultCue | undefined {
  return receipts.find(cue => cue.eventId === event.id && cue.round === event.round && (
    cue.kind === 'delivery' ? event.type === 'trade-delivered' && event.detail === cue.routeId
      : event.publicProjectResult?.projectId === cue.result.projectId
        && event.publicProjectResult.routeId === cue.routeId
        && event.publicProjectResult.agreementOfferId === cue.agreementOfferId
  ));
}

export function eventLogEntries(events: readonly GameEvent[], options: EventLogOptions): EventLogEntry[] {
  return events.slice(-24).toReversed().map(event => {
    const visual = eventVisual(event);
    const group = GROUPS.find(candidate => event.type === candidate.prefix || event.type.startsWith(`${candidate.prefix}-`));
    const cue = retainedReceipt(event, options.receipts ?? []);
    const receipt = cue ? routeResultPresentation(cue) : null;
    const deltas = receipt?.deltas ?? visual?.deltas ?? [];
    const qualifiers = [
      ...(deltas.some(delta => delta.kind === 'production') ? ['Produced · Before costs'] : []),
      ...(deltas.some(delta => delta.kind === 'payment') ? ['Paid inputs'] : []),
      ...(deltas.some(delta => delta.kind === 'rate') ? ['Base / season · Capacity, not goods made'] : []),
      ...(event.type === 'trade-delivered' && !cue ? ['Per-party receipt not retained in this view. Recorded totals are below.'] : []),
    ];
    return {
      id: event.id, round: event.round, title: event.title, category: group?.category ?? 'World record', family: group?.family ?? 'world',
      icon: receipt?.icon ?? visual?.icon ?? group?.icon ?? 'discovery',
      participants: [participant(event.actor, options), ...(event.target !== null && event.target !== event.actor ? [participant(event.target, options)] : [])],
      cause: event.cause, detail: event.detail, effects: [...event.effects], deltas: structuredClone(deltas), qualifiers,
      receiptDetails: receipt?.details ?? [],
    };
  });
}
function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = value; node.className = className; return node;
}
function deltaChip(delta: VisualDelta): HTMLElement {
  const chip = text('span', '', `event-log-delta ${delta.tone}`);
  const label = `${delta.label}${delta.kind === 'production' ? ' made' : delta.kind === 'payment' ? ' paid' : delta.kind === 'rate' ? ' base' : delta.icon === 'damage' && delta.kind === 'delta' ? ' points' : ''}`;
  chip.append(visualIcon(delta.icon), text('b', deltaNumber(delta)), text('span', label));
  if (delta.subject) chip.append(text('small', delta.subject));
  return chip;
}
export function renderEventLog(host: HTMLElement, events: readonly GameEvent[], options: EventLogOptions): void {
  host.className = 'semantic-event-log';
  host.setAttribute('aria-label', 'Recorded world events, newest first');
  host.replaceChildren();
  const rows = eventLogEntries(events, options);
  if (!rows.length) { host.append(text('li', 'No recorded events in this view.', 'event-log-empty')); return; }
  for (const row of rows) {
    const item = text('li', '', 'event-log-entry'); item.dataset['eventId'] = row.id; item.dataset['family'] = row.family;
    const marker = text('span', '', 'event-log-marker'); marker.append(visualIcon(row.icon));
    const content = text('article', '', 'event-log-content');
    const meta = text('div', '', 'event-log-meta');
    meta.append(text('span', row.category, 'event-log-category'), text('span', `Round ${row.round}`));
    const actors = text('div', '', 'event-log-actors');
    for (const [index, person] of row.participants.entries()) {
      if (index) actors.append(text('span', '→', 'event-log-arrow'));
      const actor = text('span', '', 'event-log-actor');
      const dot = text('span', '', 'event-log-actor-mark'); dot.setAttribute('aria-hidden', 'true');
      if (person.color) dot.setAttribute('style', `--actor-color:${person.color}`);
      actor.append(dot, text('span', person.name)); actors.append(actor);
    }
    content.append(meta, text('h3', row.title), actors);
    if (row.deltas.length) { const chips = text('div', '', 'event-log-deltas'); chips.append(...row.deltas.map(deltaChip)); content.append(chips); }
    for (const qualifier of row.qualifiers) content.append(text('p', qualifier, 'event-log-qualifier'));
    const details = text('details', '', 'event-log-details');
    details.append(text('summary', 'Recorded details'));
    if (row.cause) details.append(text('p', `Cause: ${row.cause}`));
    if (row.detail) details.append(text('p', `Record: ${row.detail}`));
    const facts = text('ul', '', 'event-log-facts');
    for (const fact of [...row.effects, ...row.receiptDetails]) facts.append(text('li', fact));
    details.append(facts, text('p', `Event ${row.id}`, 'event-log-record-id'));
    content.append(details); item.append(marker, content); host.append(item);
  }
}
