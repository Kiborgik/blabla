import { BUILDINGS, DIRECTOR_EVENTS, ECONOMY_RULES, RESOURCE_IDS } from '../content.ts';
import { DIRECTOR_SEAT, type GameAction, type GameEvent, type Resources, type WorldState } from '../types.ts';
import { hasFeatures } from './history.ts';
import { paidRecipe } from './operations.ts';
import { executePublicProjectAction } from './public-projects.ts';
import { executeTradeAction } from './trade.ts';
import { applyEffects, directorEffects } from './effects.ts';
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
  const effects = applyEffects(state, target, directorEffects(state, definition));
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
      const specialized = hasFeatures(state, ['city-specialization']);
      const targets = specialized ? cities.filter((city) => city.id === action.cityId) : cities;
      if (specialized && targets.length !== 1) throw new RangeError('Focus requires the exact owned city');
      for (const city of targets) city.focus = action.focus;
      emitEvent(state, events, {
        type: 'focus-changed',
        title: `${specialized ? targets[0]?.name : civilization.name} emphasizes ${action.focus}`,
        detail: specialized ? 'Only the named settlement work priority changed; civilization supplies remain shared' : 'Settlement work priorities changed across the civilization',
        actor: seat,
        target: seat,
        tileId: specialized ? (targets[0]?.tileId ?? null) : location,
        cause: 'The civilization changed its production policy',
        effects: [`${targets.length} settlements use ${action.focus} production`],
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
      const specialized = hasFeatures(state, ['city-specialization']);
      const city = cities.find((candidate) => (!specialized || candidate.id === action.cityId) && !candidate.buildings.includes(action.project));
      if (!definition || !city)
        throw new RangeError('Construction requires a released building and eligible settlement');
      transferCost(civilization.resources, definition.cost);
      city.buildings.push(definition.id);
      if (paidRecipe(definition)) {
        city.buildingOperations ??= {};
        city.buildingOperations[definition.id] = { enabled: true, lastResult: null };
      }
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
          ...RESOURCE_IDS.filter((resource) => (definition.operatingInputs?.[resource] ?? 0) > 0).map((resource) => `Operating input ${resource} ${definition.operatingInputs?.[resource]} per funded beat`),
          ...RESOURCE_IDS.filter((resource) => (definition.production[resource] ?? 0) > 0).map(
            (resource) => `Seasonal ${resource} +${definition.production[resource]}${paidRecipe(definition) ? " when the complete operating recipe is funded" : ""}`,
          ),
        ],
        importance: 4,
      });
      return;
    }
    case 'set-building-operation': {
      const city = cities.find((candidate) => candidate.id === action.cityId);
      const operation = city?.buildingOperations?.[action.buildingId];
      if (!city || !operation) throw new RangeError('Operation requires an owned constructed recipe');
      operation.enabled = action.enabled;
      emitEvent(state, events, {
        type: 'building-operation-changed',
        title: `${city.name} ${action.enabled ? 'resumes' : 'pauses'} ${action.buildingId}`,
        detail: `${city.id}/${action.buildingId}`,
        actor: seat, target: seat, tileId: city.tileId,
        cause: 'The civilization explicitly changed this constructed recipe operation',
        effects: [action.enabled ? 'Future strategic beats may fund the complete recipe from opening stocks' : 'Future strategic beats skip this recipe without consuming inputs'],
        importance: 2,
      });
      return;
    }
    case 'settle': {
      const tile = state.tiles.find((candidate) => candidate.id === action.tileId);
      if (!tile) throw new RangeError('Settlement site is missing');
      const conserved = hasFeatures(state, ['conserved-founding']);
      const source = conserved ? cities.find((candidate) => candidate.id === action.sourceCityId) : firstCity;
      if (conserved && (!source || source.population < ECONOMY_RULES.settle.population + ECONOMY_RULES.settle.minimumSourcePopulation))
        throw new RangeError('Founding requires an owned source with enough people to preserve its minimum population');
      if (conserved && source) source.population -= ECONOMY_RULES.settle.population;
      transferCost(civilization.resources, ECONOMY_RULES.settle.cost);
      tile.owner = seat;
      const city = {
        id: `city-${seat}-${state.revision}`,
        name: `${civilization.name} ${cities.length + 1}`,
        civId: seat,
        tileId: tile.id,
        ...ECONOMY_RULES.initialCity,
        population: ECONOMY_RULES.settle.population,
        focus: source?.focus ?? 'growth',
        buildings: [],
      };
      state.cities.push(city);
      emitEvent(state, events, {
        type: 'settlement-founded',
        title: `${city.name} is founded`,
        detail: conserved ? `${ECONOMY_RULES.settle.population} people moved from ${source?.name} with material supplies` : 'People and material supplies established a new settlement on the shared map',
        actor: seat,
        target: seat,
        tileId: tile.id,
        cause:
          'The released expansion capability and a paid investment made a nearby site habitable',
        effects: [
          ...(conserved && source ? [`Source ${source.id} population -${ECONOMY_RULES.settle.population}; ${source.population} remain`] : []),
          `Population ${city.population}`,
          `Tile ${tile.id} belongs to ${civilization.name}`,
        ],
        importance: 4,
      });
      return;
    }
    case 'propose-public-project':
    case 'respond-public-project':
    case 'cancel-public-project':
      executePublicProjectAction(state, seat, action, events);
      return;
    case 'propose-trade':
    case 'respond-trade':
    case 'withdraw-trade':
    case 'stop-trade':
      executeTradeAction(state, seat, action, events);
      return;
    case 'trade':
      throw new RangeError('Legacy unilateral trade is unavailable; use an explicit consent offer');
    case 'repair-city': {
      const city = cities.find((candidate) => candidate.id === action.cityId);
      if (!city || city.damage <= 0) throw new RangeError('Repair requires the exact damaged owned city');
      const cost: Partial<Resources> = ECONOMY_RULES.repair.cost;
      transferCost(civilization.resources, cost);
      const before = city.damage;
      city.damage = clamp(before - ECONOMY_RULES.repair.damageReduction, 0, 100);
      emitEvent(state, events, {
        type: 'city-repaired',
        title: `${city.name} repairs its damage`,
        detail: `Only ${city.id} was repaired using shared civilization supplies`,
        actor: seat,
        target: seat,
        tileId: city.tileId,
        cause: 'Materials and energy were committed to settlement recovery',
        effects: [`City damage ${before} → ${city.damage}`, ...RESOURCE_IDS.filter((resource) => (cost[resource] ?? 0) > 0).map((resource) => `Paid ${cost[resource]} ${resource}`)],
        importance: 3,
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
