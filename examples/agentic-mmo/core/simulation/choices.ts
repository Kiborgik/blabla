import {
  ACTION_FEATURES,
  BUILDINGS,
  DIRECTOR_EVENTS,
  ECONOMY_RULES,
  FOCUS_IDS,
  TECHNOLOGIES,
} from '../content.ts';
import { DIRECTOR_SEAT, type ActionOption, type GameAction, type WorldState } from '../types.ts';
import { hexDistance } from './geography.ts';
import { hasFeatures } from './history.ts';
import { canAfford, citiesOf, civilizationById } from './world.ts';

export function actionFeatureAvailable(state: WorldState, action: GameAction['type']): boolean {
  return hasFeatures(state, ACTION_FEATURES[action]);
}

export function availableActions(state: WorldState, seat: number): ActionOption[] {
  if (!Number.isInteger(seat) || seat !== state.phase || state.outcome) return [];
  const choices: ActionOption[] = [];
  if (actionFeatureAvailable(state, 'wait'))
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
  if (actionFeatureAvailable(state, 'focus')) {
    for (const focus of FOCUS_IDS) {
      if (cities.every((city) => city.focus === focus)) continue;
      choices.push({
        action: { type: 'focus', focus },
        label: `Emphasize ${focus}`,
        reason: `Change production priorities in ${cities.length} settlements`,
      });
    }
  }
  if (actionFeatureAvailable(state, 'research')) {
    for (const technology of TECHNOLOGIES) {
      if (
        !hasFeatures(state, technology.requiredFeatures) ||
        civilization.technologies.includes(technology.id) ||
        civilization.researchTarget === technology.id ||
        !technology.requires.every((id) => civilization.technologies.includes(id))
      )
        continue;
      choices.push({
        action: { type: 'research', technology: technology.id },
        label: `Research ${technology.name}`,
        reason: `${technology.capability}; ${technology.cost} science required`,
      });
    }
  }
  if (actionFeatureAvailable(state, 'build')) {
    for (const building of BUILDINGS) {
      if (
        !hasFeatures(state, building.requiredFeatures) ||
        civilization.era < building.minEra ||
        !building.requires.every((id) => civilization.technologies.includes(id)) ||
        !canAfford(civilization.resources, building.cost) ||
        !cities.some((city) => !city.buildings.includes(building.id))
      )
        continue;
      choices.push({
        action: { type: 'build', project: building.id },
        label: `Build ${building.name}`,
        reason: building.description,
      });
    }
  }
  if (
    actionFeatureAvailable(state, 'settle') &&
    canAfford(civilization.resources, ECONOMY_RULES.settle.cost)
  ) {
    const ownedTiles = state.tiles.filter((tile) => tile.owner === seat);
    for (const tile of state.tiles) {
      if (
        tile.owner !== null ||
        tile.terrain === 'ocean' ||
        tile.terrain === 'mountain' ||
        !ownedTiles.some((owned) => hexDistance(owned, tile) <= 2) ||
        state.cities.some((city) => {
          const site = state.tiles.find((candidate) => candidate.id === city.tileId);
          return site !== undefined && hexDistance(site, tile) < 2;
        })
      )
        continue;
      choices.push({
        action: { type: 'settle', tileId: tile.id },
        label: `Found settlement at ${tile.q}, ${tile.r}`,
        reason: 'Spend food, materials and credits to create a new working settlement',
      });
    }
  }
  if (
    actionFeatureAvailable(state, 'trade') &&
    canAfford(civilization.resources, ECONOMY_RULES.trade.cost)
  ) {
    for (const partner of state.civilizations) {
      if (
        partner.id === seat ||
        !citiesOf(state, partner.id).length ||
        state.routes.some(
          (route) =>
            (route.owner === seat && route.partner === partner.id) ||
            (route.owner === partner.id && route.partner === seat),
        )
      )
        continue;
      choices.push({
        action: { type: 'trade', partner: partner.id },
        label: `Open route to ${partner.name}`,
        reason:
          'Exchange actual food and materials cargo, paying energy upkeep before earning commerce',
      });
    }
  }
  if (
    actionFeatureAvailable(state, 'repair') &&
    canAfford(civilization.resources, ECONOMY_RULES.repair.cost)
  ) {
    for (const route of state.routes) {
      if (route.damage <= 0 || (route.owner !== seat && route.partner !== seat)) continue;
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
      return 'focus' in right && left.focus === right.focus;
    case 'research':
      return 'technology' in right && left.technology === right.technology;
    case 'build':
      return 'project' in right && left.project === right.project;
    case 'settle':
      return 'tileId' in right && left.tileId === right.tileId;
    case 'trade':
    case 'federate':
      return 'partner' in right && left.partner === right.partner;
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

export function routeEndpoints(
  state: WorldState,
  owner: number,
  partner: number,
): { from: string; to: string } {
  civilizationById(state, owner);
  civilizationById(state, partner);
  const from = citiesOf(state, owner)[0];
  const to = citiesOf(state, partner)[0];
  if (!from || !to) throw new RangeError('Trade requires two existing settlements');
  return { from: from.id, to: to.id };
}
