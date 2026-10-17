import { availableWonderActions } from './wonders.ts';
import { availableImprovementSites, orderedImprovements } from './improvements.ts';
import { availableDistrictSites, describeDistrictProduction } from './districts.ts';
import { availableCoastalActions, foundingSiteEligible, foundingSourceEligible } from './coastal.ts';
import {
  ACTION_FEATURES,
  BUILDINGS,
  IMPROVEMENTS,
  DIRECTOR_EVENTS,
  ECONOMY_RULES,
  FOCUS_IDS,
  RESOURCE_IDS,
  TECHNOLOGIES,
} from '../content.ts';
import { DIRECTOR_SEAT, type ActionOption, type BuildingDefinition, type GameAction, type Resources, type WorldState } from '../types.ts';
import { describeSettlementSite } from './sites.ts';
import { hexDistance } from './geography.ts';
import { hasFeatures } from './history.ts';
import { canAfford, citiesOf } from './world.ts';
import { availablePublicProjectActions } from './public-projects.ts';
import { availableTradeActions, type TradePresentation } from './trade.ts';
import { orderedBuildings, paidRecipe } from './operations.ts';
import { canAct } from './turns.ts';
import { buildingEligibility, improvementEligibility, researchEligibility } from './capabilities.ts';
import { selectedMountainCatchment } from './water.ts';
import { decisionActionBlock } from './decisions.ts';
import { requiredConstructionWork } from './construction.ts';

export function actionFeatureAvailable(state: WorldState, action: GameAction['type']): boolean {
  return hasFeatures(state, ACTION_FEATURES[action]);
}

function resourceAmounts(resources: Partial<Resources>): string {
  return RESOURCE_IDS.filter((resource) => (resources[resource] ?? 0) > 0)
    .map((resource) => `${resource} ${resources[resource]}`)
    .join(', ') || 'none';
}

function describeConstruction(building: BuildingDefinition): string {
  return `Construction cost from shared supplies: ${resourceAmounts(building.cost)}. Recurring inputs per economy beat: ${resourceAmounts(building.operatingInputs ?? {})}. Base building output per economy beat before productivity: ${resourceAmounts(building.production)}; not net stock gain.${paidRecipe(building) ? ' Requires an enabled operation and all opening-stock inputs.' : ''}`;
}

export function availableActions(
  state: WorldState,
  seat: number,
  timestamp?: string,
  tradePresentation: TradePresentation = 'full',
): ActionOption[] {
  if (!canAct(state, seat, timestamp)) return [];
  const choices: ActionOption[] = [];
  if (actionFeatureAvailable(state, 'wait') && !decisionActionBlock(state, seat, { type: 'wait' }))
    choices.push({
      action: { type: 'wait' },
      label: 'Hold position',
      reason: 'Keep the current policy while other actors take their turns',
    });
  if (seat === DIRECTOR_SEAT) {
    if (!actionFeatureAvailable(state, 'event') || state.directorCooldown > 0) return choices;
    const era = Math.max(...state.civilizations.map((civilization) => civilization.era));
    for (const event of DIRECTOR_EVENTS) {
      if (event.minEra > era || !hasFeatures(state, event.requiredFeatures)) continue;
      for (const target of state.civilizations) {
        choices.push({
          action: { type: 'event', event: event.id, target: target.id },
          label: `${event.name}: ${target.name}`,
          reason: `${event.description} ${event.consequence}`,
        });
      }
    }
    return choices;
  }
  const civilization = state.civilizations.find((candidate) => candidate.id === seat);
  if (!civilization) return [];
  const cities = citiesOf(state, seat);
  choices.push(...availableWonderActions(state, seat));
  const specialized = hasFeatures(state, ['city-specialization']);
  if (actionFeatureAvailable(state, 'focus')) {
    if (specialized) {
      for (const city of cities) {
        const site = state.tiles.find((tile) => tile.id === city.tileId);
        if (!site) continue;
        for (const focus of FOCUS_IDS) {
          if (city.focus === focus) continue;
          choices.push({
            action: { type: 'focus', focus, cityId: city.id },
            label: `${city.name}: emphasize ${focus}`,
            reason: `Change only ${city.name}; civilization supplies remain shared. ${describeSettlementSite(state, site)}`,
          });
        }
      }
    } else {
      for (const focus of FOCUS_IDS) {
        if (cities.every((city) => city.focus === focus)) continue;
        choices.push({
          action: { type: 'focus', focus },
          label: `Emphasize ${focus}`,
          reason: `Change production priorities in ${cities.length} settlements`,
        });
      }
    }
  }
  if (actionFeatureAvailable(state, 'research')) {
    for (const technology of TECHNOLOGIES) {
      const eligibility = researchEligibility(state, seat, technology);
      if (eligibility.completed || eligibility.researching || eligibility.blockers.length) continue;
      choices.push({
        action: { type: 'research', technology: technology.id },
        label: `Research ${technology.name}`,
        reason: `${technology.capability}; ${technology.cost} science required`,
      });
    }
  }
  if (actionFeatureAvailable(state, 'build')) {
    for (const building of BUILDINGS) {
      if (specialized) {
        for (const city of cities) {
          const eligibility = buildingEligibility(state, seat, building, city.id);
          if (eligibility.completed || eligibility.blockers.length) continue;
          const site = state.tiles.find((tile) => tile.id === city.tileId);
          if (!site) continue;
          if (building.district) {
            for (const tileId of availableDistrictSites(state, city, building)) choices.push({
              action: { type: 'build', project: building.id, cityId: city.id, tileId },
              label: `Build ${building.name} for ${city.name} at site ${tileId}`,
              reason: `${building.description} ${describeConstruction(building)} Paid once at start; ${requiredConstructionWork(building.id)} work required; first output after completion. ${describeDistrictProduction(state, city, building, tileId)}`,
            });
            continue;
          }
          const catchmentTileId = building.siteRequirement === 'mountain-catchment' ? selectedMountainCatchment(state, city) : undefined;
          choices.push({
            action: { type: 'build', project: building.id, cityId: city.id },
            ...(catchmentTileId === undefined ? {} : { catchmentTileId }),
            label: `Build ${building.name} in ${city.name}`,
            reason: `${building.description} ${describeConstruction(building)}${hasFeatures(state, ['recurring-decisions']) ? ` Paid once at start; ${requiredConstructionWork(building.id)} work required over strategic beats; first output after completion.` : ''} Construct only in ${city.name}. ${describeSettlementSite(state, site)}`,
          });
        }
      } else {
        const eligibility = buildingEligibility(state, seat, building);
        if (eligibility.completed || eligibility.blockers.length) continue;
        choices.push({
          action: { type: 'build', project: building.id },
          label: `Build ${building.name}`,
          reason: `${building.description} ${describeConstruction(building)}`,
        });
      }
    }
  }
  if (actionFeatureAvailable(state, 'improve')) {
    for (const definition of IMPROVEMENTS) for (const city of cities) {
      if (improvementEligibility(state, seat, definition, city.id).blockers.length) continue;
      for (const tileId of availableImprovementSites(state, city, definition)) choices.push({
        action: { type: 'improve', cityId: city.id, tileId, improvementId: definition.id },
        label: `Build ${definition.name} for ${city.name} at site ${tileId}`,
        reason: `${definition.description} Exact owned site; pay once ${resourceAmounts(definition.cost)}; ${definition.requiredWork} work. Base output before town productivity: ${resourceAmounts(definition.production)}. Needs ${definition.residentsRequired} remaining opening residents after paid buildings; first output after completion.`,
      });
    }
  }
  if (actionFeatureAvailable(state, 'set-improvement-operation')) {
    for (const city of cities) for (const improvement of orderedImprovements(city)) {
      const definition = IMPROVEMENTS.find(candidate => candidate.id === improvement.improvementId);
      if (!definition || !hasFeatures(state, definition.requiredFeatures)) continue;
      choices.push({ action: { type: 'set-improvement-operation', cityId: city.id, tileId: improvement.tileId, improvementId: improvement.improvementId, enabled: !improvement.operation.enabled },
        label: `${improvement.operation.enabled ? 'Pause' : 'Resume'} ${definition.name} in ${city.name} at site ${improvement.tileId}`,
        reason: 'Changes future opening resident allocation only; retained historical output is unchanged',
      });
    }
  }
  if (actionFeatureAvailable(state, 'set-building-operation')) {
    for (const city of cities) {
      for (const building of orderedBuildings(city).filter(paidRecipe)) {
        const operation = city.buildingOperations?.[building.id];
        if (!operation || !hasFeatures(state, building.requiredFeatures)) continue;
        choices.push({
          action: { type: 'set-building-operation', cityId: city.id, buildingId: building.id, enabled: !operation.enabled },
          label: `${operation.enabled ? 'Pause' : 'Resume'} ${building.name} in ${city.name}`,
          reason: operation.enabled ? 'Preserve opening stocks by pausing this recipe' : 'Attempt this recipe on later strategic beats when all opening inputs are available',
        });
      }
    }
  }
  if (
    actionFeatureAvailable(state, 'settle') &&
    canAfford(civilization.resources, ECONOMY_RULES.settle.cost)
  ) {
    const ownedTiles = state.tiles.filter((tile) => tile.owner === seat);
    for (const tile of state.tiles) {
      if (
        !foundingSiteEligible(state, tile) ||
        !ownedTiles.some((owned) => hexDistance(owned, tile) <= 2)
      )
        continue;
      if (hasFeatures(state, ['conserved-founding'])) {
        for (const source of cities) {
          if (!foundingSourceEligible(source)) continue;
          choices.push({
            action: { type: 'settle', tileId: tile.id, sourceCityId: source.id },
            label: `Found settlement at ${tile.q}, ${tile.r} from ${source.name}`,
            reason: `Transfer ${ECONOMY_RULES.settle.population} people, leaving at least ${ECONOMY_RULES.settle.minimumSourcePopulation} in ${source.name}; pay food, materials and credits. ${describeSettlementSite(state, tile)}`,
          });
        }
      } else {
        choices.push({
          action: { type: 'settle', tileId: tile.id },
          label: `Found settlement at ${tile.q}, ${tile.r}`,
          reason: 'Spend food, materials and credits to create a new working settlement',
        });
      }
    }
  }
  choices.push(...availableCoastalActions(state, seat));
  choices.push(...availableTradeActions(state, seat, tradePresentation), ...availablePublicProjectActions(state, seat));
  if (actionFeatureAvailable(state, 'repair-city') && canAfford(civilization.resources, ECONOMY_RULES.repair.cost)) {
    for (const city of cities.filter((candidate) => candidate.damage > 0)) {
      choices.push({
        action: { type: 'repair-city', cityId: city.id },
        label: `Repair ${city.name}`,
        reason: `Damage ${city.damage} → ${Math.max(0, city.damage - ECONOMY_RULES.repair.damageReduction)}; pay shared materials ${ECONOMY_RULES.repair.cost.materials} and energy ${ECONOMY_RULES.repair.cost.energy}. Only this city recovers; infrastructure and buildings remain unchanged`,
      });
    }
  }
  if (
    actionFeatureAvailable(state, 'repair') &&
    canAfford(civilization.resources, ECONOMY_RULES.repair.cost)
  ) {
    for (const route of state.routes) {
      if (
        !route.agreement?.enabled ||
        route.damage <= 0 ||
        (route.owner !== seat && route.partner !== seat)
      )
        continue;
      choices.push({
        action: { type: 'repair', routeId: route.id },
        label: `Repair ${route.id}`,
        reason: 'Restore damaged shared trade infrastructure',
      });
    }
  }
  return choices;
}

export function sameAction(left: GameAction, right: unknown): boolean {
  if (typeof right !== 'object' || right === null) return false;
  if (
    !('type' in right) ||
    left.type !== right.type ||
    Object.keys(left).length !== Object.keys(right).length
  )
    return false;
  switch (left.type) {
    case 'focus':
      return 'focus' in right && left.focus === right.focus && left.cityId === ('cityId' in right ? right.cityId : undefined);
    case 'research':
      return 'technology' in right && left.technology === right.technology;
    case 'build-wonder':
      return 'wonderId' in right && 'cityId' in right && 'tileId' in right && left.wonderId === right.wonderId && left.cityId === right.cityId && left.tileId === right.tileId;
    case 'apply-research-boost':
      return 'wonderId' in right && 'technology' in right && left.wonderId === right.wonderId && left.technology === right.technology;
    case 'build':
      return 'project' in right && left.project === right.project && left.cityId === ('cityId' in right ? right.cityId : undefined) && left.tileId === ('tileId' in right ? right.tileId : undefined);
    case 'improve':
      return 'cityId' in right && 'tileId' in right && 'improvementId' in right && left.cityId === right.cityId && left.tileId === right.tileId && left.improvementId === right.improvementId;
    case 'set-improvement-operation':
      return 'cityId' in right && 'tileId' in right && 'improvementId' in right && 'enabled' in right && left.cityId === right.cityId && left.tileId === right.tileId && left.improvementId === right.improvementId && left.enabled === right.enabled;
    case 'set-building-operation':
      return 'cityId' in right && 'buildingId' in right && 'enabled' in right && left.cityId === right.cityId && left.buildingId === right.buildingId && left.enabled === right.enabled;
    case 'settle-coast':
    case 'settle':
      return 'tileId' in right && left.tileId === right.tileId && left.sourceCityId === ('sourceCityId' in right ? right.sourceCityId : undefined);
    case 'trade':
    case 'federate':
      return 'partner' in right && left.partner === right.partner;
    case 'propose-trade':
      return (
        'partner' in right &&
        'recipeId' in right &&
        left.partner === right.partner &&
        left.recipeId === right.recipeId &&
        left.sourceCityId === ('sourceCityId' in right ? right.sourceCityId : undefined) &&
        left.recipientCityId === ('recipientCityId' in right ? right.recipientCityId : undefined)
      );
    case 'respond-trade':
      return (
        'offerId' in right &&
        'accept' in right &&
        left.offerId === right.offerId &&
        left.accept === right.accept
      );
    case 'propose-public-project':
      return 'routeId' in right && 'recipeId' in right && left.routeId === right.routeId && left.recipeId === right.recipeId;
    case 'respond-public-project':
      return 'projectId' in right && 'accept' in right && left.projectId === right.projectId && left.accept === right.accept;
    case 'cancel-public-project':
      return 'projectId' in right && left.projectId === right.projectId;
    case 'withdraw-trade':
      return 'offerId' in right && left.offerId === right.offerId;
    case 'stop-trade':
      return 'routeId' in right && left.routeId === right.routeId;
    case 'repair-city':
      return 'cityId' in right && left.cityId === right.cityId;
    case 'repair':
      return 'routeId' in right && left.routeId === right.routeId;
    case 'event':
      return (
        'event' in right &&
        'target' in right &&
        left.event === right.event &&
        left.target === right.target
      );
    case 'expedition':
    case 'wait':
      return true;
    default:
      return false;
  }
}
