import { BUILDINGS, DIRECTOR_EVENTS, ECONOMY_RULES, RESOURCE_IDS } from '../content.ts';
import { DIRECTOR_SEAT, type GameAction, type GameEvent, type WorldState } from '../types.ts';
import { routeEndpoints } from './choices.ts';
import { applyEffects } from './effects.ts';
import { emitEvent } from './events.ts';
import { citiesOf, civilizationById, clamp, transferCost } from './world.ts';

export function applyDirectorEvent(
  state: WorldState,
  eventId: string,
  target: number,
  events: GameEvent[],
  cause?: string,
): void {
  const definition = DIRECTOR_EVENTS.find((event) => event.id === eventId);
  if (!definition) throw new RangeError(`Unknown Director event ${eventId}`);
  const civilization = civilizationById(state, target);
  const effects = applyEffects(state, target, definition.effects);
  state.directorCooldown = definition.cooldown;
  emitEvent(state, events, {
    type: definition.id,
    title: `${definition.name}: ${civilization.name}`,
    detail: `${definition.description} ${definition.consequence}`,
    actor: DIRECTOR_SEAT,
    target,
    tileId: citiesOf(state, target)[0]?.tileId ?? null,
    cause: cause ?? 'The World Director selected a released event for this civilization',
    effects: effects.length ? effects : ['No new shock; existing projects and pressures continue'],
    importance: 4,
  });
}

export function executeAction(
  state: WorldState,
  seat: number,
  action: GameAction,
  events: GameEvent[],
): void {
  if (action.type === 'event') {
    applyDirectorEvent(state, action.event, action.target, events);
    return;
  }
  if (action.type === 'wait') {
    emitEvent(state, events, {
      type: 'hold-position',
      title:
        seat === DIRECTOR_SEAT
          ? 'The World Director observes'
          : `${civilizationById(state, seat).name} holds its course`,
      detail: 'Existing production and research priorities continue',
      actor: seat,
      target: null,
      tileId: null,
      cause: 'The actor chose to preserve its current position',
      effects: ['The next actor may act'],
      importance: 0,
    });
    return;
  }
  const civilization = civilizationById(state, seat);
  const cities = citiesOf(state, seat);
  const firstCity = cities[0];
  const location = firstCity?.tileId ?? null;
  switch (action.type) {
    case 'focus': {
      for (const city of cities) city.focus = action.focus;
      emitEvent(state, events, {
        type: 'focus-changed',
        title: `${civilization.name} emphasizes ${action.focus}`,
        detail: 'Settlement work priorities changed across the civilization',
        actor: seat,
        target: seat,
        tileId: location,
        cause: 'The civilization changed its production policy',
        effects: [`${cities.length} settlements use ${action.focus} production`],
        importance: 2,
      });
      return;
    }
    case 'research': {
      civilization.researchTarget = action.technology;
      civilization.researchProgress = 0;
      emitEvent(state, events, {
        type: 'research-started',
        title: `${civilization.name} begins a discovery`,
        detail: action.technology,
        actor: seat,
        target: seat,
        tileId: location,
        cause:
          'The civilization committed its accumulated and future science to a released technology',
        effects: [`Research target ${action.technology}`],
        importance: 2,
      });
      return;
    }
    case 'build': {
      const definition = BUILDINGS.find((building) => building.id === action.project);
      const city = cities.find((candidate) => !candidate.buildings.includes(action.project));
      if (!definition || !city)
        throw new RangeError('Construction requires a released building and eligible settlement');
      transferCost(civilization.resources, definition.cost);
      city.buildings.push(definition.id);
      const effects = applyEffects(state, seat, definition.effects, city.id);
      emitEvent(state, events, {
        type: 'building-completed',
        title: `${city.name} builds ${definition.name}`,
        detail: definition.description,
        actor: seat,
        target: seat,
        tileId: city.tileId,
        cause: 'Known technology and a paid material investment enabled this construction',
        effects: [
          ...effects,
          ...RESOURCE_IDS.filter((resource) => (definition.production[resource] ?? 0) > 0).map(
            (resource) => `Seasonal ${resource} +${definition.production[resource]}`,
          ),
        ],
        importance: 4,
      });
      return;
    }
    case 'settle': {
      const tile = state.tiles.find((candidate) => candidate.id === action.tileId);
      if (!tile) throw new RangeError('Settlement site is missing');
      transferCost(civilization.resources, ECONOMY_RULES.settle.cost);
      tile.owner = seat;
      const city = {
        id: `city-${seat}-${state.revision}`,
        name: `${civilization.name} ${cities.length + 1}`,
        civId: seat,
        tileId: tile.id,
        ...ECONOMY_RULES.initialCity,
        population: ECONOMY_RULES.settle.population,
        focus: firstCity?.focus ?? 'growth',
        buildings: [],
      };
      state.cities.push(city);
      emitEvent(state, events, {
        type: 'settlement-founded',
        title: `${city.name} is founded`,
        detail: 'People and material supplies established a new settlement on the shared map',
        actor: seat,
        target: seat,
        tileId: tile.id,
        cause:
          'The released expansion capability and a paid investment made a nearby site habitable',
        effects: [
          `Population ${city.population}`,
          `Tile ${tile.id} belongs to ${civilization.name}`,
        ],
        importance: 4,
      });
      return;
    }
    case 'trade': {
      transferCost(civilization.resources, ECONOMY_RULES.trade.cost);
      const route = {
        id: `route-${state.revision}`,
        ...routeEndpoints(state, seat, action.partner),
        owner: seat,
        partner: action.partner,
        active: false,
        damage: 0,
        volume: 0,
      };
      state.routes.push(route);
      state.treaties.push({
        id: `trade-${state.revision}`,
        a: seat,
        b: action.partner,
        kind: 'trade',
        since: state.round,
      });
      emitEvent(state, events, {
        type: 'route-opened',
        title: `${civilization.name} opens a shared trade route`,
        detail: `Transport connects ${route.from} with ${route.to}`,
        actor: seat,
        target: action.partner,
        tileId: location,
        cause:
          'The released route system and paid infrastructure connected two existing settlements',
        effects: [`Route ${route.id} awaits its first supplied exchange`],
        importance: 4,
      });
      return;
    }
    case 'repair': {
      const route = state.routes.find((candidate) => candidate.id === action.routeId);
      if (!route) throw new RangeError('Repair route is missing');
      transferCost(civilization.resources, ECONOMY_RULES.repair.cost);
      const before = route.damage;
      route.damage = clamp(route.damage - ECONOMY_RULES.repair.damageReduction, 0, 100);
      emitEvent(state, events, {
        type: 'route-repaired',
        title: `${civilization.name} repairs a trade route`,
        detail: route.id,
        actor: seat,
        target: route.partner,
        tileId: location,
        cause: 'Materials and energy were committed to shared transport infrastructure',
        effects: [`Route damage ${before} → ${route.damage}`],
        importance: 3,
      });
      return;
    }
    case 'federate':
    case 'expedition':
      throw new RangeError('This action has no released implementation');
  }
}
