import { BUILDINGS, IMPROVEMENTS, WONDERS } from '../core/content.ts';
import type { City, GameEvent, WorldState } from '../core/types.ts';
import type { SpectatorDestination, SpectatorStory } from './spectator-hud.ts';
import { wonderWorkId } from '../visuals/wonder-visuals.ts';
import { railWorkRows } from './settlement-inspection.ts';
import { visualIcon } from './world-cues.ts';

export type ChronicleDestination = SpectatorDestination | {
  kind: 'site'; id: string; cityId: string; tileId: number; workId: string | null; label: string;
};

export interface ChronicleStory extends Omit<SpectatorStory, 'destination'> {
  destination: ChronicleDestination | null;
  summary: string;
}

type ChronicleWorld = Pick<WorldState, 'cities' | 'events'> & Partial<Pick<WorldState, 'wonders' | 'railEdges'>>;

function site(city: City, tileId: number, workId: string | null, name: string): ChronicleDestination {
  return { kind: 'site', id: `${city.id}/${tileId}`, cityId: city.id, tileId, workId, label: `${name} · ${city.name}` };
}

export function chronicleEventDestination(state: ChronicleWorld, event: GameEvent, fallback: SpectatorDestination | null): ChronicleDestination | null {
  const ownsEvent = (city: City): boolean => event.actor === city.civId && (event.target === null || event.target === city.civId);
  for (const city of state.cities.filter(ownsEvent)) {
    const active = city.construction?.active;
    const building = active && 'buildingId' in active ? BUILDINGS.find(item => item.id === active.buildingId) : undefined;
    const activeTileId = active?.tileId ?? (building && !building.district ? city.tileId : undefined);
    if (event.type === 'construction-started' && active?.id === event.detail && active.cityId === city.id && active.startedRound === event.round
      && activeTileId !== undefined && activeTileId === event.tileId) {
      const name = 'buildingId' in active ? building?.name
        : active.kind === 'improvement' ? IMPROVEMENTS.find(item => item.id === active.improvementId)?.name
          : active.kind === 'wonder' ? WONDERS.find(item => item.id === active.wonderId)?.name : 'Railway';
      const workId = 'buildingId' in active || active.kind === 'improvement' ? `active:${active.id}`
        : active.kind === 'wonder' ? name ? wonderWorkId(active.wonderId, active.id) : null
          : railWorkRows(city).find(row => 'id' in row.record && row.record.id === active.id)?.key ?? null;
      return site(city, activeTileId, workId, name ?? 'Construction');
    }
    const completion = city.construction?.lastCompleted;
    if (event.type === 'building-completed' && completion && 'buildingId' in completion && completion.eventId === event.id
      && completion.cityId === city.id && completion.completedRound === event.round && (completion.tileId ?? city.tileId) === event.tileId
      && city.buildings.includes(completion.buildingId)) {
      return site(city, completion.tileId ?? city.tileId, completion.buildingId, BUILDINGS.find(item => item.id === completion.buildingId)?.name ?? 'Building');
    }
    const improvement = Object.values(city.improvements ?? {}).find(item => event.type === 'improvement-completed'
      && item.tileId === event.tileId && item.completion.eventId === event.id && item.completion.completedRound === event.round
      && item.completion.cityId === city.id && item.completion.improvementId === item.improvementId
      && event.detail === `${city.id}/${item.tileId}/${item.improvementId}`);
    if (improvement) return site(city, improvement.tileId, String(improvement.tileId), IMPROVEMENTS.find(item => item.id === improvement.improvementId)?.name ?? 'Worked land');
    const wonder = event.type === 'wonder-completed' ? event.wonderCompletion : undefined;
    if (wonder?.eventId === event.id && wonder.cityId === city.id && wonder.civId === city.civId && wonder.tileId === event.tileId && wonder.completedRound === event.round) {
      const retained = state.wonders?.[wonder.wonderId]?.completion;
      const workId = retained?.eventId === wonder.eventId && retained.orderId === wonder.orderId && retained.cityId === city.id
        && retained.civId === city.civId && retained.tileId === wonder.tileId && retained.completedRound === event.round
        ? wonderWorkId(wonder.wonderId, wonder.orderId) : null;
      return site(city, wonder.tileId, workId, WONDERS.find(item => item.id === wonder.wonderId)?.name ?? 'Wonder');
    }
    const rail = event.type === 'rail-completed' ? event.railCompletion : undefined;
    const retainedRail = rail ? state.railEdges?.[rail.edgeId] : undefined;
    if (rail?.eventId === event.id && rail.cityId === city.id && rail.civId === city.civId && rail.completedRound === event.round
      && rail.tileId === event.tileId && rail.edgeId === event.detail && retainedRail?.eventId === event.id
      && retainedRail.cityId === city.id && retainedRail.civId === city.civId && retainedRail.orderId === rail.orderId
      && retainedRail.edgeId === rail.edgeId && retainedRail.tileId === rail.tileId && retainedRail.toTileId === rail.toTileId && retainedRail.completedRound === event.round) {
      const workId = railWorkRows(city, { cityId: city.id, active: null, completed: [retainedRail], available: [], blocker: null })[0]?.key;
      if (workId) return site(city, rail.tileId, workId, 'Railway');
    }
  }
  return fallback;
}

export function chronicleSummary(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || text === 'The recorded details are in Events → Details.') return '';
  const first = text.split(/(?<=[.!?])\s+(?=[A-Z])/u)[0] ?? text;
  if (first.length <= 140) return first;
  const end = first.slice(0, 137).lastIndexOf(' ');
  return `${first.slice(0, end > 90 ? end : 137).trimEnd()}…`;
}

export function presentChronicleStories(state: ChronicleWorld, stories: readonly SpectatorStory[]): ChronicleStory[] {
  return stories.slice(0, 3).map(story => {
    const event = state.events.findLast(candidate => candidate.id === story.event.id && candidate.round === story.event.round);
    return { ...story, destination: event ? chronicleEventDestination(state, event, story.destination) : null, summary: chronicleSummary(story.display.consequence) };
  });
}

export function renderChronicle(host: HTMLElement, stories: readonly ChronicleStory[], navigate: (destination: ChronicleDestination) => void, sourceIdentity = ''): void {
  const focused = host.dataset['sourceIdentity'] === sourceIdentity && document.activeElement instanceof HTMLElement && host.contains(document.activeElement)
    ? document.activeElement.dataset['storyId'] : undefined;
  host.dataset['sourceIdentity'] = sourceIdentity;
  host.replaceChildren();
  for (const [index, story] of stories.slice(0, 3).entries()) {
    const { event, display, destination, summary } = story;
    const item = document.createElement('li'); item.className = index === 0 ? 'chronicle-current' : 'chronicle-recent';
    const row = document.createElement(destination ? 'button' : 'div');
    row.className = `chronicle-story chronicle-story--${index === 0 ? 'current' : 'recent'}`; row.dataset['storyId'] = event.id;
    if (row instanceof HTMLButtonElement && destination) {
      row.type = 'button';
      row.addEventListener('click', () => { if (host.dataset['sourceIdentity'] === sourceIdentity) navigate(destination); });
      row.setAttribute('aria-label', `${display.title}. Round ${event.round}.${index === 0 && summary ? ` ${summary}` : ''} ${destination.kind === 'civilization' ? 'Inspect current civilization' : 'Show current location on map'}: ${destination.label}`);
    }
    const marker = document.createElement('span'); marker.className = 'chronicle-marker'; marker.append(visualIcon(event.icon));
    const body = document.createElement('span'); body.className = 'chronicle-story-body';
    const meta = document.createElement('span'); meta.className = 'chronicle-story-meta'; meta.textContent = `${index === 0 ? 'Latest · ' : ''}Round ${event.round}`;
    const title = document.createElement('strong'); title.textContent = display.title;
    body.append(meta, title);
    if (index === 0 && summary) { const result = document.createElement('span'); result.className = 'chronicle-result'; result.textContent = summary; body.append(result); }
    if (index === 0 && destination) {
      const location = document.createElement('span'); location.className = 'chronicle-location'; location.textContent = `View now: ${destination.label}`;
      location.append(visualIcon('inspect')); body.append(location);
    }
    row.append(marker, body); item.append(row); host.append(item);
    if (focused === event.id) row.focus({ preventScroll: true });
  }
}
