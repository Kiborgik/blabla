import type { BorderControlReceipt, BorderIncident, BorderParty, BorderResolution } from '../core/border-types.ts';
import type { GameEvent, TileAcquisitionReceipt, WorldState } from '../core/types.ts';
import { hexPosition } from './landscape.ts';
import { mapTileHeight } from './route-paths.ts';
import type { TerritoryPoint } from './territory-visuals.ts';
import type { DetailLevel, VisualEvent, VisualPart } from './world-visuals.ts';
import { VISUAL_PALETTE } from './world-visuals.ts';

export interface BorderIdentity { id: number; name: string; color: string }
export interface BorderPartyView {
  incidentId: string;
  party: BorderParty;
  identity: BorderIdentity;
  sourceCityId: string;
  sourceCityName: string | null;
  point: TerritoryPoint | null;
  active: boolean;
}
export interface BorderIncidentView {
  incident: BorderIncident;
  active: boolean;
  completedRound: number | null;
  target: TerritoryPoint | null;
  currentController: BorderIdentity | null;
  currentControllerKnown: boolean;
  currentControlReceipt: BorderControlReceipt | null;
  purchase: TileAcquisitionReceipt | null;
  purchaser: BorderIdentity | null;
  initiator: BorderIdentity;
  defender: BorderIdentity;
  parties: BorderPartyView[];
}
export interface BorderPartyMarker extends BorderPartyView {
  point: TerritoryPoint;
  displayOffset: { x: number; z: number };
}

export function projectBorderIncidents(state: WorldState): BorderIncidentView[] {
  const tiles = new Map(state.tiles.map(tile => [tile.id, tile]));
  const identity = (id: number): BorderIdentity => {
    const civ = state.civilizations.find(candidate => candidate.id === id);
    return { id, name: civ?.name ?? `Civilization ${id}`, color: civ?.color ?? VISUAL_PALETTE.neutral };
  };
  const point = (tileId: number): TerritoryPoint | null => {
    const tile = tiles.get(tileId);
    return tile && Number.isFinite(tile.q) && Number.isFinite(tile.r) && Number.isFinite(tile.elevation)
      ? { tileId, q: tile.q - (state.width - 1) / 2, r: tile.r - (state.height - 1) / 2, height: mapTileHeight(tile.elevation) } : null;
  };
  const rows = new Map<string, { incident: BorderIncident; active: boolean; completedRound: number | null }>();
  for (const result of state.border?.lastResults ?? []) rows.set(result.incident.id, { incident: result.incident, active: false, completedRound: result.completedRound });
  for (const incident of state.border?.active ?? []) rows.set(incident.id, { incident, active: true, completedRound: null });
  return [...rows.values()].toSorted((a, b) => Number(b.active) - Number(a.active) || b.incident.openedRound - a.incident.openedRound || a.incident.id.localeCompare(b.incident.id)).map(row => {
    const incident = structuredClone(row.incident);
    const tile = tiles.get(incident.tileId);
    const purchase = state.tileAcquisitions?.[String(incident.tileId)];
    const exactPurchase = purchase?.id === incident.purchaseId && purchase.tileId === incident.tileId ? purchase : null;
    const control = state.border?.controls[String(incident.tileId)];
    const exactControl = control?.tileId === incident.tileId && control.purchaseId === incident.purchaseId && control.civId === tile?.owner ? control : null;
    const parties = [incident.initiator, ...(incident.defender ? [incident.defender] : [])].map(party => {
      const town = state.cities.find(city => city.id === party.departure.sourceCityId && city.civId === party.departure.actorId);
      return { incidentId: incident.id, party, identity: identity(party.departure.actorId), sourceCityId: party.departure.sourceCityId,
        sourceCityName: town?.name ?? null, point: point(party.positionTileId), active: row.active };
    });
    return { incident, active: row.active, completedRound: row.completedRound, target: point(incident.tileId),
      currentController: tile && tile.owner !== null ? identity(tile.owner) : null, currentControllerKnown: !!tile,
      currentControlReceipt: exactControl ? structuredClone(exactControl) : null,
      purchase: exactPurchase ? structuredClone(exactPurchase) : null, purchaser: exactPurchase ? identity(exactPurchase.civId) : null,
      initiator: identity(incident.initiatorId), defender: identity(incident.defenderId), parties };
  });
}

export function projectBorderParties(views: readonly BorderIncidentView[]): BorderPartyMarker[] {
  const parties = views.filter(view => view.active).flatMap(view => view.parties).filter(view => view.active && view.point && Number.isInteger(view.party.people)
    && view.party.people > 0 && view.party.people <= 3 && view.party.phase !== 'returned' && view.party.returned === null)
    .toSorted((a, b) => a.party.positionTileId - b.party.positionTileId || a.incidentId.localeCompare(b.incidentId) || a.party.id.localeCompare(b.party.id));
  const occupants = new Map<number, BorderPartyView[]>();
  for (const party of parties) occupants.set(party.party.positionTileId, [...(occupants.get(party.party.positionTileId) ?? []), party]);
  return parties.flatMap(party => {
    if (!party.point) return [];
    const group = occupants.get(party.party.positionTileId)!;
    const index = group.indexOf(party);
    const angle = Math.PI * 2 * index / group.length;
    const radius = group.length > 1 ? .36 : 0;
    return [{ ...party, point: party.point, displayOffset: { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius } }];
  });
}

export function borderPartyAnchor(party: BorderPartyMarker): { x: number; z: number; height: number } {
  const point = hexPosition(party.point.q, party.point.r);
  return { x: point.x + party.displayOffset.x, z: point.z + party.displayOffset.z, height: party.point.height };
}

export function borderPartyBadgeOffsets(parties: readonly BorderPartyMarker[]): Map<string, { x: number; y: number }> {
  const occupants = new Map<number, BorderPartyMarker[]>();
  for (const party of parties) occupants.set(party.point.tileId, [...(occupants.get(party.point.tileId) ?? []), party]);
  const offsets = new Map<string, { x: number; y: number }>();
  for (const group of occupants.values()) {
    const peers = group.toSorted((a, b) => a.party.id.localeCompare(b.party.id));
    const radius = peers.length > 1 ? 12 / Math.sin(Math.PI / peers.length) : 0;
    for (const [index, party] of peers.entries()) {
      const angle = Math.PI * 2 * index / peers.length;
      offsets.set(party.party.id, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
    }
  }
  return offsets;
}

export function borderPartyLabel(view: BorderPartyView): string {
  const party = view.party;
  return `${view.identity.name} · ${party.people} ${party.people === 1 ? 'person' : 'people'} · Last recorded phase: ${party.phase} · Tile ${party.positionTileId}`;
}

export function borderPartyParts(view: BorderPartyView, detail: DetailLevel): VisualPart[] {
  const { party } = view;
  if (detail === 'far' || !view.active || party.returned || party.phase === 'returned' || !Number.isInteger(party.people) || party.people < 1 || party.people > 3) return [];
  const positions = party.people === 3 ? [[0, -.15], [-.16, .10], [.16, .10]] : party.people === 2 ? [[-.13, -.06], [.13, .06]] : [[0, 0]];
  const parts: VisualPart[] = [];
  const add = (id: string, shape: VisualPart['shape'], material: VisualPart['material'], position: VisualPart['position'], scale: VisualPart['scale']): void => {
    parts.push({ id: `${party.id}:${id}`, shape, material, position, scale, rotation: 0 });
  };
  for (const [index, position] of positions.entries()) {
    const [x = 0, z = 0] = position;
    add(`resident-${index}:tunic`, 'cone', 'identity', [x, .18, z], [.19, .27, .17]);
    add(`resident-${index}:head`, 'cylinder', 'neutral', [x, .35, z], [.11, .11, .11]);
    if (detail === 'close') add(`resident-${index}:feet`, 'box', 'timber', [x, .035, z], [.14, .06, .11]);
  }
  add('standard-pole', 'box', 'timber', [.25, .32, -.07], [.024, .64, .024]);
  add('standard-cloth', 'box', 'identity', [.34, .56, -.07], [.19, .13, .025]);
  return parts;
}

export function borderPartyWorldParts(parties: readonly BorderPartyMarker[], detail: DetailLevel): Array<{ part: VisualPart; color: string }> {
  return parties.flatMap(party => {
    const origin = borderPartyAnchor(party);
    return borderPartyParts(party, detail).map(part => ({ color: part.material === 'identity' ? party.identity.color : VISUAL_PALETTE[part.material],
      part: { ...part, position: [origin.x + part.position[0], origin.height + part.position[1], origin.z + part.position[2]] as const } }));
  });
}

export function borderTargetOutline(view: BorderIncidentView): Array<readonly [number, number, number]> {
  if (!view.active || view.incident.resolution || !view.target) return [];
  const center = hexPosition(view.target.q, view.target.r);
  return Array.from({ length: 7 }, (_, index) => {
    const angle = Math.PI / 3 * index + Math.PI / 6;
    return [center.x + Math.cos(angle) * .86, view.target!.height + .035, center.z + Math.sin(angle) * .86] as const;
  });
}

function resolutionKey(resolution: BorderResolution): string {
  const clash = resolution.clash; const control = resolution.control;
  return JSON.stringify([resolution.round, resolution.eventId, resolution.outcome, resolution.reason,
    clash && [clash.seedBefore, clash.seedAfter, clash.roll, clash.initiatorPower, clash.defenderPower, clash.winnerId, clash.casualtyCivId, clash.casualties],
    control && [control.ruleVersion, control.incidentId, control.purchaseId, control.tileId, control.previousCivId, control.previousCityId, control.civId, control.cityId, control.round, control.eventId]]);
}

export function borderClashCues(state: WorldState, events: readonly GameEvent[] = state.events): VisualEvent[] {
  const views = new Map(projectBorderIncidents(state).map(view => [view.incident.id, view]));
  const seen = new Set<string>();
  return events.flatMap(event => {
    const payload = event.border;
    if (event.type !== 'border-resolution' || payload?.kind !== 'resolution') return [];
    const view = views.get(payload.incidentId); const resolution = view?.incident.resolution; const clash = resolution?.clash;
    if (!view?.target || !resolution || !clash || clash.casualties !== 1 || seen.has(event.id) || event.id !== resolution.eventId
      || event.round !== resolution.round || event.tileId !== view.incident.tileId || event.actor !== view.incident.initiatorId || event.target !== view.incident.defenderId
      || resolutionKey(payload.resolution) !== resolutionKey(resolution)) return [];
    seen.add(event.id);
    const lost = [view.initiator, view.defender].find(identity => identity.id === clash.casualtyCivId);
    if (!lost) return [];
    return [{ eventId: event.id, tileId: view.incident.tileId, actor: event.actor, target: event.target, label: 'Border clash · 1 person lost',
      detail: `${lost.name} lost one field resident. ${resolution.reason}`, cue: 'warning' as const, icon: 'population' as const,
      durationMs: 2600, importance: event.importance,
      deltas: [{ icon: 'population' as const, label: 'Person lost', value: -1, kind: 'delta' as const, tone: 'negative' as const, qualifier: 'recorded casualty', subject: lost.name }] }];
  });
}
