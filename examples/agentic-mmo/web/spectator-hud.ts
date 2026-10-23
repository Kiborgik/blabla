import { knowledgeRouteMatches } from './knowledge-inspection.ts';
import { validKnowledgeEvent } from '../core/knowledge-validation.ts';
import { BUILDINGS, CIVICS, GOVERNMENTS, IMPROVEMENTS, TECHNOLOGIES, WONDERS } from '../core/content.ts';
import { BEHAVIOR_PROFILES } from '../core/behavior-profiles.ts';
import { STRATEGIC_ARCHETYPES, STRATEGIC_TEMPERAMENT_VERSION } from '../core/strategic-temperaments.ts';
import type { City, GameAction, GameEvent, WorldState } from '../core/types.ts';
import type { CapabilityProjection } from '../core/capabilities.ts';
import { eventLogEntries, recordedPublicProjectResult, type EventLogEntry } from './event-log.ts';
import { exactNumber } from './number-format.ts';
import { storyLanguage, type StoryLanguage } from './story-language.ts';
import { visualIcon } from './world-cues.ts';

export type SpectatorDestination =
  | { kind: 'city'; id: string; label: string }
  | { kind: 'route'; id: string; label: string }
  | { kind: 'civilization'; id: number; label: string };

export interface SpectatorStory {
  event: EventLogEntry;
  display: StoryLanguage;
  destination: SpectatorDestination | null;
}

type StoryWorld = Pick<WorldState, 'cities' | 'routes' | 'civilizations'> & Partial<Pick<WorldState, 'publicProjects' | 'events'>>;

export function spectatorEventDestination(state: StoryWorld, event: GameEvent): SpectatorDestination | null {
  const terms = validKnowledgeEvent(event) ? event.knowledgeCompact?.terms ?? event.knowledgeResult?.compact.terms : undefined;
  if (terms) {
    const route = state.routes.find(candidate => knowledgeRouteMatches(state, candidate, terms));
    if (route) return { kind: 'route', id: route.id, label: `${terms.names.teacherCity} ↔ ${terms.names.learnerCity}` };
    const civilization = state.civilizations.find(candidate => candidate.id === terms.learnerId);
    return civilization ? { kind: 'civilization', id: civilization.id, label: civilization.name } : null;
  }
  const study = validKnowledgeEvent(event) ? event.knowledgeStudy?.attempt.delivery : undefined;
  if (study) {
    const route = state.routes.find(candidate => knowledgeRouteMatches(state, candidate, study));
    if (route) return { kind: 'route', id: route.id, label: 'Recorded study route' };
  }
  const partnership = event.type.startsWith('public-project-');
  const trade = event.type.startsWith('trade-') && event.type !== 'trade-fair';
  const participantsMatch = (candidate: { proposer: number; recipient: number }): boolean => (event.actor === candidate.proposer && event.target === candidate.recipient) || (event.actor === candidate.recipient && event.target === candidate.proposer);
  const project = partnership ? state.publicProjects?.find(candidate => candidate.id === event.detail && participantsMatch(candidate)) : undefined;
  const directResult = recordedPublicProjectResult(event);
  const result = directResult ?? (partnership ? state.events?.map(recordedPublicProjectResult).findLast(candidate => candidate?.projectId === event.detail && participantsMatch(candidate)) : null);
  const binding = directResult ?? project ?? result;
  const routeId = partnership ? binding?.routeId : event.strategicShipment?.routeId ?? (event.steamDelivery?.eventId === event.id ? event.steamDelivery.routeId : undefined)
    ?? (trade ? event.detail : undefined);
  const route = state.routes.find(candidate => candidate.id === routeId && (!partnership || binding
    && candidate.agreement?.offerId === binding.agreementOfferId
    && ((candidate.owner === binding.proposer && candidate.partner === binding.recipient) || (candidate.owner === binding.recipient && candidate.partner === binding.proposer))));
  if (route) {
    const from = state.cities.find(city => city.id === route.from);
    const to = state.cities.find(city => city.id === route.to);
    return { kind: 'route', id: route.id, label: from && to ? `${from.name} ↔ ${to.name}` : 'Trade route' };
  }
  if (!partnership && !trade) {
    const cityId = [event.populationGrowth, event.wonderCompletion, event.wonderLoss, event.railCompletion, event.territoryAcquisition, event.localPower, event.industrialFoundry]
      .find(receipt => receipt?.eventId === event.id)?.cityId;
    const city = state.cities.find(candidate => cityId ? candidate.id === cityId : event.tileId !== null && candidate.tileId === event.tileId);
    if (city) return { kind: 'city', id: city.id, label: city.name };
  }
  const civilization = state.civilizations.find(candidate => candidate.id === (event.target ?? event.actor));
  return civilization ? { kind: 'civilization', id: civilization.id, label: civilization.name } : null;
}

export function spectatorChronicle(state: StoryWorld & Pick<WorldState, 'events'>): SpectatorStory[] {
  const candidates = eventLogEntries(state.events, { civilizations: state.civilizations }).filter(entry => !entry.routine).flatMap(entry => {
    const source = state.events.findLast(event => event.id === entry.id);
    return source ? [{ event: entry, source, destination: spectatorEventDestination(state, source) }] : [];
  });
  const chosen = new Set<number>();
  const families = new Set<string>();
  const participants = new Set<number>();
  while (chosen.size < Math.min(3, candidates.length)) {
    let best = -1; let score = -1;
    for (const [index, candidate] of candidates.entries()) {
      if (chosen.has(index)) continue;
      const novelty = (families.has(candidate.event.family) ? 0 : 2)
        + Number([candidate.source.actor, candidate.source.target].some(id => id !== null && !participants.has(id)));
      if (best < 0 || chosen.size > 0 && novelty > score) { best = index; score = novelty; }
      if (chosen.size === 0) break;
    }
    const candidate = candidates[best];
    if (!candidate) break;
    chosen.add(best); families.add(candidate.event.family);
    for (const id of [candidate.source.actor, candidate.source.target]) if (id !== null) participants.add(id);
  }
  return candidates.filter((_candidate, index) => chosen.has(index)).map(({ event, source, destination }) => ({ event, display: storyLanguage(state, source, event), destination }));
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

export interface DevelopingTown {
  cityId: string;
  orderId: string;
  civilizationId: number;
  town: string;
  civilization: string;
  name: string;
  done: number;
  required: number;
  amount: string;
  status: string;
}

export function developingTowns(state: Pick<WorldState, 'cities' | 'civilizations' | 'outcome'>, options: { archived?: boolean } = {}): DevelopingTown[] {
  return state.cities.flatMap(city => {
    const order = city.construction?.active;
    const commitment = constructionCommitment(city);
    if (!order || order.cityId !== city.id || !commitment) return [];
    return [{ cityId: city.id, orderId: order.id, civilizationId: city.civId, town: city.name,
      civilization: state.civilizations.find(civ => civ.id === city.civId)?.name ?? `Civilization ${city.civId}`,
      ...commitment, amount: `${exactNumber(commitment.done)} / ${exactNumber(commitment.required)} work`,
      status: options.archived || state.outcome ? 'Recorded unfinished work' : 'Under construction · not built yet' }];
  });
}

export function renderDevelopingTowns(host: HTMLElement, towns: readonly DevelopingTown[], selectCity: (cityId: string) => void, sourceIdentity = ''): void {
  const sameSource = host.dataset['sourceIdentity'] === sourceIdentity;
  const active = sameSource && document.activeElement instanceof HTMLElement && host.contains(document.activeElement) ? document.activeElement : null;
  const focused = active?.dataset['constructionIdentity'];
  const pagerFocus = active?.dataset['townPage'];
  const pages = Math.max(1, Math.ceil(towns.length / 4));
  const retainedPage = sameSource ? Number(host.dataset['townPage'] ?? 0) : 0;
  const focusedIndex = towns.findIndex(town => JSON.stringify([town.cityId, town.orderId]) === focused);
  const requestedPage = focusedIndex >= 0 ? Math.floor(focusedIndex / 4) : retainedPage;
  const page = Math.min(pages - 1, Math.max(0, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 0));
  host.dataset['sourceIdentity'] = sourceIdentity; host.dataset['townPage'] = String(page);
  host.setAttribute('aria-label', 'Developing towns');
  host.replaceChildren();
  for (const town of towns.slice(page * 4, page * 4 + 4)) {
    const item = document.createElement('li');
    const row = document.createElement('button'); row.type = 'button'; row.className = 'developing-town';
    row.dataset['cityId'] = town.cityId; row.dataset['orderId'] = town.orderId;
    row.dataset['constructionIdentity'] = JSON.stringify([town.cityId, town.orderId]);
    row.setAttribute('aria-label', `${town.town}, ${town.civilization}. ${town.name}: ${town.amount}. ${town.status}. Inspect town`);
    row.addEventListener('click', () => selectCity(town.cityId));
    const name = document.createElement('strong'); name.textContent = `${town.town} · ${town.civilization}`;
    const work = document.createElement('span'); work.textContent = `${town.name} · ${town.amount}`;
    const status = document.createElement('small'); status.textContent = town.status;
    row.append(visualIcon('materials'), name, work, status); item.append(row); host.append(item);
    if (focused === row.dataset['constructionIdentity']) row.focus({ preventScroll: true });
  }
  if (towns.length > 4) {
    const pager = document.createElement('li'); pager.className = 'developing-town-pager';
    const status = document.createElement('span'); status.className = 'developing-town-page-status'; status.setAttribute('role', 'status');
    status.textContent = `${page * 4 + 1}–${Math.min((page + 1) * 4, towns.length)} of ${towns.length} developing towns`;
    const control = (direction: 'previous' | 'next', label: string, nextPage: number): HTMLButtonElement => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset['townPage'] = direction;
      button.disabled = nextPage < 0 || nextPage >= pages;
      button.addEventListener('click', () => { host.dataset['townPage'] = String(nextPage); renderDevelopingTowns(host, towns, selectCity, sourceIdentity); });
      return button;
    };
    const previous = control('previous', 'Previous towns', page - 1); const next = control('next', 'Next towns', page + 1);
    pager.append(previous, status, next); host.append(pager);
    if (pagerFocus === 'previous') (previous.disabled ? next : previous).focus({ preventScroll: true });
    if (pagerFocus === 'next') (next.disabled ? previous : next).focus({ preventScroll: true });
  }
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

export function renderRecordedPolicyChoice(choice: { action: GameAction; reason: string; profileId?: string; phase?: string }): HTMLDetailsElement {
  const record = document.createElement('details');
  record.className = 'policy-choice town-receipt';
  record.dataset['inspectionSection'] = 'overview';
  record.dataset['townDisclosure'] = 'policy-choice';
  const summary = document.createElement('summary');
  summary.textContent = `Last choice: ${spectatorActionLabel(choice.action)}`;
  const label = document.createElement('span'); label.className = 'eyebrow'; label.textContent = 'BUILT-IN POLICY · LAST CHOICE';
  const reason = document.createElement('p'); reason.textContent = choice.reason;
  record.append(summary, label, reason);
  const parts = choice.profileId?.split('/') ?? [];
  const archetype = STRATEGIC_ARCHETYPES.find(value => value === parts[1]);
  const posture = ['compact', 'measured', 'outward'].find(value => value === parts[2]);
  const strategy = parts.length === 3 && parts[0] === STRATEGIC_TEMPERAMENT_VERSION && archetype && posture
    ? `${archetype[0]!.toUpperCase()}${archetype.slice(1)} · ${posture[0]!.toUpperCase()}${posture.slice(1)}`
    : BEHAVIOR_PROFILES.find(profile => profile.id === choice.profileId)?.name;
  if (strategy) {
    const identity = document.createElement('p'); identity.textContent = `Recorded strategy: ${strategy}`; record.append(identity);
    const phase = ['survival', 'recovery', 'development', 'expansion', 'trade', 'consolidation'].find(value => value === choice.phase);
    if (phase) {
      const stage = document.createElement('p'); stage.textContent = `Recorded phase: ${phase[0]!.toUpperCase()}${phase.slice(1)}`; record.append(stage);
    }
  }
  return record;
}

export function renderSpectatorChronicle(host: HTMLElement, stories: readonly SpectatorStory[], navigate: (destination: SpectatorDestination) => void, sourceIdentity = ''): void {
  const focused = host.dataset['sourceIdentity'] === sourceIdentity && document.activeElement instanceof HTMLElement && host.contains(document.activeElement) ? document.activeElement.dataset['storyId'] : undefined;
  host.dataset['sourceIdentity'] = sourceIdentity;
  host.replaceChildren();
  for (const { event, display, destination } of stories) {
    const item = document.createElement('li');
    const row = document.createElement(destination ? 'button' : 'div');
    row.className = 'chronicle-story';
    row.dataset['storyId'] = event.id;
    const { title: headline, cause: reason, consequence } = display;
    if (row instanceof HTMLButtonElement && destination) {
      row.type = 'button';
      row.addEventListener('click', () => navigate(destination));
      row.setAttribute('aria-label', `${headline}. Round ${event.round}.${consequence ? ` Result: ${consequence}.` : ''}${reason ? ` Why: ${reason}.` : ''} ${destination.kind === 'civilization' ? 'Inspect civilization' : 'Show on map'}: ${destination.label}`);
    }
    const marker = document.createElement('span'); marker.className = 'chronicle-marker'; marker.append(visualIcon(event.icon));
    const body = document.createElement('span'); body.className = 'chronicle-story-body';
    const meta = document.createElement('span'); meta.className = 'chronicle-story-meta'; meta.textContent = `Round ${event.round} · ${event.category}`;
    const title = document.createElement('strong'); title.textContent = headline;
    const location = document.createElement('span'); location.className = 'chronicle-location';
    location.textContent = destination ? `${destination.kind === 'civilization' ? 'View civilization' : 'On the map'} · ${destination.label}` : 'World event';
    if (destination) location.append(visualIcon('inspect'));
    body.append(meta, title);
    if (consequence) { const result = document.createElement('span'); result.className = 'chronicle-result'; result.textContent = `Result: ${consequence}`; body.append(result); }
    if (reason) { const cause = document.createElement('span'); cause.className = 'chronicle-cause'; cause.textContent = `Why: ${reason}`; body.append(cause); }
    body.append(location); row.append(marker, body); item.append(row); host.append(item);
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
