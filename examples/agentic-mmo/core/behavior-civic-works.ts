import type { CivicWorksAction, CivicWorksReceipt } from './civic-works-types.ts';
import { BUILDINGS, RESOURCE_IDS, TECHNOLOGIES } from './content.ts';
import { civicWorksCommission, projectCivicWorksProtection } from './simulation/civic-works.ts';
import { buildingBaseProduction } from './simulation/districts.ts';
import { paidRecipe } from './simulation/operations.ts';
import type { GameAction, Resources, WorldState } from './types.ts';

export interface CivicWorksAssessment {
  readonly supported: boolean;
  readonly reason: string;
  readonly weight: number;
  readonly netValue: number;
  readonly netResourceDelta: Readonly<Resources>;
  readonly forecastBeats: number;
  readonly proposedCompletionRound: number | null;
  readonly retainedCompletionRound: number | null;
  readonly firstEarlierProductionRound: number | null;
  readonly commissionPaid: Readonly<Partial<Resources>>;
  readonly foregoneKilnMaterials: number;
  readonly extraWork: number;
  readonly successfulBeats: readonly Readonly<CivicWorksReceipt>[];
}

const empty = (): Resources => ({ food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 });
const q = (value: number): number => Math.round(value * 100) / 100;
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

export function createCivicWorksPolicy(state: WorldState, civId: number, weights: Readonly<Resources>) {
  const revision = state.revision; const round = state.round;
  const cache = new Map<string, CivicWorksAssessment>();
  let projections = 0;
  const evaluate = (action: CivicWorksAction): CivicWorksAssessment => {
    const initial: CivicWorksAssessment = { supported: false, reason: '', weight: 0, netValue: 0, netResourceDelta: empty(), forecastBeats: 0, proposedCompletionRound: null, retainedCompletionRound: null, firstEarlierProductionRound: null, commissionPaid: {}, foregoneKilnMaterials: 0, extraWork: 0, successfulBeats: [] };
    const refuse = (reason: string, fields: Partial<CivicWorksAssessment> = {}) => freeze({ ...initial, ...fields, reason: `Civic works held: ${reason}` });
    if (state.revision !== revision || state.round !== round) return refuse('the chooser snapshot changed; create a new evaluator.');
    const key = JSON.stringify(action); const cached = cache.get(key); if (cached) return cached;
    const save = (result: CivicWorksAssessment) => { cache.set(key, result); return result; };
    const actor = state.civilizations.find(actor => actor.id === civId);
    const city = state.cities.find(city => city.id === action.cityId && city.civId === civId);
    const order = city?.construction?.active;
    if (!actor || !order || 'kind' in order || order.id !== action.orderId || state.civicWorks?.active.some(commission => commission.civId === civId)) return save(refuse('one exact active ordinary order and no existing commission are required.'));
    if (RESOURCE_IDS.some(id => !Number.isFinite(weights[id]) || weights[id] < 0)) return save(refuse('resource preferences must be finite and nonnegative.'));
    const definition = BUILDINGS.find(building => building.id === order.buildingId);
    if (!definition) return save(refuse('the target productive recipe is unknown.'));
    const commission = civicWorksCommission(state, civId, action);
    projections++;
    const projection = projectCivicWorksProtection(state, commission);
    if (!projection.supported) return save(refuse(projection.reason, { forecastBeats: projection.proposed.length }));
    const retained = projection.retained.at(-1)!; const proposed = projection.proposed.at(-1)!;
    const baseline = retained.civilizations.find(actor => actor.id === civId)!; const payer = proposed.civilizations.find(actor => actor.id === civId)!;
    const completionRound = (world: WorldState): number | null => {
      const completion = world.cities.find(city => city.id === action.cityId)?.construction?.lastCompleted;
      return completion?.orderId === order.id ? completion.completedRound : null;
    };
    const proposedCompletionRound = completionRound(proposed); const retainedCompletionRound = completionRound(retained);
    const successfulBeats = projection.proposed.flatMap(world => {
      const receipt = world.civicWorks?.lastResults[civId];
      return receipt?.commissionId === commission.id && receipt.round === world.round && receipt.status === 'worked' ? [structuredClone(receipt)] : [];
    });
    const commissionPaid = empty();
    for (const receipt of successfulBeats) for (const id of RESOURCE_IDS) commissionPaid[id] = q(commissionPaid[id] + (receipt.paid[id] ?? 0));
    const firstEarlierProductionRound = projection.proposed.find((world, index) => {
      const target = world.cities.find(city => city.id === action.cityId)!;
      const retainedTarget = projection.retained[index]!.cities.find(city => city.id === action.cityId)!;
      if (!target.buildings.includes(definition.id) || completionRound(world) === world.round || retainedTarget.buildings.includes(definition.id) && completionRound(projection.retained[index]!) !== world.round) return false;
      const output = paidRecipe(definition) ? target.buildingOperations?.[definition.id]?.lastResult?.produced ?? {} : buildingBaseProduction(world, target, definition);
      return RESOURCE_IDS.some(id => (output[id] ?? 0) > 0);
    })?.round ?? null;
    const netResourceDelta = Object.fromEntries(RESOURCE_IDS.map(id => [id, q(payer.resources[id] - baseline.resources[id])])) as Resources;
    const target = TECHNOLOGIES.find(technology => technology.id === actor.researchTarget);
    const usefulScience = (world: WorldState): number => {
      const current = world.civilizations.find(candidate => candidate.id === civId)!;
      return target ? Math.max(0, Math.min(target.cost, current.technologies.includes(target.id) ? target.cost : current.researchTarget === target.id ? current.researchProgress : actor.researchProgress) - actor.researchProgress) : 0;
    };
    netResourceDelta.science = q(usefulScience(proposed) - usefulScience(retained));
    const civic = actor.civics?.active;
    if (civic) {
      const invested = (world: WorldState): number => {
        const current = world.civilizations.find(candidate => candidate.id === civId)!.civics!;
        return current.completedCivicIds.includes(civic.civicId) ? civic.requiredCulture : current.active?.civicId === civic.civicId ? current.active.progress : civic.progress;
      };
      netResourceDelta.culture = q(netResourceDelta.culture + invested(proposed) - invested(retained));
    }
    const netValue = RESOURCE_IDS.reduce((sum, id) => sum + netResourceDelta[id] * weights[id], 0);
    const foregoneKilnMaterials = q(projection.retained.reduce((sum, world, index) => {
      if (!successfulBeats.some(receipt => receipt.round === world.round)) return sum;
      const output = (candidate: WorldState) => candidate.cities.find(city => city.id === action.cityId)?.buildingOperations?.kiln?.lastResult?.produced.materials ?? 0;
      return sum + output(world) - output(projection.proposed[index]!);
    }, 0));
    const fields = { forecastBeats: projection.proposed.length, proposedCompletionRound, retainedCompletionRound, firstEarlierProductionRound, commissionPaid, foregoneKilnMaterials, extraWork: q(successfulBeats.reduce((sum, receipt) => sum + receipt.extraWork, 0)), successfulBeats, netResourceDelta, netValue };
    if (proposedCompletionRound === null || retainedCompletionRound === null || proposedCompletionRound >= retainedCompletionRound || firstEarlierProductionRound === null) return save(refuse('no actual earlier productive building season survives the complete paid comparison.', fields));
    const weight = Math.max(0, netValue);
    return save(freeze({ ...initial, ...fields, supported: true, weight, reason: `${weight > 0 ? 'Optionally commission earlier production' : 'Retain Kiln Materials'}: actual bounded net value ${q(netValue)} over ${fields.forecastBeats} seasons; ${foregoneKilnMaterials} Kiln Materials forgone, ${commissionPaid.materials} Materials + ${commissionPaid.credits} Credits paid. Output first at round ${firstEarlierProductionRound}; no new orders or guaranteed future choices.` }));
  };
  return Object.assign(evaluate, { diagnostics: () => Object.freeze({ projections, cached: cache.size }) });
}

export function civicWorksActionHold(state: WorldState, civId: number, action: GameAction): string | null {
  const active = (id: number | undefined) => id !== undefined && (state.civicWorks?.active.some(commission => commission.civId === id) ?? false);
  if (active(civId) && ((action.type === 'set-building-operation' || action.type === 'set-improvement-operation') && action.enabled)) return 'An active civic-works commission makes this unmodeled operation resumption unsupported; current intent and cost-reducing pauses remain available.';
  if (active(civId) && action.type === 'set-improvement-operation' && !action.enabled && ['shore-fishery', 'hill-commons'].includes(action.improvementId)) return 'Preserve existing Food-site intent while its desired-operation budget does not model the active civic-works commitment.';
  let partner: number | undefined;
  let promise = false;
  if (action.type === 'propose-trade' || action.type === 'trade' || action.type === 'federate') { partner = action.partner; promise = true; }
  if (action.type === 'propose-public-project' || action.type === 'propose-relief' || action.type === 'propose-knowledge') {
    const route = state.routes.find(route => route.id === action.routeId); partner = route?.owner === civId ? route.partner : route?.owner; promise = true;
  }
  if (action.type === 'respond-trade' && action.accept) { partner = state.tradeOffers?.find(offer => offer.id === action.offerId)?.proposer; promise = true; }
  if (action.type === 'respond-public-project' && action.accept) { partner = state.publicProjects?.find(project => project.id === action.projectId)?.proposer; promise = true; }
  if (action.type === 'respond-relief' && action.accept) { partner = state.relief?.active.find(charter => charter.id === action.charterId)?.terms.donorId; promise = true; }
  if (action.type === 'respond-knowledge' && action.accept) { partner = state.knowledge?.active.find(compact => compact.id === action.compactId)?.terms.teacherId; promise = true; }
  return promise && (active(civId) || active(partner)) ? 'A new bilateral promise is outside the active civic-works funding forecast; decline, withdrawal and existing deliveries remain independent.' : null;
}
