import type { GameEvent, Resources } from '../core/types.ts';
import { BUILDINGS, RESOURCE_IDS, TECHNOLOGIES } from '../core/content.ts';
import { eventVisual, type VisualDelta } from '../visuals/event-visuals.ts';
import type { VisualIcon } from '../visuals/visual-language.ts';
import { METRIC_LABELS } from '../visuals/visual-language.ts';
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
  summary: string; routine: boolean;
  exchanges: Array<{ from: string; to: string; cargo: string; upkeep: string; commerce: string }>;
}
const GROUPS: ReadonlyArray<{ prefix: string; category: string; family: string; icon: VisualIcon }> = [
  { prefix: 'research', category: 'Research', family: 'research', icon: 'science' },
  { prefix: 'trade', category: 'Trade result', family: 'trade', icon: 'cargo' },
  { prefix: 'public-project', category: 'Shared project', family: 'trade', icon: 'influence' },
  { prefix: 'building', category: 'Building result', family: 'building', icon: 'infrastructure' },
  { prefix: 'construction', category: 'Construction', family: 'building', icon: 'infrastructure' },
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

function routineEvent(event: GameEvent): boolean {
  return event.type === 'settlement-production' || event.type === 'strategy-beat'
    || event.type.startsWith('clock-')
    || event.type === 'building-operation' && !event.title.endsWith(' blocked');
}

export function latestStoryEvent(events: readonly GameEvent[]): GameEvent | undefined {
  const window = events.slice(-96);
  return window.findLast(event => !routineEvent(event))
    ?? window.findLast(event => event.type === 'settlement-production' || event.type === 'building-operation')
    ?? window.at(-1);
}

function namedStory(event: GameEvent, options: EventLogOptions): { title: string; category?: string; summary: string } {
  const actor = participant(event.actor, options).name;
  const target = participant(event.target, options).name;
  const technology = TECHNOLOGIES.find(candidate => candidate.id === event.detail);
  if (event.type === 'earthquake' && event.title === `The earth moves: ${target}`) return { title: `Earthquake hit ${target}`, summary: '' };
  if (event.type === 'research-started' && technology) return { title: `${actor} began ${technology.name}`, category: 'Researching', summary: '' };
  if (event.type === 'research-completed') return { title: event.title.replace(' discovers ', ' discovered '), category: 'Discovery', summary: 'Research completed.' };
  if (event.type === 'building-completed') return { title: event.title.replace(' builds ', ' completed '), category: 'Built', summary: 'Built. Production is recorded separately.' };
  if (event.type === 'construction-started') return { title: event.title.replace(' starts ', ' started building '), category: 'Building', summary: 'Construction started. The building is not finished yet.' };
  if (event.type === 'building-operation') {
    const match = /^(.*): (.+) (operated|paused|blocked)$/.exec(event.title);
    const made = eventVisual(event)?.deltas.some(delta => delta.kind === 'production' && delta.value > 0);
    if (match) return { title: `${match[1]} · ${match[2]}`, category: match[3] === 'paused' ? 'Paused' : match[3] === 'blocked' ? 'Needs support' : made ? 'Made supplies' : 'No output',
      summary: match[3] === 'paused' ? 'No inputs used or goods made this season.' : match[3] === 'blocked' ? 'This recipe could not run. See Details for the recorded shortage.' : made ? 'Made before other costs. Used inputs are separate.' : 'No goods made in this recorded season.' };
  }
  if (event.type === 'building-operation-changed') {
    const id = event.detail.split('/')[1];
    const building = BUILDINGS.find(candidate => candidate.id === id);
    if (building && id && event.title.endsWith(` ${id}`)) return { title: event.title.slice(0, -id.length) + building.name, category: 'Work choice', summary: 'This changes future seasons; it does not record new output.' };
  }
  if (event.type === 'trade-proposed' && event.target !== null) return { title: `${actor} offered trade to ${target}`, category: 'Offer', summary: 'Partner agreement was still needed. No cargo was delivered by this offer.' };
  if (event.type === 'trade-accepted' && event.target !== null) return { title: `${actor} agreed to trade with ${target}`, category: 'Agreement', summary: 'The agreement began. A delivery is recorded separately.' };
  if (event.type === 'trade-delivered' && event.target !== null && event.target !== event.actor) return { title: `${actor} and ${target} exchanged cargo`, category: 'Delivered', summary: 'A completed exchange. Cargo and costs are separate.' };
  if (event.type === 'trade-stopped' && event.target !== null) return { title: `${actor} stopped trade with ${target}`, category: 'Stopped', summary: 'Future shipments stopped. Earlier deliveries remain recorded.' };
  if (event.type === 'settlement-production') return { title: `${actor} made supplies`, category: 'Season result', summary: 'Gross output before household upkeep and growth costs.' };
  return { title: event.title, summary: '' };
}

function amounts(vector: Partial<Resources>): string {
  return RESOURCE_IDS.filter(resource => (vector[resource] ?? 0) > 0)
    .map(resource => `${vector[resource]} ${METRIC_LABELS[resource]}`).join(', ') || 'None';
}

export function eventLogEntries(events: readonly GameEvent[], options: EventLogOptions): EventLogEntry[] {
  const window = events.slice(-96);
  const priority = window.filter(event => !routineEvent(event)).slice(-16);
  const selected = new Set(priority.map(event => event.id));
  for (const event of window.toReversed()) {
    if (selected.size >= 24) break;
    selected.add(event.id);
  }
  return window.filter(event => selected.has(event.id)).toReversed().map(event => {
    const story = namedStory(event, options);
    const visual = eventVisual(event);
    const group = GROUPS.find(candidate => event.type === candidate.prefix || event.type.startsWith(`${candidate.prefix}-`));
    const cue = retainedReceipt(event, options.receipts ?? []);
    const receipt = cue ? routeResultPresentation(cue) : null;
    const exchange = cue?.kind === 'delivery' ? cue.exchange : null;
    const exchanges = exchange ? [[exchange.proposer, exchange.recipient], [exchange.recipient, exchange.proposer]].flatMap(([side, other]) => side && other ? [{
      from: participant(side.civilization, options).name, to: participant(other.civilization, options).name,
      cargo: amounts(side.cargo), upkeep: amounts(side.paidUpkeep), commerce: amounts(side.creditedCommerce),
    }] : []) : [];
    const deltas = (receipt?.deltas ?? visual?.deltas ?? []).map(delta => ({ ...delta, subject: delta.subject?.startsWith('Route route-') ? 'Trade route' : delta.subject }));
    const qualifiers = [
      ...(deltas.some(delta => delta.kind === 'production') ? ['Produced · Before costs'] : []),
      ...(deltas.some(delta => delta.kind === 'payment') ? ['Paid inputs'] : []),
      ...(deltas.some(delta => delta.kind === 'rate') ? ['Base / season · Capacity, not goods made'] : []),
      ...(event.type === 'trade-delivered' && !cue ? ['Per-party receipt not retained in this view. Recorded totals are below.'] : []),
    ];
    return {
      id: event.id, round: event.round, title: story.title, category: story.category ?? group?.category ?? 'World record', family: group?.family ?? 'world',
      icon: receipt?.icon ?? visual?.icon ?? group?.icon ?? 'discovery',
      participants: [participant(event.actor, options), ...(event.target !== null && event.target !== event.actor ? [participant(event.target, options)] : [])],
      cause: event.cause, detail: event.detail, effects: [...event.effects], deltas: structuredClone(deltas), qualifiers,
      receiptDetails: receipt?.details ?? [],
      summary: story.summary, routine: routineEvent(event),
      exchanges,
    };
  });
}
function text<K extends keyof HTMLElementTagNameMap>(tag: K, value: string, className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); node.textContent = value; node.className = className; return node;
}
function deltaChip(delta: VisualDelta): HTMLElement {
  const chip = text('span', '', `event-log-delta ${delta.tone}`);
  const prefix = delta.kind === 'production' ? 'Made' : delta.kind === 'payment' ? 'Used' : delta.kind === 'rate' ? 'Base' : delta.icon === 'cargo' ? 'Exchanged' : '';
  const label = `${delta.label}${delta.icon === 'damage' && delta.kind === 'delta' ? ' points' : ''}`;
  chip.append(visualIcon(delta.icon), text('span', prefix, 'event-log-verb'), text('b', deltaNumber(delta)), text('span', label));
  if (delta.subject) chip.append(text('small', delta.subject));
  return chip;
}
function appendEventRow(parent: HTMLElement, row: EventLogEntry): void {
  const item = text('li', '', 'event-log-entry'); item.dataset['eventId'] = row.id; item.dataset['family'] = row.family;
  const marker = text('span', '', 'event-log-marker'); marker.append(visualIcon(row.icon));
  const actorColor = row.participants.find(person => person.color)?.color;
  if (actorColor) item.setAttribute('style', `--event-actor:${actorColor}`);
  const content = text('article', '', 'event-log-content');
  const meta = text('div', '', 'event-log-meta');
  meta.append(text('span', row.category, 'event-log-category'));
  const actors = text('div', '', 'event-log-actors');
  for (const [index, person] of row.participants.entries()) {
    if (index) actors.append(text('span', '→', 'event-log-arrow'));
    const actor = text('span', '', 'event-log-actor');
    const dot = text('span', '', 'event-log-actor-mark'); dot.setAttribute('aria-hidden', 'true');
    if (person.color) dot.setAttribute('style', `--actor-color:${person.color}`);
    actor.append(dot, text('span', person.name)); actors.append(actor);
  }
  if (!row.participants.every(person => row.title.includes(person.name))) meta.append(actors);
  content.append(meta, text('h3', row.title));
  if (row.summary) content.append(text('p', row.summary, 'event-log-summary'));
  if (row.deltas.length) { const chips = text('div', '', 'event-log-deltas'); chips.append(...row.deltas.map(deltaChip)); content.append(chips); }
  for (const exchange of row.exchanges) {
    const block = text('div', '', 'event-log-exchange');
    block.append(text('strong', `${exchange.from} → ${exchange.to}`), text('p', `Sent ${exchange.cargo}`), text('p', `Used for transport: ${exchange.upkeep}`), text('p', `Commerce received: ${exchange.commerce}`));
    content.append(block);
  }
  const details = text('details', '', 'event-log-details');
  details.append(text('summary', 'Details'));
  for (const qualifier of row.qualifiers) details.append(text('p', qualifier, 'event-log-qualifier'));
  if (row.cause) details.append(text('p', `Cause: ${row.cause}`));
  if (row.detail) details.append(text('p', `Record: ${row.detail}`));
  const facts = text('ul', '', 'event-log-facts');
  for (const fact of [...row.effects, ...row.receiptDetails]) facts.append(text('li', fact));
  details.append(facts, text('p', `Round ${row.round} · Event ${row.id}`, 'event-log-record-id'));
  content.append(details); item.append(marker, content); parent.append(item);
}

export function renderEventLog(host: HTMLElement, events: readonly GameEvent[], options: EventLogOptions): void {
  host.className = 'semantic-event-log';
  host.setAttribute('aria-label', 'Recorded decisions and changes; routine seasons grouped below');
  host.replaceChildren();
  const rows = eventLogEntries(events, options);
  if (!rows.length) { host.append(text('li', 'No recorded events in this view.', 'event-log-empty')); return; }
  const important = rows.filter(row => !row.routine);
  const routine = rows.filter(row => row.routine);

  for (const row of important) appendEventRow(host, row);
  if (routine.length) {
    const wrapper = text('li', '', 'event-log-routine');
    const group = text('details', '', 'event-log-season-group');
    if (!important.length) group.setAttribute('open', '');
    group.append(text('summary', `Routine seasons & calendar · ${routine.length} ${routine.length === 1 ? 'record' : 'records'}`));
    const list = text('ol', '', 'event-log-routine-list');
    for (const row of routine) appendEventRow(list, row);
    group.append(list); wrapper.append(group); host.append(wrapper);
  }
}
