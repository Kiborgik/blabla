import { numberPresentation } from './number-format.ts';
import { projectRouteCues } from '../visuals/route-cues.ts';
import { routeLabelPlacement } from '../visuals/route-visuals.ts';
import { createEventCueTracker, eventVisual } from '../visuals/event-visuals.ts';
import { RESOURCE_IDS } from '../core/content.ts';
import type { GameEvent, Resources } from '../core/types.ts';
import { METRIC_LABELS } from '../visuals/visual-language.ts';
import type { RouteCueCursor, RouteCueObservation, RouteResultCue } from '../visuals/route-cues.ts';
import { hexPosition } from './atlas.ts';
import type { AtlasCue, AtlasWorld } from './atlas.ts';
import { ICON_PATHS } from '../visuals/world-visuals.ts';
import type { VisualDelta, VisualEvent, VisualIcon } from '../visuals/world-visuals.ts';

export function visualIcon(icon: VisualIcon): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'visual-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICON_PATHS[icon]);
  svg.append(path);
  return svg;
}

export function deltaNumber(delta: VisualDelta): string {
  return numberPresentation(delta.value, delta.kind === 'rate' ? 'rate' : delta.kind === 'delta' ? 'change' : 'stock').short;
}

export function renderDeltas(host: HTMLElement, deltas: readonly VisualDelta[]): void {
  host.replaceChildren();
  for (const delta of deltas) {
    const item = document.createElement('span');
    item.className = `visual-delta ${delta.tone}`;
    item.setAttribute('aria-label', `${delta.label}: ${numberPresentation(delta.value, delta.kind === 'rate' ? 'rate' : delta.kind === 'delta' ? 'change' : 'stock').exact} ${delta.qualifier}`);
    item.title = `${delta.subject ? `${delta.subject}: ` : ''}${delta.label} ${deltaNumber(delta)} ${delta.qualifier}`;
    const value = document.createElement('strong');
    value.textContent = deltaNumber(delta);
    const label = document.createElement('span');
    label.textContent = `${delta.label}${delta.icon === 'damage' && delta.kind === 'delta' ? ' points' : delta.kind === 'rate' ? ' base' : delta.kind === 'production' ? ' made' : delta.kind === 'payment' ? ' paid' : ''}`;
    item.append(visualIcon(delta.icon), value, label);
    host.append(item);
  }
}

export function eventAnchor(world: AtlasWorld, event: VisualEvent): { x: number; z: number; height: number; key: string } | null {
  if (event.cue === 'delivery') return null;
  const tile = world.tiles.find((candidate) => candidate.id === event.tileId);
  if (tile) return { ...hexPosition(tile.q, tile.r), height: tile.height, key: `tile:${tile.id}` };
  const city = world.cities.find((candidate) => candidate.id === (event.target ?? event.actor));
  return city ? { ...hexPosition(city.q, city.r), height: .6, key: `city:${city.cityId ?? city.id}` } : null;
}

export function createCueStream(): { observe: (observation: RouteCueObservation, slots: number) => { events: AtlasCue[]; routeResults: RouteResultCue[] } } {
  let cursor: RouteCueCursor | null = null;
  const ordinary = createEventCueTracker();
  return { observe: (observation, slots) => {
    const previous = cursor;
    const batch = projectRouteCues(cursor, observation, 3);
    cursor = batch.cursor;
    if (observation.mode === 'history' || (previous?.identity === observation.identity && observation.revision <= previous.revision)) return { events: [], routeResults: [] };
    const events = ordinary.observe(observation.identity, observation.events.filter((event) => !event.type.startsWith('trade-')));
    if (observation.mode !== 'live' || previous?.resumeBaseline) return { events: [], routeResults: [] };
    const order = new Map(observation.events.map((event, index) => [event.id, { importance: event.importance, index }]));
    const limit = Number.isFinite(slots) ? Math.min(3, Math.max(0, Math.floor(slots))) : 0;
    return { events: [...events, ...batch.cues].toSorted((a, b) => (order.get(b.eventId)?.importance ?? 0) - (order.get(a.eventId)?.importance ?? 0)
      || (order.get(b.eventId)?.index ?? 0) - (order.get(a.eventId)?.index ?? 0)).slice(0, limit), routeResults: batch.cues };
  } };
}

function amounts(vector: Partial<Resources>): string {
  return RESOURCE_IDS.filter((resource) => (vector[resource] ?? 0) > 0)
    .map((resource) => `${(vector[resource] ?? 0).toLocaleString('en-US', { maximumFractionDigits: 20 })} ${METRIC_LABELS[resource]}`).join(', ') || 'None';
}

export function routeResultPresentation(cue: RouteResultCue): { icon: VisualIcon; label: string; summary: string; deltas: VisualDelta[]; details: string[] } {
  const towns = cue.mapAnchor ? `${cue.mapAnchor.from.name} ↔ ${cue.mapAnchor.to.name}`
    : cue.endpoints ? `${cue.endpoints.fromCityId} ↔ ${cue.endpoints.toCityId}` : cue.routeId;
  const name = (seat: number): string => cue.mapAnchor && cue.endpoints
    ? seat === cue.endpoints.owner ? cue.mapAnchor.from.civilization : cue.mapAnchor.to.civilization : `Civilization ${seat}`;
  const summary = `${towns} · Round ${cue.round}`;
  const details = [`Route ${cue.routeId} · Agreement ${cue.agreementOfferId ?? 'unavailable'}`];
  const deltas: VisualDelta[] = [];
  if (!cue.mapAnchor) details.push('Exact endpoint position unavailable.');
  if (cue.kind === 'delivery') {
    details.push(`Recorded cargo: ${cue.aggregateCargo ?? 'unavailable'}`);
    if (cue.aggregateCargo !== null) deltas.push({ icon: 'cargo', label: 'Cargo', value: cue.aggregateCargo, kind: 'total', tone: 'neutral', qualifier: 'delivered in this recorded exchange', subject: null });
    if (cue.exchange) for (const [side, other] of [[cue.exchange.proposer, cue.exchange.recipient], [cue.exchange.recipient, cue.exchange.proposer]]) {
      if (!side || !other) continue;
      details.push(`Cargo sent · ${name(side.civilization)} → ${name(other.civilization)}: ${amounts(side.cargo)}`,
        `Transport paid · ${name(side.civilization)}: ${amounts(side.paidUpkeep)}`, `Commerce received · ${name(side.civilization)}: ${amounts(side.creditedCommerce)}`);
    } else details.push('Per-resource delivery receipt unavailable. Only the recorded aggregate is shown.');
    return { icon: 'cargo', label: cue.label, summary, deltas, details };
  }
  const result = cue.result;
  if (cue.damageReduction !== null) deltas.push({ icon: 'damage', label: 'Damage', value: -cue.damageReduction, kind: 'delta', tone: cue.damageReduction > 0 ? 'positive' : 'neutral', qualifier: 'points repaired in this recorded result', subject: null });
  details.push(`Recorded damage: ${result.damageBefore ?? 'unavailable'}${result.damageBefore === null ? '' : '%'} → ${result.damageAfter ?? 'unavailable'}${result.damageAfter === null ? '' : '%'}`,
    `Damage when observed: ${cue.currentDamage === null ? 'unavailable' : `${cue.currentDamage}%`}`, `Paid · ${name(result.proposer)}: ${amounts(result.proposerPaid)}`,
    `Paid · ${name(result.recipient)}: ${amounts(result.recipientPaid)}`, result.reason, 'This repair result does not create a shipment.');
  return { icon: result.outcome === 'completed' ? 'repair' : 'damage', label: cue.label, summary, deltas, details };
}

export function latestCueEvent(events: readonly GameEvent[]): GameEvent | undefined {
  return events.findLast((event) => eventVisual(event) !== null || event.publicProjectResult !== undefined) ?? events.at(-1);
}

type MapAnchor = NonNullable<ReturnType<typeof eventAnchor>>;

export function createWorldCues(container: HTMLElement, world: AtlasWorld, project: (x: number, z: number, height: number) => { x: number; y: number }): {
  show: (events: readonly AtlasCue[]) => void; update: () => void; clear: () => void; setMotion: (moving: boolean) => void; dispose: () => void;
} {
  const layer = document.createElement('div');
  layer.className = 'world-cues';
  layer.setAttribute('aria-live', 'polite');
  layer.setAttribute('aria-label', 'Changes on the map');
  container.append(layer);
  type Cue = { element: HTMLElement; eventId: string; anchor: MapAnchor; marks: Array<{ element: HTMLElement; anchor: MapAnchor }>; route: boolean; timer: ReturnType<typeof setTimeout> };
  const cues: Cue[] = [];
  const remove = (cue: Cue): void => { clearTimeout(cue.timer); cue.element.remove(); for (const mark of cue.marks) mark.element.remove(); const index = cues.indexOf(cue); if (index >= 0) cues.splice(index, 1); };
  const clear = (): void => { while (cues.length) { const cue = cues[0]; if (cue) remove(cue); } };
  const update = (): void => {
    const limit = container.clientWidth < 700 ? 1 : 3;
    while (cues.length > limit) { const first = cues[0]; if (first) remove(first); }
    const bounds = container.getBoundingClientRect();
    const occupied = cues.some((cue) => cue.route) ? [...document.querySelectorAll<HTMLElement>('.panel, .world-heading, .era-pill, .map-tools, .layer-controls, .connection-actions, .map-hint, .city-label, .flat-city, .route-map-label, .flat-route-label')]
      .map((node) => node.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({ x: rect.left - bounds.left + rect.width / 2, y: rect.top - bounds.top, width: rect.width, height: rect.height })) : [];
    for (const cue of cues) {
      const point = project(cue.anchor.x, cue.anchor.z, cue.anchor.height);
      const outside = point.x < 0 || point.x > container.clientWidth || point.y < 0 || point.y > container.clientHeight;
      if (cue.route) {
        const placement = outside ? null : routeLabelPlacement({ x: point.x, y: point.y - 58 }, occupied, container.clientWidth, container.clientHeight);
        cue.element.hidden = placement === null;
        if (placement) { cue.element.style.left = `${placement.x}px`; cue.element.style.top = `${placement.y}px`; occupied.push(placement); }
      } else {
        cue.element.hidden = outside;
        cue.element.style.left = `${Math.max(86, Math.min(container.clientWidth - 86, point.x))}px`;
        cue.element.style.top = `${Math.max(24, point.y - 38)}px`;
      }
      for (const mark of cue.marks) {
        const endpoint = project(mark.anchor.x, mark.anchor.z, mark.anchor.height);
        mark.element.hidden = endpoint.x < 20 || endpoint.x > container.clientWidth - 40 || endpoint.y < 20 || endpoint.y > container.clientHeight - 20;
        mark.element.style.left = `${endpoint.x + 20}px`;
        mark.element.style.top = `${endpoint.y - 20}px`;
      }
    }
  };
  return {
    show: (events) => {
      const added = new Set<string>();
      const limit = container.clientWidth < 700 ? 1 : 3;
      for (const event of events.slice(0, limit)) {
        const route = 'kind' in event ? event : null;
        const endpoints = route?.mapAnchor && route.accent !== 'none' ? [route.mapAnchor.from, route.mapAnchor.to] : [];
        const anchors = endpoints.map((town) => ({ ...hexPosition(town.q, town.r), height: .8, key: `route:${route?.routeId}`, town }));
        const anchor = 'kind' in event ? anchors[1] : eventAnchor(world, event);
        if (!anchor || added.has(anchor.key) || cues.some((cue) => cue.eventId === event.eventId)) continue;
        added.add(anchor.key);
        for (const old of cues.filter((cue) => cue.anchor.key === anchor.key)) remove(old);
        while (cues.length >= limit) { const first = cues[0]; if (first) remove(first); }
        const element = document.createElement('div');
        element.dataset['event'] = event.eventId;
        const card = document.createElement('div'); card.className = 'cue-card';
        const title = document.createElement('strong'); title.className = 'cue-title';
        const marks: Cue['marks'] = [];
        if (route) {
          const presentation = routeResultPresentation(route);
          element.className = 'world-cue route-result-card';
          element.dataset['routeId'] = route.routeId;
          element.setAttribute('aria-label', `${presentation.label}. ${presentation.summary}`);
          const quantity = presentation.deltas[0];
          const caption = quantity ? route.kind === 'delivery' ? `${deltaNumber(quantity)} cargo delivered` : `Repaired ${Math.abs(quantity.value)} points` : presentation.label;
          title.append(visualIcon(presentation.icon), document.createTextNode(caption));
          const round = document.createElement('span'); round.className = 'route-result-round'; round.textContent = `Round ${route.round}`;
          card.append(title, round);
          for (const endpoint of anchors) {
            const mark = document.createElement('span'); mark.className = 'route-result-mark';
            mark.dataset['cityId'] = endpoint.town.id; mark.setAttribute('aria-hidden', 'true');
            mark.style['borderColor'] = endpoint.town.color; mark.append(visualIcon(presentation.icon)); layer.append(mark);
            marks.push({ element: mark, anchor: endpoint });
          }
        } else if (!('kind' in event)) {
          element.className = `world-cue ${event.cue}`;
          title.append(visualIcon(event.icon), document.createTextNode(event.label));
          const deltas = document.createElement('div'); deltas.className = 'cue-deltas'; renderDeltas(deltas, event.deltas.slice(0, 3));
          card.append(title, deltas);
        }
        element.append(card); layer.append(element);
        const duration = 'kind' in event ? 2600 : event.durationMs;
        const cue: Cue = { element, eventId: event.eventId, anchor, marks, route: route !== null, timer: setTimeout(() => remove(cue), duration) };
        cues.push(cue);
      }
      update();
    },
    update, clear,
    setMotion: (moving) => { layer.classList.toggle('still', !moving); },
    dispose: () => { clear(); layer.remove(); },
  };
}
