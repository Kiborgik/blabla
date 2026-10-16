import {
  BUILDINGS,
  ERAS,
  FEATURES,
  FOCUS_IDS,
  HISTORICAL_MILESTONES,
  RESOURCE_IDS,
  TECHNOLOGIES,
} from './content.ts';
import { parseUtcTimestamp } from './simulation/clock.ts';
import {
  CIV_COUNT,
  DIRECTOR_SEAT,
  GAME_VERSION,
  SCHEMA_VERSION,
  type City,
  type Civilization,
  type GameEvent,
  type HexTile,
  type Outcome,
  type Route,
  type Treaty,
  type WorldState,
} from './types.ts';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function finite(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

function unique(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

function knownStrings(value: unknown, allowed: readonly string[]): value is string[] {
  return strings(value) && unique(value) && value.every((id) => allowed.includes(id));
}

function civilization(value: unknown): value is Civilization {
  if (!record(value) || !record(value.resources)) return false;
  const resources = value.resources;
  const technologies = TECHNOLOGIES.map((item) => item.id);
  return (
    integer(value.id, 0, CIV_COUNT - 1) &&
    ['name', 'color', 'adjective', 'objective'].every((field) => text(value[field])) &&
    integer(value.era, 0, ERAS.length - 1) &&
    RESOURCE_IDS.every((resource) => finite(resources[resource])) &&
    knownStrings(value.technologies, technologies) &&
    typeof value.researchTarget === 'string' &&
    (value.researchTarget === '' || technologies.includes(value.researchTarget)) &&
    ['researchProgress', 'influence', 'marsProgress', 'score'].every((field) =>
      finite(value[field]),
    ) &&
    ['marsPopulation', 'marsSupplyStreak', 'federationStreak'].every((field) =>
      integer(value[field]),
    ) &&
    finite(value.legitimacy, 0, 100)
  );
}

function city(value: unknown): value is City {
  return (
    record(value) &&
    text(value.id) &&
    text(value.name) &&
    integer(value.civId, 0, CIV_COUNT - 1) &&
    integer(value.tileId) &&
    integer(value.population, 1) &&
    finite(value.wellbeing, 0, 100) &&
    finite(value.infrastructure) &&
    finite(value.damage, 0, 100) &&
    typeof value.focus === 'string' &&
    FOCUS_IDS.some((focus) => focus === value.focus) &&
    knownStrings(
      value.buildings,
      BUILDINGS.map((building) => building.id),
    )
  );
}

function tile(value: unknown): value is HexTile {
  return (
    record(value) &&
    integer(value.id) &&
    integer(value.q) &&
    integer(value.r) &&
    typeof value.terrain === 'string' &&
    ['ocean', 'grassland', 'forest', 'desert', 'mountain', 'tundra'].includes(value.terrain) &&
    finite(value.elevation) &&
    (value.owner === null || integer(value.owner, 0, CIV_COUNT - 1)) &&
    (value.resource === null || RESOURCE_IDS.some((resource) => resource === value.resource))
  );
}

function route(value: unknown): value is Route {
  return (
    record(value) &&
    text(value.id) &&
    text(value.from) &&
    text(value.to) &&
    integer(value.owner, 0, CIV_COUNT - 1) &&
    integer(value.partner, 0, CIV_COUNT - 1) &&
    value.owner !== value.partner &&
    typeof value.active === 'boolean' &&
    finite(value.damage, 0, 100) &&
    finite(value.volume)
  );
}

function treaty(value: unknown): value is Treaty {
  return (
    record(value) &&
    text(value.id) &&
    integer(value.a, 0, CIV_COUNT - 1) &&
    integer(value.b, 0, CIV_COUNT - 1) &&
    value.a !== value.b &&
    (value.kind === 'trade' || value.kind === 'federation' || value.kind === 'peace') &&
    integer(value.since)
  );
}

function event(value: unknown): value is GameEvent {
  return (
    record(value) &&
    ['id', 'type', 'title', 'cause'].every((field) => text(value[field])) &&
    typeof value.detail === 'string' &&
    integer(value.round) &&
    (value.actor === null || integer(value.actor, 0, DIRECTOR_SEAT)) &&
    (value.target === null || integer(value.target, 0, CIV_COUNT - 1)) &&
    (value.tileId === null || integer(value.tileId)) &&
    strings(value.effects) &&
    value.effects.length > 0 &&
    finite(value.importance)
  );
}

function outcome(value: unknown): value is Outcome | null {
  return (
    value === null ||
    (record(value) &&
      typeof value.kind === 'string' &&
      ['mars', 'federation', 'cultural', 'economic', 'military'].includes(value.kind) &&
      Array.isArray(value.winners) &&
      value.winners.length > 0 &&
      value.winners.every((winner: unknown) => integer(winner, 0, CIV_COUNT - 1)) &&
      unique(value.winners) &&
      integer(value.round) &&
      text(value.reason))
  );
}

export function isWorldState(
  value: unknown,
  options: { allowLegacyClock?: boolean } = {},
): value is WorldState {
  if (
    !record(value) ||
    value.schemaVersion !== SCHEMA_VERSION ||
    value.gameVersion !== GAME_VERSION ||
    !text(value.releaseId) ||
    !knownStrings(
      value.unlockedFeatures,
      FEATURES.map((feature) => feature.id),
    ) ||
    !knownStrings(
      value.calendarMilestones,
      HISTORICAL_MILESTONES.map((milestone) => milestone.id),
    ) ||
    !integer(value.seed, 0, 0xffffffff) ||
    !integer(value.rng, 0, 0xffffffff) ||
    !integer(value.revision) ||
    !integer(value.round) ||
    !integer(value.phase, 0, DIRECTOR_SEAT) ||
    !integer(value.year, -Number.MAX_SAFE_INTEGER) ||
    !integer(value.width, 1) ||
    !integer(value.height, 1) ||
    !finite(value.climate, -Number.MAX_SAFE_INTEGER) ||
    !integer(value.directorCooldown) ||
    !record(value.eventCounts) ||
    !Object.values(value.eventCounts).every((count) => integer(count)) ||
    !record(value.directorIntervals) ||
    !Object.entries(value.directorIntervals).every(
      ([key, timestamp]) =>
        /^(clock|event|review):.+/.test(key) &&
        typeof timestamp === 'string' &&
        parseUtcTimestamp(timestamp) !== null,
    ) ||
    !outcome(value.outcome)
  )
    return false;
  const legacyClock =
    options.allowLegacyClock === true &&
    value.clockEpoch === undefined &&
    value.clockTicks === undefined &&
    Object.keys(value.directorIntervals).length === 0;
  if (
    !legacyClock &&
    (!integer(value.clockTicks) ||
      (value.clockEpoch !== null &&
        (typeof value.clockEpoch !== 'string' || parseUtcTimestamp(value.clockEpoch) === null)) ||
      (value.clockEpoch === null && value.clockTicks !== 0))
  )
    return false;
  if (
    !Array.isArray(value.civilizations) ||
    !value.civilizations.every(civilization) ||
    value.civilizations.length !== CIV_COUNT ||
    !unique(value.civilizations.map((item) => item.id)) ||
    !Array.isArray(value.cities) ||
    !value.cities.every(city) ||
    !unique(value.cities.map((item) => item.id)) ||
    !Array.isArray(value.tiles) ||
    !value.tiles.every(tile) ||
    !unique(value.tiles.map((item) => item.id)) ||
    !Array.isArray(value.routes) ||
    !value.routes.every(route) ||
    !unique(value.routes.map((item) => item.id)) ||
    !Array.isArray(value.treaties) ||
    !value.treaties.every(treaty) ||
    !unique(value.treaties.map((item) => item.id)) ||
    !Array.isArray(value.events) ||
    !value.events.every(event) ||
    !unique(value.events.map((item) => item.id))
  )
    return false;
  const width = value.width;
  const height = value.height;
  const tiles = value.tiles;
  const cities = value.cities;
  const round = value.round;
  const counts = value.eventCounts;
  if (
    tiles.length !== width * height ||
    !tiles.every(
      (item) => item.q < width && item.r < height && item.id === item.r * width + item.q,
    ) ||
    !cities.every((item) =>
      tiles.some((site) => site.id === item.tileId && site.owner === item.civId),
    ) ||
    !unique(cities.map((item) => item.tileId)) ||
    !value.civilizations.every((item) =>
      cities.some((settlement) => settlement.civId === item.id),
    ) ||
    !value.routes.every(
      (item) =>
        cities.some((endpoint) => endpoint.id === item.from && endpoint.civId === item.owner) &&
        cities.some((endpoint) => endpoint.id === item.to && endpoint.civId === item.partner),
    ) ||
    !value.treaties.every((item) => item.since <= round) ||
    !value.events.every(
      (item) =>
        item.round <= round &&
        (item.tileId === null || tiles.some((site) => site.id === item.tileId)) &&
        integer(counts[item.type], 1),
    ) ||
    (value.outcome !== null && value.outcome.round > round)
  )
    return false;
  return true;
}
