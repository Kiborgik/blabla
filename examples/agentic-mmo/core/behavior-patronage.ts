import { selectedInstitutionsFunded } from './behavior-paid-food-sites.ts';
import type { BehaviorProfile } from './behavior-profiles.ts';
import { BUILDINGS, CIVIC_RULES, ECONOMY_RULES, IMPROVEMENTS, LEARNING_PATRONAGE_RULES, POLICIES, RESOURCE_IDS, STRATEGIC_RESOURCE_IDS, TECHNOLOGIES } from './content.ts';
import { cityResourceProduction } from './learning-patronage.ts';
import { borderPromisedResources, borderReturnReservations } from './simulation/border-incidents.ts';
import { openingConstructionWork, resolveConstruction } from './simulation/construction.ts';
import { householdFoodUpkeep } from './simulation/food-security.ts';
import { adoptGovernment, canonicalAssignments, governmentActionBlock, governmentPrice, resolveGovernmentTransitions } from './simulation/government.ts';
import { cityGrowthFacts } from './simulation/growth.ts';
import { hasFeatures } from './simulation/history.ts';
import { allocateOperations, paidRecipe } from './simulation/operations.ts';
import { prepareWoodlandBeat, recordWoodlands } from './simulation/woodlands.ts';
import type { GameAction, PolicyAssignment, Resources, StrategicResources, WorldState } from './types.ts';

type ArrangementAction = Extract<GameAction, { type: 'adopt-government' }>;
interface Projection { value: number; output: Resources; bonusScience: number }
export interface PatronageAssessment {
  readonly supported: boolean;
  readonly reason: string;
  readonly forecastBeats: number;
  readonly protectedHorizon: number;
  readonly paidCredits: number;
  readonly proposedValue: number;
  readonly retainedValue: number;
  readonly priorityGain: number;
  readonly bonusScience: number;
  readonly marginalOutput: Readonly<Resources>;
}

const empty = (): Resources => ({ food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 });
const quantize = (value: number): number => Math.round(value * 100) / 100;
const priority = (assignment: PolicyAssignment): boolean => POLICIES.find(policy => policy.id === assignment.policyId)?.exclusiveGroup === LEARNING_PATRONAGE_RULES.exclusiveGroup;
const operationKey = (cityId: string, kind: string, id: string | number): string => `${cityId}/${kind}/${id}`;

function householdReserve(state: WorldState, civId: number, horizon: number): number {
  let total = 0;
  for (const city of state.cities.filter(city => city.civId === civId)) {
    const returning = borderReturnReservations(state, city.id); const facts = cityGrowthFacts(state, city);
    const order = city.construction?.active; const building = order && !('kind' in order) ? BUILDINGS.find(definition => definition.id === order.buildingId) : undefined;
    const capacity = facts.capacity + (building?.housing ?? 0);
    const wellbeing = city.wellbeing + (building?.effects.reduce((sum, effect) => sum + (effect.kind === 'city' && effect.field === 'wellbeing' ? Math.max(0, effect.amount) : 0), 0) ?? 0);
    const firstGrowth = Math.max(1, Math.ceil((ECONOMY_RULES.growth.wellbeing - wellbeing) / ECONOMY_RULES.suppliedWellbeingGain));
    const growths = Math.min(Math.max(0, horizon - firstGrowth + 1), Math.max(0, Math.ceil((capacity - city.population - returning) / ECONOMY_RULES.growth.populationGain)));
    total += householdFoodUpkeep(state, city.population + returning) * horizon;
    if (growths) total += ECONOMY_RULES.growth.foodReserve;
    for (let index = 0; index < growths; index++) {
      const population = city.population + returning + index * ECONOMY_RULES.growth.populationGain;
      total += cityGrowthFacts(state, { ...city, population }).nextGrowthFoodCost
        + householdFoodUpkeep(state, ECONOMY_RULES.growth.populationGain) * (horizon - firstGrowth - index);
    }
  }
  return quantize(total);
}

export function createPatronagePolicy(state: WorldState, civId: number, weights: Readonly<Resources>, priorities: BehaviorProfile['priorities']) {
  const actor = state.civilizations.find(candidate => candidate.id === civId);
  const cache = new Map<string, PatronageAssessment>();
  return (action: ArrangementAction): PatronageAssessment => {
    const key = JSON.stringify([action.governmentId, canonicalAssignments(action.assignments)]);
    const previous = cache.get(key); if (previous) return previous;
    const forecastBeats = CIVIC_RULES.commitmentBeats + (actor?.government?.active && actor.government.active.governmentId !== action.governmentId ? CIVIC_RULES.transitionBeats : 0);
    const paidCredits = actor ? governmentPrice(state, civId, action.governmentId).credits : 0;
    let protectedHorizon = forecastBeats;
    const save = (value: PatronageAssessment): PatronageAssessment => { const result = Object.freeze({ ...value, marginalOutput: Object.freeze(value.marginalOutput) }); cache.set(key, result); return result; };
    const refuse = (reason: string) => save({ supported: false, reason: `Economic priority held: ${reason}`, forecastBeats, protectedHorizon, paidCredits, proposedValue: 0, retainedValue: 0, priorityGain: 0, bonusScience: 0, marginalOutput: empty() });
    if (!actor || !hasFeatures(state, [LEARNING_PATRONAGE_RULES.featureId])) return refuse('the released civilization and priority are required.');
    const block = governmentActionBlock(state, civId, action.governmentId, action.assignments);
    if (block) return refuse(block);
    if (!action.assignments.some(priority) && !actor.government?.active?.assignments.some(priority)) return save({ supported: true, reason: 'The ordinary government preference does not add an economic priority.', forecastBeats, protectedHorizon, paidCredits, proposedValue: 0, retainedValue: 0, priorityGain: 0, bonusScience: 0, marginalOutput: empty() });
    for (const compact of state.knowledge?.active ?? []) if (compact.status === 'accepted' && (compact.terms.teacherId === civId || compact.terms.learnerId === civId)) protectedHorizon = Math.max(protectedHorizon, compact.deadlineRound - state.round);
    for (const charter of state.relief?.active ?? []) if (charter.status === 'accepted' && charter.terms.donorId === civId) protectedHorizon = Math.max(protectedHorizon, charter.dueRound - state.round);
    for (const project of state.publicProjects ?? []) if (project.status === 'committed' && (project.proposer === civId || project.recipient === civId)) protectedHorizon = Math.max(protectedHorizon, project.dueRound - state.round);
    for (const route of state.routes) if (route.agreement?.enabled && (route.owner === civId || route.partner === civId)) protectedHorizon = Math.max(protectedHorizon, route.agreement.nextDeliveryRound - state.round);
    const parties = (state.border?.active ?? []).flatMap(incident => incident.defender ? [incident.initiator, incident.defender] : [incident.initiator]).filter(party => party.departure.actorId === civId && !party.returned);
    for (const party of parties) protectedHorizon = Math.max(protectedHorizon, party.departure.returnByRound - state.round);
    const promises = borderPromisedResources(state, civId, protectedHorizon);
    if (promises.failure) return refuse(promises.failure);
    protectedHorizon = promises.horizon;
    const required = new Set(promises.operationForecast.map(operation => operationKey(operation.cityId, operation.kind, operation.kind === 'building' ? operation.id : operation.tileId!)));
    for (const party of parties) for (const operation of party.departure.operationForecast) {
      const retained = promises.operationForecast.find(item => item.cityId === operation.cityId && item.kind === operation.kind && item.id === operation.id && item.tileId === operation.tileId);
      if (!retained || retained.residents !== operation.residents || RESOURCE_IDS.some(id => (retained.inputs[id] ?? 0) !== (operation.inputs[id] ?? 0)) || STRATEGIC_RESOURCE_IDS.some(id => (retained.strategicInputs[id] ?? 0) !== (operation.strategicInputs[id] ?? 0))) return refuse('an existing border operation commitment is unavailable.');
    }
    const operating = empty(); const strategic: StrategicResources = {};
    for (const operation of promises.operationForecast) {
      for (const id of RESOURCE_IDS) operating[id] = quantize(operating[id] + (operation.inputs[id] ?? 0));
      for (const id of STRATEGIC_RESOURCE_IDS) strategic[id] = (strategic[id] ?? 0) + (operation.strategicInputs[id] ?? 0);
    }
    const pending = new Map<string, string>(); const future = empty(); const futureStrategic: StrategicResources = {};
    for (const city of state.cities.filter(city => city.civId === civId)) {
      const order = city.construction?.active; if (!order) continue;
      if ('kind' in order && order.kind !== 'improvement') return refuse('contested wonder or route completion is outside this bounded productive quote.');
      const definition = 'kind' in order ? IMPROVEMENTS.find(item => item.id === order.improvementId) : BUILDINGS.find(item => item.id === order.buildingId);
      if (!definition || !hasFeatures(state, definition.requiredFeatures)) return refuse('an existing paid order lacks its released productive definition.');
      if ('effects' in definition && definition.effects.some(effect => effect.kind !== 'city' || effect.field === 'population' || effect.amount < 0)) return refuse('an existing paid order has effects outside this bounded productive quote.');
      const isPaid = 'residentsRequired' in definition || paidRecipe(definition);
      if (!isPaid) continue;
      const operation = operationKey(city.id, 'kind' in order ? 'improvement' : 'building', 'kind' in order ? order.tileId : definition.id);
      pending.set(operation, city.id);
      for (const id of RESOURCE_IDS) future[id] = quantize(future[id] + (definition.operatingInputs?.[id] ?? 0));
      for (const id of STRATEGIC_RESOURCE_IDS) futureStrategic[id] = (futureStrategic[id] ?? 0) + ('strategicInputs' in definition ? definition.strategicInputs?.[id] ?? 0 : 0);
    }
    const reserve = empty(); const reserveStrategic: StrategicResources = {};
    const households = householdReserve(state, civId, protectedHorizon);
    for (const id of RESOURCE_IDS) {
      const full = quantize((promises.ordinary[id] ?? 0) + future[id] * protectedHorizon + (id === 'food' ? households : 0));
      if (!Number.isSafeInteger(Math.round(full * 100)) || actor.resources[id] < full + (id === 'credits' ? paidCredits : 0)) return refuse(`opening ${id} cannot cover the arrangement, households and protected operations or promises; future income is not financing.`);
      reserve[id] = quantize(full - (operating[id] + future[id]) * forecastBeats);
    }
    for (const id of STRATEGIC_RESOURCE_IDS) {
      const full = (promises.strategic[id] ?? 0) + (futureStrategic[id] ?? 0) * protectedHorizon;
      if (!Number.isSafeInteger(full) || (actor.strategicResources?.[id] ?? 0) < full) return refuse(`opening ${id} cannot cover protected operations or promises.`);
      reserveStrategic[id] = full - ((strategic[id] ?? 0) + (futureStrategic[id] ?? 0)) * forecastBeats;
    }
    const research = TECHNOLOGIES.find(technology => technology.id === actor.researchTarget);
    const simulate = (proposed: boolean, neutral: boolean): Projection | null => {
      const projected = structuredClone(state); const payer = projected.civilizations.find(candidate => candidate.id === civId)!;
      if (proposed) adoptGovernment(projected, civId, action.governmentId, action.assignments, []);
      if (neutral) {
        if (payer.government?.active) payer.government.active.assignments = payer.government.active.assignments.filter(assignment => !priority(assignment));
        if (payer.government?.pending) payer.government.pending.targetAssignments = payer.government.pending.targetAssignments.filter(assignment => !priority(assignment));
      }
      for (const id of RESOURCE_IDS) payer.resources[id] = quantize(payer.resources[id] - reserve[id]);
      payer.strategicResources ??= {};
      for (const id of STRATEGIC_RESOURCE_IDS) payer.strategicResources[id] = (payer.strategicResources[id] ?? 0) - (reserveStrategic[id] ?? 0);
      let remaining = research ? Math.max(0, research.cost - actor.researchProgress) : 0;
      const result: Projection = { value: 0, output: empty(), bonusScience: 0 };
      for (let beat = 1; beat <= forecastBeats; beat++) {
        projected.round++;
        const work = openingConstructionWork(projected); const woods = prepareWoodlandBeat(projected); const before = { ...payer.resources };
        allocateOperations(projected, woods);
        const funded = new Set<string>(); const output = empty();
        for (const city of projected.cities.filter(city => city.civId === civId)) {
          for (const [id, operation] of Object.entries(city.buildingOperations ?? {})) if (operation.lastResult?.status === 'operated') funded.add(operationKey(city.id, 'building', id));
          for (const improvement of Object.values(city.improvements ?? {})) if (improvement.operation.lastResult?.status === 'operated') funded.add(operationKey(city.id, 'improvement', improvement.tileId));
          for (const id of RESOURCE_IDS) {
            const production = cityResourceProduction(projected, city, id); output[id] = quantize(output[id] + production.total);
            if (id === 'science') result.bonusScience = quantize(result.bonusScience + production.buildings.reduce((sum, item) => sum + (item.policyContribution?.bonusScience ?? 0), 0));
          }
        }
        if ([...required].some(key => !funded.has(key)) || !selectedInstitutionsFunded(projected, civId)) return null;
        for (const [key, cityId] of pending) if (!projected.cities.find(city => city.id === cityId)?.construction?.active && !funded.has(key)) return null;
        output.science = quantize(Math.min(output.science, remaining)); remaining = quantize(remaining - output.science);
        for (const id of RESOURCE_IDS) {
          const net = quantize(output[id] - (before[id] - payer.resources[id]));
          result.output[id] = quantize(result.output[id] + net);
          result.value += net * weights[id] * (id === 'science' ? priorities.research : priorities.construction) / beat;
        }
        const events: Parameters<typeof resolveConstruction>[2] = [];
        recordWoodlands(projected, woods, events);
        resolveConstruction(projected, work, events);
        resolveGovernmentTransitions(projected, events);
      }
      return result;
    };
    const proposed = simulate(true, false); const proposedNeutral = simulate(true, true);
    const retained = simulate(false, false); const retainedNeutral = simulate(false, true);
    if (!proposed || !proposedNeutral || !retained || !retainedNeutral) return refuse('current or committed operations would lose opening inputs, residents, Power or finite woodland support.');
    const proposedValue = proposed.value - proposedNeutral.value; const retainedValue = retained.value - retainedNeutral.value;
    const priorityGain = proposedValue - retainedValue - paidCredits * weights.credits;
    const marginalOutput = empty(); for (const id of RESOURCE_IDS) marginalOutput[id] = quantize(proposed.output[id] - proposedNeutral.output[id]);
    const bonusScience = quantize(proposed.bonusScience - proposedNeutral.bonusScience);
    const names = action.assignments.filter(priority).map(assignment => POLICIES.find(policy => policy.id === assignment.policyId)!.name).join(', ') || 'No economic priority';
    const production = RESOURCE_IDS.filter(id => id !== 'science' && marginalOutput[id] !== 0).map(id => `${marginalOutput[id]} ${id}`).join(', ') || 'no earlier productive output';
    const reason = `${names}: conditional ${bonusScience} institutional bonus Science; paid construction adds ${production} over ${forecastBeats} beats. Current research caps learning value; ${paidCredits} Credits and ${protectedHorizon}-beat opening commitments are protected.`;
    return save({ supported: true, reason, forecastBeats, protectedHorizon, paidCredits, proposedValue, retainedValue, priorityGain, bonusScience, marginalOutput });
  };
}
