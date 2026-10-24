import { createCoastalFunding, type createCoastalOpportunity } from './behavior-coastal-opportunity.ts';
import { freezeFoundingFacts, type FoundingFunding } from './behavior-founding-protection.ts';
import { BUILDINGS, ECONOMY_RULES, RESIDENT_CAPACITY_RULES, RESOURCE_IDS } from './content.ts';
import { cityResourceProduction } from './learning-patronage.ts';
import { coastalPathBlock, coastalSourceBlock, foundSettlement, foundingSiteEligible } from './simulation/coastal.ts';
import { householdFoodUpkeep } from './simulation/food-security.ts';
import { hasFeatures } from './simulation/history.ts';
import { participatesInLocalPower } from './simulation/local-power.ts';
import { paidRecipe, projectOperationAllocation } from './simulation/operations.ts';
import type { ActionOption, BuildingDefinition, GameAction, Resources, WorldState } from './types.ts';

type BuildingToggle = Extract<GameAction, { type: 'set-building-operation' }>;
export interface ExpansionLaborContext {
  readonly weights: Readonly<Resources>;
  readonly desiredBuildings: ReadonlySet<string>;
  readonly desiredImprovements?: ReadonlySet<string>;
  readonly coastalOpportunity: ReturnType<typeof createCoastalOpportunity>;
  readonly settlementGoal: number;
  readonly foodRisk: boolean;
  readonly recovery: boolean;
  readonly requiredPools: boolean;
  readonly foundingWeight: (option: ActionOption) => number;
  readonly holds: (option: ActionOption) => boolean;
}
export interface ExpansionLaborWitness {
  readonly sourceCityId: string;
  readonly tileId: number;
  readonly buildingId: string;
  readonly pathTileIds: readonly number[];
  readonly protectedHorizon: number;
  readonly currentTowns: FoundingFunding;
  readonly departure: FoundingFunding;
  readonly retainedFlow: Readonly<Resources>;
  readonly alternativeFlow: Readonly<Resources>;
  readonly flowDelta: Readonly<Resources>;
  readonly lostOutput: Readonly<Resources>;
  readonly savedInputs: Readonly<Resources>;
  readonly netFlowValue: number;
  readonly foundingCost: Readonly<Partial<Resources>>;
}
export interface ExpansionLaborAssessment {
  readonly pause: BuildingToggle | null;
  readonly suppressedResume: BuildingToggle | null;
  readonly witness: ExpansionLaborWitness | null;
  readonly reason: string;
}
const empty = (): Resources => ({ food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 });
const quantize = (value: number): number => Math.round(value * 100) / 100;
const difference = (left: Readonly<Resources>, right: Readonly<Resources>): Resources => Object.fromEntries(RESOURCE_IDS.map(id => [id, quantize(left[id] - right[id])])) as unknown as Resources;
const key = (action: BuildingToggle): string => `${action.cityId}/${action.buildingId}`;
const knownResources = (values: Partial<Resources>): boolean => Object.entries(values).every(([id, value]) => RESOURCE_IDS.includes(id as typeof RESOURCE_IDS[number]) && Number.isFinite(value) && value >= 0);

function ordinaryRecipe(state: WorldState, definition: BuildingDefinition): boolean {
  return hasFeatures(state, definition.requiredFeatures) && paidRecipe(definition) && !(definition.production.food ?? 0)
    && !participatesInLocalPower(definition) && !Object.keys(definition.strategicInputs ?? {}).length
    && knownResources(definition.production) && knownResources(definition.operatingInputs ?? {});
}

function selectedInstitution(state: WorldState, civId: number, cityId: string, buildingId: string): boolean {
  return (state.knowledge?.active ?? []).some(compact => compact.status === 'accepted' && (
    compact.terms.teacherId === civId && compact.terms.teacherCityId === cityId && compact.terms.teacherInstitutionId === buildingId
    || compact.terms.learnerId === civId && compact.terms.learnerCityId === cityId && compact.terms.learnerInstitutionId === buildingId));
}

function openingFlow(state: WorldState, civId: number): { output: Resources; inputs: Resources; net: Resources } {
  const output = empty(); const inputs = empty();
  for (const city of state.cities.filter(city => city.civId === civId)) {
    for (const id of RESOURCE_IDS) output[id] = quantize(output[id] + cityResourceProduction(state, city, id).total);
    inputs.food = quantize(inputs.food + householdFoodUpkeep(state, city.population));
    for (const operation of [...Object.values(city.buildingOperations ?? {}), ...Object.values(city.improvements ?? {}).map(site => site.operation)]) {
      const receipt = operation.lastResult;
      if (receipt?.status === 'operated') for (const id of RESOURCE_IDS) inputs[id] = quantize(inputs[id] + (receipt.paid[id] ?? 0));
    }
  }
  return { output, inputs, net: difference(output, inputs) };
}

export function createExpansionLaborOpportunity(state: WorldState, civId: number, legalOptions: readonly ActionOption[], context: ExpansionLaborContext) {
  const revision = state.revision; const round = state.round;
  const counts = { sources: 0, destinations: 0, eligibleRecipes: 0, allocationProjections: 0, cacheHits: 0 };
  let cached: ExpansionLaborAssessment | undefined;
  const reject = (reason: string): ExpansionLaborAssessment => freezeFoundingFacts({ pause: null, suppressedResume: null, witness: null, reason });
  const project = (snapshot: WorldState): WorldState => { counts.allocationProjections++; return projectOperationAllocation(snapshot); };
  const evaluate = (): ExpansionLaborAssessment => {
    const actor = state.civilizations.find(actor => actor.id === civId);
    if (!actor || !hasFeatures(state, ['expansion-labor-reallocation', 'coastal-founding', 'resident-capacity', 'building-operations'])) return reject('expansion-labor-unreleased: the exact actor and released local labor rules are required');
    if (context.foodRisk || context.recovery) return reject('expansion-labor-emergency: retain Food and recovery priorities');
    if (state.cities.filter(city => city.civId === civId).length >= context.settlementGoal) return reject('expansion-labor-town-goal: ordinary settlement goal is already reached');
    if (RESOURCE_IDS.some(id => !Number.isFinite(context.weights[id]) || context.weights[id] < 0)) return reject('expansion-labor-weights: ordinary resource preferences must be finite and nonnegative');
    const resumes = legalOptions.filter(option => option.action.type === 'set-building-operation' && option.action.enabled && context.desiredBuildings.has(key(option.action))
      || option.action.type === 'set-improvement-operation' && option.action.enabled && context.desiredImprovements?.has(`${option.action.cityId}/${option.action.tileId}`));
    if (resumes.length > 1 || resumes.some(option => option.action.type !== 'set-building-operation')) return reject('expansion-labor-ambiguous: another desired resumption prevents a single-recipe comparison');
    const continuation = resumes[0];
    if (!Number.isSafeInteger(state.revision + (continuation ? 1 : 2))) return reject('expansion-labor-revision: separate future actions require safe revisions');
    if (!continuation && context.requiredPools) return reject('expansion-labor-required-work: ordinary required commitments precede optional preparation');
    const ranked = legalOptions.flatMap(option => {
      if (option.action.type !== 'settle-coast') return [];
      const weight = context.foundingWeight(option);
      return Number.isFinite(weight) && weight > 0 && !context.holds(option) ? [{ option, action: option.action, weight }] : [];
    }).toSorted((a, b) => b.weight - a.weight || a.action.sourceCityId.localeCompare(b.action.sourceCityId) || a.action.tileId - b.action.tileId);
    const pair = ranked[0];
    if (!pair) return reject('expansion-labor-no-pair: no ordinary useful exact legal coastal pair');
    counts.sources = 1; counts.destinations = 1;
    const source = state.cities.find(city => city.id === pair.action.sourceCityId && city.civId === civId);
    const tile = state.tiles.find(tile => tile.id === pair.action.tileId);
    if (!source || !tile || coastalSourceBlock(state, civId, source.id) || !foundingSiteEligible(state, tile) || !pair.option.coastalQuote
      || coastalPathBlock(state, pair.option.coastalQuote, source.tileId, tile.id)) return reject('expansion-labor-no-pair: exact current coastal capability, target and path are required');
    if (continuation && (continuation.action.type !== 'set-building-operation' || continuation.action.cityId !== source.id)) return reject('expansion-labor-ambiguous: the desired resumption belongs to a different current pair');
    if (!continuation && legalOptions.some(option => option.action.type === 'settle-coast' && !context.coastalOpportunity.assessment(option.action).hold)) return reject('expansion-labor-already-supported: a current legal departure needs no further pause');
    if (!continuation && !context.coastalOpportunity.assessment(pair.action).reason?.includes('protected-operation:')) return reject('expansion-labor-no-obstruction: the current pair lacks a proven resident obstruction');
    const closed = context.coastalOpportunity.closure;
    if (closed.reason) return reject(`expansion-labor-closure: ${closed.reason}`);
    const candidates = legalOptions.filter((option): option is ActionOption & { action: BuildingToggle } => option.action.type === 'set-building-operation'
      && option.action.cityId === source.id && option.action.enabled === !!continuation && context.desiredBuildings.has(key(option.action))
      && (!continuation || key(option.action) === key(continuation.action as BuildingToggle))
      && !context.holds(option) && source.buildings.includes(option.action.buildingId)
      && source.buildingOperations?.[option.action.buildingId]?.enabled === !option.action.enabled
      && !selectedInstitution(state, civId, source.id, option.action.buildingId)
      && BUILDINGS.some(building => building.id === (option.action as BuildingToggle).buildingId && ordinaryRecipe(state, building))).toSorted((a, b) => a.action.buildingId.localeCompare(b.action.buildingId));
    if (!candidates.length) return reject('expansion-labor-ineligible: no single ordinary desired legal recipe can release three residents');
    const retainedOpening = project(state);
    const actualRetained = openingFlow(retainedOpening, civId);
    let best: ExpansionLaborAssessment | undefined;
    let reason = 'expansion-labor-ineligible: no candidate has three actual unprotected residents';
    for (const option of candidates) {
      const buildingId = option.action.buildingId;
      counts.eligibleRecipes++;
      const on = continuation ? structuredClone(state) : state;
      if (continuation) on.cities.find(city => city.id === source.id)!.buildingOperations![buildingId]!.enabled = true;
      const onOpening = continuation ? project(on) : retainedOpening;
      const onTown = onOpening.cities.find(city => city.id === source.id)!;
      const receipt = onTown.buildingOperations?.[buildingId]?.lastResult;
      if (receipt?.status !== 'operated' || receipt.residents?.allocated !== ECONOMY_RULES.settle.population || receipt.residents.required !== RESIDENT_CAPACITY_RULES.perPaidRecipe) continue;
      if (cityResourceProduction(onOpening, onTown, 'science').buildings.some(building => building.buildingId === buildingId && building.policyContribution)) { reason = 'expansion-labor-learning: active institutional Learning output is retained'; continue; }
      if (continuation) {
        const onFunding = createCoastalFunding(on, civId, closed);
        const obstruction = onFunding.fund(on.cities.find(city => city.id === source.id)!, tile.id, 'founding');
        counts.allocationProjections += onFunding.work.allocationProjections;
        if (obstruction.assessment.facts || !obstruction.assessment.reason?.startsWith('protected-operation:')) { reason = 'expansion-labor-no-obstruction: resuming does not restore the exact resident obstruction'; continue; }
      }
      const off = structuredClone(on); const offTown = off.cities.find(city => city.id === source.id)!;
      offTown.buildingOperations![buildingId]!.enabled = false;
      const funding = createCoastalFunding(off, civId, closed);
      const current = funding.fund(offTown, tile.id, 'preparation');
      const departure = current.assessment.facts ? funding.fund(offTown, tile.id, 'founding') : null;
      counts.allocationProjections += funding.work.allocationProjections;
      if (!current.assessment.facts || !departure?.assessment.facts) { reason = `expansion-labor-unfunded: ${current.assessment.reason ?? departure?.assessment.reason}`; continue; }
      const offOpening = continuation ? retainedOpening : project(off);
      const retained = continuation ? openingFlow(onOpening, civId) : actualRetained;
      const paused = continuation ? actualRetained : openingFlow(offOpening, civId);
      const conditional = structuredClone(off); conditional.revision += continuation ? 1 : 2;
      foundSettlement(conditional, civId, conditional.tiles.find(candidate => candidate.id === tile.id)!, conditional.cities.find(city => city.id === source.id), true);
      const alternate = openingFlow(project(conditional), civId);
      const flowDelta = difference(alternate.net, retained.net);
      const netFlowValue = RESOURCE_IDS.reduce((sum, id) => sum + flowDelta[id] * context.weights[id], 0);
      if (!Number.isFinite(netFlowValue) || netFlowValue <= 0) { reason = 'expansion-labor-net-flow: this bounded conditional opening does not outweigh retaining the operation'; continue; }
      const witness: ExpansionLaborWitness = { sourceCityId: source.id, tileId: tile.id, buildingId, pathTileIds: [...pair.option.coastalQuote.tileIds], protectedHorizon: departure.horizon,
        currentTowns: current.assessment.facts, departure: departure.assessment.facts, retainedFlow: retained.net, alternativeFlow: alternate.net, flowDelta,
        lostOutput: difference(retained.output, paused.output), savedInputs: difference(retained.inputs, paused.inputs), netFlowValue, foundingCost: { ...ECONOMY_RULES.settle.cost } };
      const candidate: ExpansionLaborAssessment = { pause: continuation ? null : { ...option.action }, suppressedResume: continuation ? { ...option.action } : null, witness,
        reason: `Conditional coastal labor: ${buildingId} at ${source.id} for shore ${tile.id}; next-opening net flow +${quantize(netFlowValue)} weighted units, not capital payback. Founding separately costs ${ECONOMY_RULES.settle.cost.food} Food, ${ECONOMY_RULES.settle.cost.materials} Materials, ${ECONOMY_RULES.settle.cost.credits} Credits and moves ${ECONOMY_RULES.settle.population} residents.` };
      if (!best || netFlowValue > best.witness!.netFlowValue) best = candidate;
    }
    return best ? freezeFoundingFacts(best) : reject(reason);
  };
  const assessment = (): ExpansionLaborAssessment => {
    if (state.revision !== revision || state.round !== round) return reject('stale-expansion-labor: rebuild for the current snapshot');
    if (cached) { counts.cacheHits++; return cached; }
    cached = evaluate(); return cached;
  };
  return Object.freeze({ assessment, get work() { return freezeFoundingFacts({ ...counts, inheritedCoastal: context.coastalOpportunity.work }); } });
}
