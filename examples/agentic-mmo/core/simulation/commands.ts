import { adoptGovernment } from './government.ts';
import { chooseCivic } from './civics.ts';
import { selectedCampusHighGround } from './observatory.ts';
import { executeTerritoryAcquisition } from './territory.ts';
import { executeWonderAction } from './wonders.ts';
import { selectedMountainCatchment } from './water.ts';
import { executeImprovementAction } from './improvements.ts';
import { executeCoastalFounding, foundSettlement } from './coastal.ts';
import { BUILDINGS, CONSTRUCTION_RULES, DIRECTOR_EVENTS, ECONOMY_RULES, RESEARCH_INVESTMENT_RULES, RESOURCE_IDS } from '../content.ts';
import { DIRECTOR_SEAT, type GameAction, type GameEvent, type Resources, type WorldState } from '../types.ts';
import { hasFeatures } from './history.ts';
import { installBuilding, requiredConstructionWork } from './construction.ts';
import { decisionHoldFacts } from './decisions.ts';
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
      effects: seat !== DIRECTOR_SEAT && hasFeatures(state, ['recurring-decisions']) ? decisionHoldFacts(state, seat) : ['The next actor may act'],
      importance: 0,
    });
    return;
  }
  const civilization = civilizationById(state, seat);
  const cities = citiesOf(state, seat);
  const firstCity = cities[0];
  const location = firstCity?.tileId ?? null;
  switch (action.type) {
    case 'adopt-government':
      adoptGovernment(state, seat, action.governmentId, action.assignments, events);
      return;
    case 'choose-civic':
      chooseCivic(state, seat, action.civicId, events);
      return;
    case 'acquire-tile':
      executeTerritoryAcquisition(state, seat, action.cityId, action.tileId, events);
      return;
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
        cause: hasFeatures(state, [RESEARCH_INVESTMENT_RULES.featureId])
          ? 'The civilization committed science produced by its settlements each strategic beat to a released technology'
          : 'The civilization committed its accumulated and future science to a released technology',
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
      if (definition.district && action.tileId === undefined) throw new RangeError('District construction requires its exact site');
      const highGround = definition.siteRequirement === 'campus-high-ground' ? selectedCampusHighGround(state, city) : undefined;
      if (definition.siteRequirement === 'campus-high-ground' && highGround === undefined) throw new RangeError('Construction requires its exact own completed Campus and adjacent high ground');
      const catchmentTileId = definition.siteRequirement === 'mountain-catchment' ? selectedMountainCatchment(state, city) : undefined;
      if (definition.siteRequirement === 'mountain-catchment' && catchmentTileId === undefined) throw new RangeError('Construction requires its exact adjacent mountain catchment');
      transferCost(civilization.resources, definition.cost);
      if (hasFeatures(state, ['recurring-decisions'])) {
        city.construction ??= { active: null, lastCompleted: null };
        city.construction.active = {
          id: `construction-${state.revision}`, cityId: city.id, buildingId: definition.id,
          ruleVersion: CONSTRUCTION_RULES.version, startedRound: state.round,
          ...(definition.district ? { tileId: action.tileId } : {}),
          ...(catchmentTileId === undefined ? {} : { catchmentTileId }),
          ...(highGround === undefined ? {} : { highGround: structuredClone(highGround) }),
          paid: structuredClone(definition.cost), workRequired: requiredConstructionWork(definition.id), workDone: 0,
        };
        emitEvent(state, events, {
          type: 'construction-started', title: `${city.name} starts ${definition.name}`,
          detail: city.construction.active.id, actor: seat, target: seat, tileId: definition.district ? action.tileId ?? null : city.tileId,
          cause: 'The exact town committed its full construction cost once to a strategic work order',
          effects: [
            ...RESOURCE_IDS.filter(resource => (definition.cost[resource] ?? 0) > 0).map(resource => `Paid ${definition.cost[resource]} ${resource}`),
            `Work 0/${city.construction.active.workRequired}`,
            ...(catchmentTileId === undefined ? [] : [`Retained mountain catchment ${catchmentTileId}`]),
            ...(highGround === undefined ? [] : [`Retained Campus ${highGround.campusTileId} high ground ${highGround.sourceTileId}`]),
            'No building effects or production until construction completes',
          ], importance: 3,
        });
      } else installBuilding(state, city, definition, events);
      return;
    }
    case 'build-wonder':
    case 'apply-research-boost':
      executeWonderAction(state, seat, action, events);
      return;
    case 'improve':
    case 'set-improvement-operation':
      executeImprovementAction(state, seat, action, events);
      return;
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
    case 'settle-coast':
      executeCoastalFounding(state, seat, action.sourceCityId, action.tileId, events);
      return;
    case 'settle': {
      const tile = state.tiles.find((candidate) => candidate.id === action.tileId);
      if (!tile) throw new RangeError('Settlement site is missing');
      const conserved = hasFeatures(state, ['conserved-founding']);
      const source = conserved ? cities.find((candidate) => candidate.id === action.sourceCityId) : firstCity;
      const city = foundSettlement(state, seat, tile, source, conserved);
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
