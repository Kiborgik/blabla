import { BUILDINGS, CIVICS, GOVERNMENTS, IMPROVEMENTS, TECHNOLOGIES, WONDERS } from '../core/content.ts';
import type { City, GameAction, GameEvent, WorldState } from '../core/types.ts';
import type { CapabilityProjection } from '../core/capabilities.ts';
import { eventLogEntries, type EventLogEntry } from './event-log.ts';
import { exactNumber } from './number-format.ts';
import { visualIcon } from './world-cues.ts';

export type SpectatorDestination =
  | { kind: 'city'; id: string; label: string }
  | { kind: 'route'; id: string; label: string }
  | { kind: 'civilization'; id: number; label: string };

export interface SpectatorStory {
  event: EventLogEntry;
  destination: SpectatorDestination | null;
}

export function spectatorEventDestination(state: Pick<WorldState, 'cities' | 'routes' | 'civilizations'>, event: GameEvent): SpectatorDestination | null {
  const routeId = event.publicProjectResult?.routeId ?? event.strategicShipment?.routeId ?? (event.steamDelivery?.eventId === event.id ? event.steamDelivery.routeId : undefined)
    ?? (event.type.startsWith('trade-') ? event.detail : undefined);
  const route = state.routes.find(candidate => candidate.id === routeId);
  if (route) {
    const from = state.cities.find(city => city.id === route.from);
    const to = state.cities.find(city => city.id === route.to);
    return { kind: 'route', id: route.id, label: from && to ? `${from.name} ↔ ${to.name}` : 'Trade route' };
  }
  const cityId = [event.populationGrowth, event.wonderCompletion, event.wonderLoss, event.railCompletion, event.territoryAcquisition, event.localPower, event.industrialFoundry]
    .find(receipt => receipt?.eventId === event.id)?.cityId;
  const city = state.cities.find(candidate => cityId ? candidate.id === cityId : event.tileId !== null && candidate.tileId === event.tileId);
  if (city) return { kind: 'city', id: city.id, label: city.name };
  const civilization = state.civilizations.find(candidate => candidate.id === (event.target ?? event.actor));
  return civilization ? { kind: 'civilization', id: civilization.id, label: civilization.name } : null;
}

export function spectatorChronicle(state: Pick<WorldState, 'events' | 'cities' | 'routes' | 'civilizations'>): SpectatorStory[] {
  const entries = eventLogEntries(state.events, { civilizations: state.civilizations });
  return entries.filter(entry => !entry.routine).slice(0, 3).flatMap(entry => {
    const source = state.events.findLast(event => event.id === entry.id);
    return source ? [{ event: entry, destination: spectatorEventDestination(state, source) }] : [];
  });
}

export function civilizationSummary(state: Pick<WorldState, 'cities'>, id: number): string {
  const cities = state.cities.filter(city => city.civId === id);
  const population = cities.reduce((sum, city) => sum + city.population, 0);
  return `${cities.length} ${cities.length === 1 ? 'town' : 'towns'} · ${population.toLocaleString('en-US')} people`;
}

export function constructionCommitment(city: Pick<City, 'construction'> | undefined): { name: string; done: number; required: number } | null {
  const order = city?.construction?.active;
  if (!order) return null;
  const name = 'buildingId' in order ? BUILDINGS.find(item => item.id === order.buildingId)?.name ?? 'Recorded building'
    : order.kind === 'improvement' ? IMPROVEMENTS.find(item => item.id === order.improvementId)?.name ?? 'Recorded land improvement'
      : order.kind === 'wonder' ? WONDERS.find(item => item.id === order.wonderId)?.name ?? 'Recorded wonder'
        : 'Railway';
  return { name, done: order.workDone, required: order.workRequired };
}

export interface OngoingCommitment {
  kind: 'research' | 'civic' | 'construction' | 'government';
  name: string;
  amount: string;
  detail: string;
  progress: { done: number; required: number } | null;
}

export function ongoingCommitments(projection: CapabilityProjection, city?: Pick<City, 'id' | 'civId' | 'construction'>): OngoingCommitment[] {
  const result: OngoingCommitment[] = [];
  const research = projection.decisions?.research;
  if (research?.status === 'active' && research.targetId && research.progress) {
    result.push({ kind: 'research', name: TECHNOLOGIES.find(item => item.id === research.targetId)?.name ?? 'Recorded research',
      amount: `${exactNumber(research.progress.done)} / ${exactNumber(research.progress.required)} Science work`,
      detail: 'Funded by produced Science, not the stored Science inventory.', progress: { ...research.progress } });
  }
  const civic = projection.governance?.civics?.active;
  if (civic) result.push({ kind: 'civic', name: CIVICS.find(item => item.id === civic.civicId)?.name ?? 'Recorded civic',
    amount: `${exactNumber(civic.progress)} / ${exactNumber(civic.requiredCulture)} Culture work`,
    detail: 'Funded by produced Culture, not the stored Culture inventory.', progress: { done: civic.progress, required: civic.requiredCulture } });
  const construction = city?.id === projection.cityId && city.civId === projection.civilizationId ? constructionCommitment(city) : null;
  if (construction) result.push({ kind: 'construction', name: construction.name,
    amount: `${exactNumber(construction.done)} / ${exactNumber(construction.required)} work`, detail: 'Not built yet.',
    progress: { done: construction.done, required: construction.required } });
  const pending = projection.governance?.government?.pending;
  if (pending) result.push({ kind: 'government', name: GOVERNMENTS.find(item => item.id === pending.targetGovernmentId)?.name ?? 'Recorded arrangement',
    amount: `Scheduled round ${pending.completionRound}`, detail: `Paid ${exactNumber(pending.paidCredits)} Credits. The current government still applies.`, progress: null });
  return result;
}

export function renderOngoingCommitments(commitments: readonly OngoingCommitment[]): HTMLElement | null {
  if (!commitments.length) return null;
  const section = document.createElement('section'); section.className = 'ongoing-commitments'; section.dataset['inspectionSection'] = 'overview';
  section.setAttribute('aria-label', 'Ongoing commitments');
  const labels = { research: 'Research', civic: 'Culture', construction: 'Construction', government: 'Government pending' };
  const icons = { research: 'science', civic: 'culture', construction: 'materials', government: 'legitimacy' } as const;
  for (const commitment of commitments) {
    const card = document.createElement('article'); card.className = 'ongoing-commitment'; card.dataset['commitment'] = commitment.kind;
    const label = document.createElement('span'); label.className = 'commitment-kind';
    const labelText = document.createElement('span'); labelText.textContent = labels[commitment.kind]; label.append(visualIcon(icons[commitment.kind]), labelText);
    const name = document.createElement('strong'); name.textContent = commitment.name;
    const amount = document.createElement('span'); amount.className = 'commitment-amount'; amount.textContent = commitment.amount;
    card.append(label, name);
    if (commitment.progress && commitment.progress.required > 0) {
      const meter = document.createElement('progress'); meter.className = 'research-meter commitment-meter'; meter.max = commitment.progress.required; meter.value = Math.max(0, commitment.progress.done);
      meter.setAttribute('aria-label', `${labels[commitment.kind]}: ${commitment.name}, ${commitment.amount}`); card.append(meter);
    }
    card.append(amount);
    if (commitment.kind === 'construction') {
      const detail = document.createElement('small'); detail.textContent = commitment.detail; card.append(detail);
    } else card.title = commitment.detail;
    section.append(card);
  }
  return section;
}

export function installedTownEvidence(city: Pick<City, 'buildings' | 'improvements'>): Array<{ name: string; tileId: number | null }> {
  return [
    ...city.buildings.map(id => ({ name: BUILDINGS.find(item => item.id === id)?.name ?? 'Recorded building', tileId: null })),
    ...Object.values(city.improvements ?? {}).map(site => ({ name: IMPROVEMENTS.find(item => item.id === site.improvementId)?.name ?? 'Recorded land improvement', tileId: site.tileId })),
  ];
}

export function renderRecordedPolicyChoice(choice: { action: GameAction; reason: string }): HTMLDetailsElement {
  const record = document.createElement('details');
  record.className = 'policy-choice town-receipt';
  record.dataset['inspectionSection'] = 'overview';
  record.dataset['townDisclosure'] = 'policy-choice';
  const summary = document.createElement('summary');
  summary.textContent = `Last choice: ${spectatorActionLabel(choice.action)}`;
  const label = document.createElement('span'); label.className = 'eyebrow'; label.textContent = 'BUILT-IN POLICY · LAST CHOICE';
  const reason = document.createElement('p'); reason.textContent = choice.reason;
  record.append(summary, label, reason);
  return record;
}

export function renderSpectatorChronicle(host: HTMLElement, stories: readonly SpectatorStory[], navigate: (destination: SpectatorDestination) => void): void {
  const focused = document.activeElement instanceof HTMLElement && host.contains(document.activeElement) ? document.activeElement.dataset['storyId'] : undefined;
  host.replaceChildren();
  for (const { event, destination } of stories) {
    const item = document.createElement('li');
    const row = document.createElement(destination ? 'button' : 'div');
    row.className = 'chronicle-story';
    row.dataset['storyId'] = event.id;
    if (row instanceof HTMLButtonElement && destination) {
      row.type = 'button';
      row.addEventListener('click', () => navigate(destination));
      row.setAttribute('aria-label', `${event.title}. Round ${event.round}. ${destination.kind === 'civilization' ? 'Inspect civilization' : 'Show on map'}: ${destination.label}`);
    }
    const marker = document.createElement('span'); marker.className = 'chronicle-marker'; marker.append(visualIcon(event.icon));
    const body = document.createElement('span'); body.className = 'chronicle-story-body';
    const meta = document.createElement('span'); meta.className = 'chronicle-story-meta'; meta.textContent = `Round ${event.round} · ${event.category}`;
    const title = document.createElement('strong'); title.textContent = event.title;
    const location = document.createElement('span'); location.className = 'chronicle-location';
    location.textContent = destination ? `${destination.kind === 'civilization' ? 'View civilization' : 'On the map'} · ${destination.label}` : 'World event';
    if (destination) location.append(visualIcon('inspect'));
    body.append(meta, title, location); row.append(marker, body); item.append(row); host.append(item);
    if (focused === event.id) row.focus({ preventScroll: true });
  }
}

export function spectatorActionLabel(action: GameAction): string {
  const name = (id: string): string => [...BUILDINGS, ...CIVICS, ...GOVERNMENTS, ...IMPROVEMENTS, ...TECHNOLOGIES, ...WONDERS].find(item => item.id === id)?.name ?? id;
  switch (action.type) {
    case 'research': return `Research · ${name(action.technology)}`;
    case 'choose-civic': return `Develop civic · ${name(action.civicId)}`;
    case 'adopt-government': return `Government · ${name(action.governmentId)}`;
    case 'build': return `Construction · ${name(action.project)}`;
    case 'build-wonder': return `Wonder · ${name(action.wonderId)}`;
    case 'improve': return `Worked land · ${name(action.improvementId)}`;
    case 'focus': return `Town focus · ${action.focus}`;
    case 'settle': return 'Found a new town';
    case 'settle-coast': return 'Found a coastal town';
    case 'acquire-tile': return 'Expand town territory';
    case 'build-rail': return 'Build a railway';
    case 'apply-research-boost': return `Research boost · ${name(action.technology)}`;
    default: return action.type.replaceAll('-', ' ').replace(/^./, letter => letter.toUpperCase());
  }
}
