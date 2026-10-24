import { civicWorksBlock } from './simulation/civic-works.ts';
import { isCivicWorksAction } from './civic-works-validation.ts';
import { isBorderAction } from './border-validation.ts';
import { borderActionFailure } from './simulation/border-incidents.ts';
import { isKnowledgeAction } from './knowledge-validation.ts';
import { knowledgeActionFailure } from './simulation/knowledge-compacts.ts';
import { isReliefAction } from './relief-validation.ts';
import { reliefActionFailure } from './simulation/relief-charters.ts';
import { isHistoricalEventSelection } from './historical-selection-validation.ts';
import { spaceflightActionBlock } from './simulation/spaceflight.ts';
import { railEdgeId, railTownBlock, railSiteBlock } from './simulation/rail.ts';
import { governmentActionBlock } from './simulation/government.ts';
import { civicActionBlock } from './simulation/civics.ts';
import { createTerritoryPlanner } from './simulation/territory.ts';
import { researchBoostFacts, wonderSiteBlock } from './simulation/wonders.ts';
import { improvementSiteBlock } from './simulation/improvements.ts';
import { districtSiteBlock } from './simulation/districts.ts';
import { coastalSourceBlock } from './simulation/coastal.ts';
import { publicProjectActionFailure } from './simulation/public-projects.ts';
import { paidRecipe } from './simulation/operations.ts';
import {
  ACTION_FEATURES,
  POLICY_SLOT_TYPES,
  BUILDINGS,
  IMPROVEMENTS,
  WONDERS,
  DIRECTOR_EVENTS,
  ECONOMY_RULES,
  FOCUS_IDS,
  RESOURCE_IDS,
  TECHNOLOGIES,
  TRADE_RECIPES,
  TURN_RULES,
} from './content.ts';
import { availableActions, sameAction } from './simulation/choices.ts';
import { decisionActionBlock } from './simulation/decisions.ts';
import { hasFeatures } from './simulation/history.ts';
import { admissionError, usesIndependentTurns } from './simulation/turns.ts';
import { citiesOf } from './simulation/world.ts';
import {
  CIV_COUNT,
  DIRECTOR_SEAT,
  type Command,
  type GameAction,
  type Resources,
  type WorldState,
} from './types.ts';

export interface ActionPlanItem { action: GameAction; reason: string }
export type ActionPlanStatus = 'completed' | 'needs-review' | 'ready' | 'blocked' | 'invalidated';
export interface ActionPlanResultItem extends ActionPlanItem { status: ActionPlanStatus; result: string }
export interface ActionPlan { observedRevision: number; committedRevision: number; items: ActionPlanResultItem[] }
export type PlanningCommand = Command & { observedRevision?: number };
export type PlanValidation =
  | { ok: true; plan: ActionPlanItem[] }
  | { ok: false; code: 'invalid_plan' | 'plan_not_released' | 'plan_head_mismatch' | 'invalid_plan_context'; error: string };

type Assessment = Pick<ActionPlanResultItem, 'status' | 'result'>;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fields(value: Record<string, unknown>, names: string[]): boolean {
  return Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
}

function text(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
}

export function isGameAction(value: unknown): value is GameAction {
  if (!record(value)) return false;
  switch (value.type) {
    case 'commission-civic-works': return isCivicWorksAction(value);
    case 'dispatch-border': case 'respond-border': case 'withdraw-border': return isBorderAction(value);
    case 'propose-knowledge':
    case 'respond-knowledge':
    case 'withdraw-knowledge':
      return isKnowledgeAction(value);
    case 'propose-relief':
    case 'respond-relief':
    case 'withdraw-relief':
      return isReliefAction(value);
    case 'adopt-government':
      return fields(value, ['type', 'governmentId', 'assignments']) && text(value.governmentId, 128) && Array.isArray(value.assignments) && value.assignments.length <= 16 && Array.from(value.assignments).every(assignment => record(assignment) && fields(assignment, ['slotType', 'slotIndex', 'policyId']) && POLICY_SLOT_TYPES.some(slot => slot === assignment.slotType) && integer(assignment.slotIndex, 15) && text(assignment.policyId, 128));
    case 'choose-civic':
      return fields(value, ['type', 'civicId']) && text(value.civicId, 128);
    case 'acquire-tile':
      return fields(value, ['type', 'cityId', 'tileId']) && text(value.cityId, 128) && integer(value.tileId);
    case 'focus':
      return FOCUS_IDS.some((focus) => focus === value.focus) && (fields(value, ['type', 'focus']) || (fields(value, ['type', 'focus', 'cityId']) && text(value.cityId, 128)));
    case 'research':
      return fields(value, ['type', 'technology']) && text(value.technology, 128);
    case 'build-rail':
      return fields(value, ['type', 'cityId', 'fromTileId', 'toTileId']) && text(value.cityId, 128) && integer(value.fromTileId) && integer(value.toTileId);
    case 'build-wonder':
      return fields(value, ['type', 'wonderId', 'cityId', 'tileId']) && text(value.wonderId, 128) && text(value.cityId, 128) && integer(value.tileId);
    case 'apply-research-boost':
      return fields(value, ['type', 'wonderId', 'technology']) && text(value.wonderId, 128) && text(value.technology, 128);
    case 'build':
      return text(value.project, 128) && (fields(value, ['type', 'project']) || (fields(value, ['type', 'project', 'cityId']) && text(value.cityId, 128)) || (fields(value, ['type', 'project', 'cityId', 'tileId']) && text(value.cityId, 128) && integer(value.tileId)));
    case 'improve':
      return fields(value, ['type', 'cityId', 'tileId', 'improvementId']) && text(value.cityId, 128) && integer(value.tileId) && text(value.improvementId, 128);
    case 'set-improvement-operation':
      return fields(value, ['type', 'cityId', 'tileId', 'improvementId', 'enabled']) && text(value.cityId, 128) && integer(value.tileId) && text(value.improvementId, 128) && typeof value.enabled === 'boolean';
    case 'repair-city':
      return fields(value, ['type', 'cityId']) && text(value.cityId, 128);
    case 'set-building-operation':
      return fields(value, ['type', 'cityId', 'buildingId', 'enabled']) && text(value.cityId, 128) && text(value.buildingId, 128) && typeof value.enabled === 'boolean';
    case 'settle-coast':
      return fields(value, ['type', 'tileId', 'sourceCityId']) && integer(value.tileId) && text(value.sourceCityId, 128);
    case 'settle':
      return integer(value.tileId) && (fields(value, ['type', 'tileId']) || (fields(value, ['type', 'tileId', 'sourceCityId']) && text(value.sourceCityId, 128)));
    case 'trade':
    case 'federate':
      return fields(value, ['type', 'partner']) && integer(value.partner, CIV_COUNT - 1);
    case 'propose-public-project':
      return fields(value, ['type', 'routeId', 'recipeId']) && text(value.routeId, 128) && text(value.recipeId, 128);
    case 'respond-public-project':
      return fields(value, ['type', 'projectId', 'accept']) && text(value.projectId, 128) && typeof value.accept === 'boolean';
    case 'cancel-public-project':
      return fields(value, ['type', 'projectId']) && text(value.projectId, 128);
    case 'propose-trade':
      return integer(value.partner, CIV_COUNT - 1) && text(value.recipeId, 128) && (fields(value, ['type', 'partner', 'recipeId']) || ((fields(value, ['type', 'partner', 'recipeId', 'sourceCityId', 'recipientCityId']) || (value.transportMode === 'steam' && fields(value, ['type', 'partner', 'recipeId', 'sourceCityId', 'recipientCityId', 'transportMode']))) && text(value.sourceCityId, 128) && text(value.recipientCityId, 128)));
    case 'respond-trade':
      return fields(value, ['type', 'offerId', 'accept']) && text(value.offerId, 128) && typeof value.accept === 'boolean';
    case 'withdraw-trade':
      return fields(value, ['type', 'offerId']) && text(value.offerId, 128);
    case 'stop-trade':
    case 'repair':
      return fields(value, ['type', 'routeId']) && text(value.routeId, 128);
    case 'event':
      return (fields(value, ['type', 'event', 'target']) || fields(value, ['type', 'event', 'target', 'regional']) && isHistoricalEventSelection(value.regional) && value.regional.local.kind === value.event) && integer(value.target, CIV_COUNT - 1) && DIRECTOR_EVENTS.some((event) => event.id === value.event);
    case 'expedition':
      return fields(value, ['type', 'cityId', 'mission']) && text(value.cityId, 128) && ['settle', 'resupply'].includes(String(value.mission));
    case 'wait':
      return fields(value, ['type']);
    default:
      return false;
  }
}

function planItem(value: unknown): value is ActionPlanItem {
  return record(value) && fields(value, ['action', 'reason']) && isGameAction(value.action) && text(value.reason, 280);
}

export function isActionPlanItems(value: unknown): value is ActionPlanItem[] {
  return Array.isArray(value) && value.length <= TURN_RULES.maximumPlanItems && Array.from(value).every(planItem);
}

export function validateAttachedPlan(state: WorldState, command: PlanningCommand, value: unknown): PlanValidation {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return { ok: true, plan: [] };
  if (!isActionPlanItems(value))
    return { ok: false, code: 'invalid_plan', error: 'A plan must contain at most two exact actions, each with a nonblank reason of at most 280 characters' };
  if (!hasFeatures(state, ['bounded-plans']))
    return { ok: false, code: 'plan_not_released', error: 'This world has not explicitly released bounded-plans' };
  const observed = command.observedRevision ?? command.expectedRevision;
  if (!integer(command.expectedRevision, state.revision) || !integer(observed, command.expectedRevision))
    return { ok: false, code: 'invalid_plan_context', error: 'The observed revision must be a nonnegative safe integer no later than the command revision' };
  const first = value[0];
  if (!first || !sameAction(first.action, command.action))
    return { ok: false, code: 'plan_head_mismatch', error: 'The plan head must exactly match the submitted real action' };
  return { ok: true, plan: structuredClone(value) };
}

export function completeAttachedPlan(plan: ActionPlanItem[], observedRevision: number, committedRevision: number): ActionPlan | null {
  if (!plan.length) return null;
  if (!integer(observedRevision) || !integer(committedRevision) || observedRevision >= committedRevision)
    throw new RangeError('Plan revisions must identify an observation before the accepted revision');
  if (!isActionPlanItems(plan))
    throw new RangeError('Only a validated bounded plan can be completed');
  return {
    observedRevision,
    committedRevision,
    items: plan.map((item, index) => ({
      ...structuredClone(item),
      status: index === 0 ? 'completed' : 'needs-review',
      result: index === 0 ? `Action accepted at revision ${committedRevision}` : 'Review the current world before explicitly submitting this follow-up',
    })),
  };
}

export function isPersistedActionPlan(value: unknown, maximumRevision: number): value is ActionPlan {
  if (!record(value) || !fields(value, ['observedRevision', 'committedRevision', 'items'])
    || !integer(maximumRevision) || !integer(value.committedRevision, maximumRevision)
    || !integer(value.observedRevision) || value.observedRevision >= value.committedRevision
    || !Array.isArray(value.items) || value.items.length < 1 || value.items.length > TURN_RULES.maximumPlanItems) return false;
  return Array.from(value.items).every((item: unknown, index: number) => record(item)
    && fields(item, ['action', 'reason', 'status', 'result'])
    && isGameAction(item.action) && text(item.reason, 280) && text(item.result, 1000)
    && item.status === (index === 0 ? 'completed' : 'needs-review'));
}

function invalidated(result: string): Assessment { return { status: 'invalidated', result }; }
function blocked(result: string): Assessment { return { status: 'blocked', result }; }

function targetInvalidation(state: WorldState, seat: number, action: GameAction): Assessment | null {
  if (state.outcome) return invalidated('The world has ended; remaining intent cannot be executed');
  if (!integer(seat, DIRECTOR_SEAT)) return invalidated('The plan actor is not a valid world seat');
  const civilization = state.civilizations.find((candidate) => candidate.id === seat);
  const cities = citiesOf(state, seat);
  const specialized = hasFeatures(state, ['city-specialization']);
  if (specialized && (action.type === 'focus' || action.type === 'build') && !cities.some((city) => city.id === action.cityId))
    return invalidated('This release requires an explicit existing owned city target; review and choose the exact city');
  switch (action.type) {
    case 'commission-civic-works': {
      const failure = civicWorksBlock(state, seat, action);
      return failure ? blocked(failure) : null;
    }
    case 'dispatch-border': case 'respond-border': case 'withdraw-border': {
      const failure = borderActionFailure(state, seat, action);
      return failure ? blocked(failure) : null;
    }
    case 'propose-knowledge': {
      const route = state.routes.find(candidate => candidate.id === action.routeId);
      const teacher = cities.find(city => city.id === action.teacherCityId);
      const learner = state.cities.find(city => city.id === action.learnerCityId);
      return !route?.agreement?.enabled || !teacher || !learner || learner.civId === seat
        || !((route.owner === seat && route.from === teacher.id && route.to === learner.id && route.partner === learner.civId)
          || (route.partner === seat && route.to === teacher.id && route.from === learner.id && route.owner === learner.civId))
        || !teacher.buildings.includes(action.teacherInstitutionId) || !learner.buildings.includes(action.learnerInstitutionId)
        || !civilization?.technologies.includes(action.technologyId) || state.civilizations[learner.civId]?.researchTarget !== action.technologyId
        ? invalidated('The exact teaching route, institutions or active discovery changed') : null;
    }
    case 'respond-knowledge':
    case 'withdraw-knowledge': {
      const compact = state.knowledge?.active.find(candidate => candidate.id === action.compactId);
      return !compact || (action.type === 'respond-knowledge' ? compact.terms.learnerId !== seat || compact.status !== 'proposed'
        : compact.terms.teacherId !== seat && (compact.status !== 'accepted' || compact.terms.learnerId !== seat))
        ? invalidated('The exact knowledge compact is resolved or no longer open to this actor') : null;
    }
    case 'propose-relief':
    case 'respond-relief':
    case 'withdraw-relief': {
      if (action.type === 'propose-relief') {
        const route = state.routes.find(candidate => candidate.id === action.routeId);
        return !route || !route.agreement?.enabled || !cities.some(city => city.id === action.sourceCityId)
          || !state.cities.some(city => city.id === action.recipientCityId && city.civId !== seat)
          ? invalidated('The exact consented relief corridor or named endpoints are no longer available') : null;
      }
      const charter = state.relief?.active.find(candidate => candidate.id === action.charterId);
      return !charter || (action.type === 'respond-relief' ? charter.terms.recipientId !== seat || charter.status !== 'proposed' : charter.terms.donorId !== seat && charter.terms.recipientId !== seat)
        ? invalidated('The exact relief charter is resolved or no longer open to this actor') : null;
    }
    case 'adopt-government':
      return null;
    case 'choose-civic':
      return civilization?.civics?.completedCivicIds.includes(action.civicId) ? invalidated('The civic is already completed') : null;
    case 'acquire-tile': {
      if (!cities.some(city => city.id === action.cityId)) return invalidated('The exact owned acquisition town is missing');
      const tile = state.tiles.find(candidate => candidate.id === action.tileId);
      return !tile || tile.owner !== null ? invalidated('The acquisition tile is missing or already owned') : null;
    }
    case 'research':
      if (!TECHNOLOGIES.some((technology) => technology.id === action.technology)) return invalidated(`Technology ${action.technology} no longer exists`);
      if (civilization?.technologies.includes(action.technology)) return invalidated(`Technology ${action.technology} is already known`);
      if (civilization?.researchTarget === action.technology) return invalidated(`Research ${action.technology} is already underway`);
      return null;
    case 'build-rail': {
      const city = cities.find(candidate => candidate.id === action.cityId);
      if (!city) return invalidated('The exact owned Rail town is missing');
      if (state.railEdges?.[railEdgeId(action.fromTileId, action.toTileId)]) return invalidated('The canonical Rail edge is already completed');
      const block = railSiteBlock(state, city, action.fromTileId, action.toTileId);
      return block ? invalidated(block) : null;
    }
    case 'build-wonder': {
      const city = cities.find(candidate => candidate.id === action.cityId);
      const definition = WONDERS.find(candidate => candidate.id === action.wonderId);
      if (!city || !definition) return invalidated('The exact owned town or wonder definition is missing');
      if (state.wonders?.[action.wonderId]) return invalidated('The globally unique wonder is already completed');
      const block = wonderSiteBlock(state, city, definition, action.tileId);
      return block ? invalidated(block) : null;
    }
    case 'apply-research-boost': {
      const completed = state.wonders?.[action.wonderId];
      if (!completed || completed.completion.civId !== seat) return invalidated('The exact wonder award is not owned');
      if (completed.boosts.length >= completed.boostLimit || completed.boosts.some(boost => boost.technologyId === action.technology) || civilization?.technologies.includes(action.technology)) return invalidated('This exact boost is exhausted or already achieved');
      return null;
    }
    case 'build':
      if (action.tileId !== undefined) {
        const city = cities.find(candidate => candidate.id === action.cityId);
        const building = BUILDINGS.find(candidate => candidate.id === action.project);
        if (city && building) {
          const block = districtSiteBlock(state, city, building, action.tileId);
          if (block) return invalidated(block);
        }
      }
      if (hasFeatures(state, ['recurring-decisions']) && cities.some(city => { const active = city.construction?.active; return city.id === action.cityId && active && !('kind' in active) && active.buildingId === action.project; })) return invalidated(`Construction ${action.project} is already underway in ${action.cityId}`);
      if (!BUILDINGS.some((building) => building.id === action.project)) return invalidated(`Building ${action.project} no longer exists`);
      if (specialized) return cities.find((city) => city.id === action.cityId)?.buildings.includes(action.project) ? invalidated(`City ${action.cityId} already has ${action.project}`) : null;
      if (!cities.length) return invalidated('No settlement remains for this construction');
      return cities.every((city) => city.buildings.includes(action.project)) ? invalidated(`Every current settlement already has ${action.project}`) : null;
    case 'focus':
      if (specialized) return cities.find((city) => city.id === action.cityId)?.focus === action.focus ? invalidated(`City ${action.cityId} already follows ${action.focus}`) : null;
      if (!cities.length) return invalidated('No settlement remains for this production focus');
      return cities.every((city) => city.focus === action.focus) ? invalidated(`Every settlement already follows ${action.focus}`) : null;
    case 'repair-city': {
      const city = cities.find((candidate) => candidate.id === action.cityId);
      if (!city) return invalidated(`Owned city ${action.cityId} is missing`);
      return city.damage <= 0 ? invalidated(`City ${action.cityId} is already repaired`) : null;
    }
    case 'improve': {
      const city = cities.find(candidate => candidate.id === action.cityId);
      const definition = IMPROVEMENTS.find(candidate => candidate.id === action.improvementId);
      if (!city || !definition) return invalidated('The exact owned town or improvement definition is missing');
      const block = improvementSiteBlock(state, city, definition, action.tileId);
      return block ? invalidated(block) : null;
    }
    case 'set-improvement-operation': {
      const improvement = cities.find(city => city.id === action.cityId)?.improvements?.[String(action.tileId)];
      if (!improvement || improvement.improvementId !== action.improvementId) return invalidated('The exact installed improvement is missing');
      return improvement.operation.enabled === action.enabled ? invalidated('The exact improvement already has this operation setting') : null;
    }
    case 'set-building-operation': {
      const city = cities.find((candidate) => candidate.id === action.cityId);
      const building = BUILDINGS.find((candidate) => candidate.id === action.buildingId);
      const operation = city?.buildingOperations?.[action.buildingId];
      if (!city?.buildings.includes(action.buildingId) || !building || !paidRecipe(building) || !operation)
        return invalidated(`Owned constructed recipe ${action.cityId}/${action.buildingId} is missing`);
      return operation.enabled === action.enabled ? invalidated(`Recipe ${action.buildingId} is already ${action.enabled ? 'enabled' : 'paused'}`) : null;
    }
    case 'settle-coast':
    case 'settle': {
      if (hasFeatures(state, ['conserved-founding']) && !cities.some((city) => city.id === action.sourceCityId))
        return invalidated('Founding requires an explicit existing owned source settlement; review and choose a source');
      const tile = state.tiles.find((candidate) => candidate.id === action.tileId);
      return !tile || tile.owner !== null || tile.terrain === 'ocean' || tile.terrain === 'mountain'
        ? invalidated(`Settlement target ${action.tileId} is missing, claimed or uninhabitable`) : null;
    }
    case 'respond-public-project':
    case 'cancel-public-project': {
      const project = state.publicProjects?.find((candidate) => candidate.id === action.projectId);
      if (!project) return invalidated('The exact charter is missing or already resolved');
      if (action.type === 'respond-public-project' && (project.status !== 'pending' || project.recipient !== seat)) return invalidated('This charter no longer awaits this actor consent');
      if (action.type === 'cancel-public-project' && project.proposer !== seat && (project.status !== 'committed' || project.recipient !== seat)) return invalidated('This actor cannot cancel the charter');
      return null;
    }
    case 'propose-public-project': {
      const route = state.routes.find((candidate) => candidate.id === action.routeId);
      return !route?.agreement?.enabled || (route.owner !== seat && route.partner !== seat) || route.damage <= 0 ? invalidated('The exact damaged consented route is missing, stopped or already repaired') : null;
    }
    case 'respond-trade':
    case 'withdraw-trade': {
      const offer = (state.tradeOffers ?? []).find((candidate) => candidate.id === action.offerId);
      if (!offer || offer.status !== 'pending' || state.round >= offer.expiresRound)
        return invalidated(`Trade offer ${action.offerId} is missing, expired or already resolved`);
      const authorized = action.type === 'respond-trade' ? offer.recipient : offer.proposer;
      return authorized !== seat ? invalidated(`Actor ${seat} cannot ${action.type} offer ${action.offerId}`) : null;
    }
    case 'repair':
    case 'stop-trade': {
      const route = state.routes.find((candidate) => candidate.id === action.routeId);
      if (!route || !route.agreement?.enabled || (route.owner !== seat && route.partner !== seat))
        return invalidated(`Route ${action.routeId} is missing, stopped or belongs to other participants`);
      return action.type === 'repair' && route.damage <= 0 ? invalidated(`Route ${action.routeId} is already repaired`) : null;
    }
    case 'trade':
      return invalidated('Unilateral trade is retired; a new exchange requires explicit consent');
    case 'propose-trade':
    case 'federate':
      if (action.type === 'propose-trade' && hasFeatures(state, ['exact-trade-endpoints'])
        && (!cities.some((city) => city.id === action.sourceCityId) || !citiesOf(state, action.partner).some((city) => city.id === action.recipientCityId)))
        return invalidated('This release requires the exact existing source city and recipient-owned city; no endpoint can be substituted');
      if (action.partner === seat || !state.civilizations.some((candidate) => candidate.id === action.partner))
        return invalidated(`Partner ${action.partner} is not a different existing civilization`);
      return action.type === 'propose-trade' && !TRADE_RECIPES.some((recipe) => recipe.id === action.recipeId)
        ? invalidated(`Trade recipe ${action.recipeId} no longer exists`) : null;
    case 'event':
      return seat !== DIRECTOR_SEAT ? invalidated('Only the World Director can submit an event') : null;
    case 'expedition':
      return !cities.some(city => city.id === action.cityId) ? invalidated('The exact mission source town is no longer owned') : null;
    case 'wait':
      return null;
    default:
      return invalidated('The planned action is not supported');
  }
}

function unavailableReason(state: WorldState, seat: number, action: GameAction): string {
  if (action.type === 'commission-civic-works') return civicWorksBlock(state, seat, action) ?? 'Review the exact paid order and two scheduled crew seasons';
  if (action.type === 'expedition') return spaceflightActionBlock(state, seat, action) ?? 'Review the exact paid mission and powered source town';
  if (action.type === 'build-rail') return railTownBlock(state, seat, action.cityId) ?? 'Review the exact local Rail edge';
  if (action.type === 'adopt-government') return governmentActionBlock(state, seat, action.governmentId, action.assignments) ?? 'Review current arrangement admission';
  if (action.type === 'choose-civic') return civicActionBlock(state, seat, action.civicId) ?? 'Review current civic admission';
  if (action.type === 'acquire-tile') return createTerritoryPlanner(state).assess(seat, action.cityId, action.tileId).blocker ?? 'Review the current acquisition context';
  if (action.type === 'apply-research-boost') {
    const facts = researchBoostFacts(state, seat, action.wonderId);
    return facts.blocker ?? (facts.quote?.technologyId !== action.technology ? 'The exact named discovery is not the current eligible active target' : 'Review current boost admission');
  }
  if (action.type === 'settle-coast') { const block = coastalSourceBlock(state, seat, action.sourceCityId); if (block) return block; }
  const decisionBlock = decisionActionBlock(state, seat, action);
  if (decisionBlock) return decisionBlock;
  if (action.type === 'dispatch-border' || action.type === 'respond-border' || action.type === 'withdraw-border') return borderActionFailure(state, seat, action) ?? 'Review the exact border party and target';
  if (action.type === 'propose-knowledge' || action.type === 'respond-knowledge' || action.type === 'withdraw-knowledge') return knowledgeActionFailure(state, seat, action) ?? 'Review the exact knowledge commitment and admission';
  if (action.type === 'propose-relief' || action.type === 'respond-relief' || action.type === 'withdraw-relief') return reliefActionFailure(state, seat, action) ?? 'Review the exact relief commitment and admission';
  if (action.type === 'propose-public-project' || action.type === 'respond-public-project' || action.type === 'cancel-public-project') return publicProjectActionFailure(state, seat, action) ?? 'Review the current charter and admission';
  const civilization = state.civilizations.find((candidate) => candidate.id === seat);
  const requiredFeatures = [...ACTION_FEATURES[action.type]];
  let requires: readonly string[] = [];
  let cost: Partial<Resources> = {};
  let minEra = 0;
  if (action.type === 'build-wonder') {
    const definition = WONDERS.find(candidate => candidate.id === action.wonderId);
    if (definition) { requiredFeatures.push(...definition.requiredFeatures); requires = definition.requires; cost = definition.cost; minEra = definition.minEra; }
  } else if (action.type === 'build') {
    const building = BUILDINGS.find((candidate) => candidate.id === action.project);
    if (building) {
      requiredFeatures.push(...building.requiredFeatures);
      requires = building.requires;
      cost = building.cost;
      minEra = building.minEra;
    }
  } else if (action.type === 'research') {
    const technology = TECHNOLOGIES.find((candidate) => candidate.id === action.technology);
    if (technology) {
      requiredFeatures.push(...technology.requiredFeatures);
      requires = technology.requires;
    }
  } else if (action.type === 'propose-trade') {
    const recipe = TRADE_RECIPES.find((candidate) => candidate.id === action.recipeId);
    if (recipe) {
      requiredFeatures.push(...recipe.requiredFeatures);
      cost = recipe.terms.constructionCost;
    }
  } else if ((action.type === 'repair' || action.type === 'repair-city')) cost = ECONOMY_RULES.repair.cost;
  else if (action.type === 'settle' || action.type === 'settle-coast') {
    cost = ECONOMY_RULES.settle.cost;
    if (hasFeatures(state, ['conserved-founding'])) {
      const source = citiesOf(state, seat).find((city) => city.id === action.sourceCityId);
      const required = ECONOMY_RULES.settle.population + ECONOMY_RULES.settle.minimumSourcePopulation;
      if (source && source.population < required) return `Source ${source.id} has ${source.population} people; ${required} are required to transfer ${ECONOMY_RULES.settle.population} and retain ${ECONOMY_RULES.settle.minimumSourcePopulation}`;
    }
  }
  else if (action.type === 'event') {
    const event = DIRECTOR_EVENTS.find((candidate) => candidate.id === action.event);
    if (event) requiredFeatures.push(...event.requiredFeatures);
    if (state.directorCooldown > 0) return `Director event cooldown has ${state.directorCooldown} strategic beats remaining`;
  }
  const missingFeatures = [...new Set(requiredFeatures)].filter((feature) => !hasFeatures(state, [feature]));
  if (missingFeatures.length) return `Required capabilities are not released: ${missingFeatures.join(', ')}`;
  const missingTech = requires.filter((technology) => !civilization?.technologies.includes(technology));
  if (missingTech.length) return `Required technologies are not known: ${missingTech.join(', ')}`;
  if (civilization && civilization.era < minEra) return `Capability stage ${minEra} is required; current stage is ${civilization.era}`;
  const shortages = RESOURCE_IDS.filter((resource) => (civilization?.resources[resource] ?? 0) < (cost[resource] ?? 0));
  if (shortages.length) return `Insufficient resources: ${shortages.map((resource) => `${resource} ${civilization?.resources[resource] ?? 0}/${cost[resource] ?? 0}`).join(', ')}`;
  return `Action ${JSON.stringify(action)} is unavailable at revision ${state.revision}; review current targets, agreements and prerequisites`;
}

export function observeActionPlan(state: WorldState, seat: number, plan: ActionPlan, timestamp?: string): ActionPlan {
  if (!isPersistedActionPlan(plan, state.revision)) throw new RangeError('Persisted plan is malformed or newer than the world revision');
  const result = structuredClone(plan);
  const next = result.items[1];
  if (!next) return result;
  const invalid = targetInvalidation(state, seat, next.action);
  if (invalid) Object.assign(next, invalid);
  else if (!hasFeatures(state, ['bounded-plans'])) Object.assign(next, blocked('This world has not explicitly released bounded-plans'));
  else if (usesIndependentTurns(state) && timestamp === undefined)
    Object.assign(next, { status: 'needs-review', result: 'An explicit current timestamp is required to check admission before submission' });
  else {
    const admission = admissionError(state, seat, timestamp);
    if (admission) Object.assign(next, blocked(admission));
    else if (!availableActions(state, seat, timestamp, 'full', next.action.type === 'event' ? next.action : undefined).some((option) => sameAction(option.action, next.action)))
      Object.assign(next, blocked(unavailableReason(state, seat, next.action)));
    else Object.assign(next, { status: 'ready', result: `Legal at revision ${state.revision}; review and explicitly submit this action to execute it` });
  }
  return result;
}
