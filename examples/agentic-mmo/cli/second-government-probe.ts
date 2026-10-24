import assert from 'node:assert/strict';
import { isDeepStrictEqual as equal } from 'node:util';
import { CIVICS, CIVIC_RULES, CONSTRUCTION_RULES, ECONOMY_RULES, GOVERNMENTS, IMPROVEMENTS, POLICIES, PUBLIC_PROJECT_RECIPES, RESOURCE_IDS } from '../core/content.ts';
import { applyCommand, catchUpStrategy, legalActions } from '../core/engine.ts';
import { civicActionBlock } from '../core/simulation/civics.ts';
import { constructionWork, openingConstructionWork } from '../core/simulation/construction.ts';
import { buildingBaseProduction } from '../core/simulation/districts.ts';
import { governmentActionBlock, governmentModifiers, governmentPrice, observedGovernment } from '../core/simulation/government.ts';
import { orderedImprovements } from '../core/simulation/improvements.ts';
import { allocateOperations, paidRecipe, productiveBuildings } from '../core/simulation/operations.ts';
import { resolvePublicProjects } from '../core/simulation/public-projects.ts';
import { initializeLocalPower } from '../core/simulation/local-power.ts';
import { BUILDINGS } from '../core/content.ts';
import { siteProduction } from '../core/simulation/sites.ts';
import { wonderBaseProduction } from '../core/simulation/wonders.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import type { ConstructionOrder, GameAction, GameEvent, Resources, TransitionResult, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { coastalPrefixTime, replayCoastalStep, syntheticInstitution, syntheticTechnologies, type CoastalPrefixStep } from '../tests/fixtures/coastal-prefix.ts';
import { secondGovernmentJourney } from '../tests/fixtures/second-government-journey.ts';

export const SECOND_GOVERNMENT_ACTIONS = ['complete_second_government_civics', 'choose_second_government', 'work_in_original_capital', 'resolve_real_government_change', 'retain_second_government_reform', 'refuse_second_government_action', 'replay_second_government_history'] as const;
const branch = [['craftsmanship', 22, ['code-of-laws']], ['foreign-trade', 24, ['code-of-laws']], ['early-empire', 30, ['foreign-trade']], ['state-workforce', 40, ['craftsmanship', 'early-empire']], ['political-philosophy', 48, ['state-workforce', 'foreign-trade']]] as const;
const q = (value: number): number => Math.round(value * 100) / 100;
function must<T>(value: T | null | undefined): T { assert.ok(value !== null && value !== undefined); return value; }
function actor(state: WorldState) { return must(state.civilizations.find(candidate => candidate.id === 0)); }
function city(state: WorldState, id: string) { return must(state.cities.find(candidate => candidate.id === id)); }
function time(state: WorldState): string { return coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ((state.independentTurns?.lastActionWindow[0] ?? -1) + 1) * 10)); }
function command(state: WorldState, action: GameAction): TransitionResult { return applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp: time(state), action }); }
function beat(state: WorldState): TransitionResult { const result = catchUpStrategy(state, coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60)); assert.ok(result.ok, result.error); return result; }
function science(state: WorldState) { const civ = actor(state); return { stock: civ.resources.science, technologies: civ.technologies, target: civ.researchTarget, progress: civ.researchProgress, completion: civ.lastResearchCompletion }; }
function production(result: TransitionResult, resource: string): number { return Number(must(result.events.find(event => event.type === 'settlement-production' && event.actor === 0)?.effects.find(effect => effect.endsWith(` ${resource}`))).split(' ')[1]); }
function fixedPayments(result: TransitionResult) { return { operations: result.state.cities.map(town => Object.entries(town.buildingOperations ?? {}).map(([id, operation]) => ({ id, paid: operation.lastResult?.paid, strategicPaid: operation.lastResult?.strategicPaid, residents: operation.lastResult?.residents, localPower: operation.lastResult?.localPower, emissions: operation.lastResult?.emissionsProduced }))), extraction: result.events.flatMap(event => event.strategicExtraction ? [event.strategicExtraction] : []), transfers: result.events.filter(event => /trade|shipment|public-project/.test(event.type)) }; }
function outputAmounts(state: WorldState, multiplier: number): Resources {
  const copy = structuredClone(state); allocateOperations(copy); const amounts: Resources = { food: 0, materials: 0, energy: 0, credits: 0, science: 0, culture: 0 };
  for (const town of copy.cities.filter(candidate => candidate.civId === 0)) {
    const buildings = productiveBuildings(copy, town); const free = buildings.filter(building => !paidRecipe(building)); const paid = buildings.filter(paidRecipe);
    const terrain = siteProduction(copy, must(copy.tiles.find(tile => tile.id === town.tileId))); const focus: Partial<Resources> = ECONOMY_RULES.focusProduction[town.focus];
    const improvements = orderedImprovements(town).filter(item => item.operation.lastResult?.status === 'operated');
    for (const resource of RESOURCE_IDS) {
      const raw = (ECONOMY_RULES.baseProduction[resource] ?? 0) + (governmentModifiers(copy, 0).baseProduction[resource] ?? 0) + (focus[resource] ?? 0) + (terrain[resource] ?? 0) + (wonderBaseProduction(copy, town)[resource] ?? 0) + free.reduce((sum, building) => sum + (buildingBaseProduction(copy, town, building)[resource] ?? 0), 0) + paid.reduce((sum, building) => sum + (building.production[resource] ?? 0), 0) + improvements.reduce((sum, improvement) => sum + (IMPROVEMENTS.find(definition => definition.id === improvement.improvementId)?.production[resource] ?? 0), 0);
      amounts[resource] = q(amounts[resource] + q(raw * cityProductivity(town) * multiplier));
    }
  }
  return amounts;
}

export class SecondGovernmentProbe {
  private path: ReturnType<typeof secondGovernmentJourney> | null = null;
  private state: WorldState | null = null;
  private before: WorldState | null = null;
  private result: TransitionResult | null = null;
  private control: TransitionResult | null = null;
  private operation = '';
  private predicates: Record<string, boolean | number> = {};
  private replayedFrames = 0;
  private controls = 0;
  private transition: TransitionResult[] = [];
  private fixedControls: Array<{ actual: TransitionResult; normal: TransitionResult }> = [];
  reset(): void { this.state = null; this.before = null; this.result = null; this.control = null; this.operation = ''; this.predicates = {}; this.replayedFrames = 0; this.controls = 0; this.transition = []; this.fixedControls = []; }
  snapshot() { return structuredClone({ state: this.state, before: this.before, result: this.result, control: this.control, operation: this.operation, predicates: this.predicates, replayedFrames: this.replayedFrames, controls: this.controls, transition: this.transition, fixedControls: this.fixedControls }); }
  observe() { return { initialized: this.state !== null, ...this.predicates, replayed_frames: this.replayedFrames, controls: this.controls, provenance: 'Synthetic named fresh-rule prerequisites followed by actual paid five-civic actions; detached synthetic paid institutions/stocks, actual trade consent and government switches, malformed-state and generic pending-civic controls' }; }
  private getPath() { this.path ??= secondGovernmentJourney(); return this.path; }
  private step(state: WorldState): CoastalPrefixStep { return must(this.getPath().steps.find(step => step.result.state.revision === state.revision)); }
  private select(state: WorldState): void { const step = this.step(state); this.before = structuredClone(step.before); this.result = replayCoastalStep(this.before, structuredClone(step.input)); assert.deepEqual(this.before, step.before); assert.deepEqual(this.result, step.result); assert.ok(this.result.ok, this.result.error); assert.ok(isWorldState(this.result.state)); this.state = this.result.state; }
  call(action: string): void {
    if (!SECOND_GOVERNMENT_ACTIONS.some(candidate => candidate === action)) throw new RangeError(`Unknown second-government action ${action}`);
    this.operation = action; this.predicates = {}; this.control = null; this.replayedFrames = 0; this.controls = 0; this.transition = []; this.fixedControls = [];
    if (action === 'complete_second_government_civics') this.civics();
    if (action === 'choose_second_government') this.choose();
    if (action === 'work_in_original_capital') this.work();
    if (action === 'resolve_real_government_change') this.switch();
    if (action === 'retain_second_government_reform') this.retain();
    if (action === 'refuse_second_government_action') this.refuse();
    if (action === 'replay_second_government_history') this.replay();
  }
  private civics(): void {
    const path = this.getPath(); this.select(path.completed);
    let selected = true; let snapshots = true; let current = true; let conserved = true; let independent = true; let noSuccessor = true; let noEra = true;
    for (const frame of path.civicFrames) {
      const selection = this.step(frame.selected); const active = must(actor(frame.selected).civics?.active); const definition = must(CIVICS.find(civic => civic.id === frame.civicId));
      selected &&= selection.input.kind === 'action' && selection.input.command.action.type === 'choose-civic' && selection.input.command.action.civicId === frame.civicId && actor(selection.before).civics?.active === null;
      snapshots &&= active.requiredCulture === definition.cost && active.progress === 0 && equal(actor(selection.before).resources, actor(frame.selected).resources);
      const progress = must(path.steps.find(step => step.input.kind === 'strategy' && step.before.revision >= frame.selected.revision && step.result.state.revision <= frame.completed.revision));
      const idle = structuredClone(progress.before); must(actor(idle).civics).active = null; const control = replayCoastalStep(idle, progress.input); assert.ok(control.ok); const opening = must(actor(progress.before).civics?.active);
      const invested = q((actor(progress.result.state).civics?.active?.progress ?? opening.requiredCulture) - opening.progress); const expected = Math.min(production(control, 'culture'), actor(control.state).resources.culture, opening.requiredCulture - opening.progress);
      current &&= invested === expected && invested > 0 && actor(progress.before).resources.culture > invested;
      conserved &&= actor(progress.result.state).resources.culture === q(actor(control.state).resources.culture - invested); independent &&= equal(science(control.state), science(progress.result.state)) && equal(science(selection.before), science(frame.selected));
      noSuccessor &&= actor(frame.completed).civics?.active === null;
      const early = structuredClone(selection.before); actor(early).era = 0; noEra &&= civicActionBlock(early, 0, frame.civicId) === null && !Object.hasOwn(definition, 'minEra'); this.controls += 2;
    }
    this.predicates = { second_branch_prerequisites_exact: branch.every(([id, cost, requires]) => { const definition = CIVICS.find(civic => civic.id === id); return definition?.cost === cost && equal(definition.requires, requires); }), second_code_of_laws_cost: must(CIVICS.find(civic => civic.id === 'code-of-laws')).cost, second_craftsmanship_cost: must(CIVICS.find(civic => civic.id === 'craftsmanship')).cost, second_foreign_trade_cost: must(CIVICS.find(civic => civic.id === 'foreign-trade')).cost, second_early_empire_cost: must(CIVICS.find(civic => civic.id === 'early-empire')).cost, second_state_workforce_cost: must(CIVICS.find(civic => civic.id === 'state-workforce')).cost, second_political_philosophy_cost: must(CIVICS.find(civic => civic.id === 'political-philosophy')).cost, selected_explicitly: selected, second_civic_progress_snapshots_exact: snapshots, current_culture_only: current, culture_conserved: conserved, science_independent: independent, successor_unselected: noSuccessor, second_no_new_era_gate: noEra };
  }
  private choose(): void {
    const path = this.getPath(); this.select(path.accepted); const definition = must(GOVERNMENTS.find(government => government.id === 'autocracy'));
    const fresh = structuredClone(path.completed); must(actor(fresh).government).active = null; const first = command(fresh, { type: 'adopt-government', governmentId: 'autocracy', assignments: [] }); assert.ok(first.ok, first.error); const active = must(actor(first.state).government?.active);
    const duplicate = governmentActionBlock(path.completed, 0, 'autocracy', [{ slotType: 'economic', slotIndex: 0, policyId: 'urban-planning' }, { slotType: 'wildcard', slotIndex: 0, policyId: 'urban-planning' }]);
    const entitlement = must(actor(path.completed).civics?.reformEntitlement); const pending = must(actor(path.accepted).government?.pending); const lock = command(path.transitionCompleted, { type: 'adopt-government', governmentId: 'autocracy', assignments: [] });
    this.control = first; this.controls += 3;
    this.predicates = { second_final_civic_actual: actor(path.completed).civics?.lastCompleted?.civicId === 'political-philosophy' && path.civicFrames.every(frame => this.step(frame.completed).result.events.some(event => event.type === 'civic-completed' && event.actor === 0)), second_military_slots: definition.slots.military, second_economic_slots: definition.slots.economic, second_diplomatic_slots: definition.slots.diplomatic, second_wildcard_slots: definition.slots.wildcard, second_unique_policy_assignments: duplicate?.includes('only once') === true && governmentActionBlock(path.completed, 0, 'autocracy', [{ slotType: 'wildcard', slotIndex: 0, policyId: 'urban-planning' }]) === null, second_empty_slots_legal: governmentActionBlock(path.completed, 0, 'autocracy', []) === null, second_no_unimplemented_choices: equal(GOVERNMENTS.map(government => government.id), ['chiefdom', 'autocracy']) && equal(POLICIES.map(policy => policy.id), ['urban-planning']), second_initial_adoption_exact: active.governmentId === 'autocracy' && active.effectiveRound === fresh.round && actor(first.state).government?.pending === null && first.state.round === fresh.round && equal(first.state.cities, fresh.cities), second_change_credit_price: governmentPrice(path.beforeReturn, 0, 'chiefdom').credits, second_reslot_credit_price: governmentPrice(path.beforeReslot, 0, 'autocracy').credits, second_entitlement_price_exact: pending.paidCredits === 0 && pending.spentCompletionEventId === entitlement.completionEventId && actor(path.accepted).government?.lastSpentReformCompletionEventId === entitlement.completionEventId && actor(path.accepted).civics?.reformEntitlement === null, second_commitment_beats: active.policyLockUntilRound - active.effectiveRound, second_commitment_enforced: !lock.ok && /commitment/.test(governmentActionBlock(path.transitionCompleted, 0, 'autocracy', []) ?? '') && equal(lock.state, path.transitionCompleted) && must(actor(path.transitionCompleted).government?.active).governmentLockUntilRound === path.transitionCompleted.round + 4, payment_exact: actor(path.accepted).resources.credits === actor(path.completed).resources.credits && actor(path.beforeReslot).resources.credits - actor(path.reslotted).resources.credits === 8 && actor(path.beforeReturn).resources.credits - actor(path.returnAccepted).resources.credits === 10 };
  }
  private work(): void {
    const path = this.getPath(); this.select(path.firstWorkBeat); const capital = city(path.constructionStarted, path.cityId); const order = must(capital.construction?.active); const progressed = must(city(path.firstWorkBeat, path.cityId).construction?.active);
    const control = structuredClone(path.constructionStarted); must(actor(control).government?.active).governmentId = 'chiefdom'; this.control = beat(control);
    const synthetic = structuredClone(path.constructionStarted); const rounding = city(synthetic, path.cityId); rounding.focus = 'growth'; rounding.wellbeing = 71.7; rounding.infrastructure = 0; rounding.damage = 0;
    const raw = (CONSTRUCTION_RULES.baseWork + 1) * cityProductivity(rounding); const expected = q(raw * 1.15);
    const common = { id: order.id, cityId: capital.id, ruleVersion: 1 as const, startedRound: synthetic.round, paid: { materials: 3 }, workRequired: 20, workDone: 0 };
    const variants: ConstructionOrder[] = [{ ...common, buildingId: 'granary' }, { ...common, kind: 'improvement', improvementId: 'mine', tileId: 1 }, { ...common, kind: 'wonder', wonderId: 'great-library', tileId: 1 }, { ...common, kind: 'rail', edgeId: '1:2', tileId: 1, toTileId: 2, strategicPaid: { iron: 1 } }];
    const families = variants.every(variant => { rounding.construction = { active: variant, lastCompleted: null }; return openingConstructionWork(synthetic).get(capital.id) === expected; });
    const other = structuredClone(rounding); other.id = 'synthetic-noncapital'; synthetic.cities.unshift(other); const noncapital = constructionWork(synthetic, other) === q(raw); const observed = observedGovernment(path.constructionStarted, 0);
    const missing = structuredClone(path.constructionStarted); city(missing, path.cityId).civId = 1; const lost = observedGovernment(missing, 0).originalCapitalCityId === null;
    const immutable = (value: ConstructionOrder) => { const copy = structuredClone(value); Reflect.deleteProperty(copy, 'workDone'); return copy; };
    const lastStep = this.step(path.built); const idle = structuredClone(lastStep.before); must(city(idle, path.cityId).construction).active = null; const withoutCompletion = replayCoastalStep(idle, lastStep.input); assert.ok(withoutCompletion.ok);
    const actual = must(this.result); const baseline = must(this.control); const foodDifference = q(path.constructionStarted.cities.filter(town => town.civId === 0).reduce((sum, town) => sum + cityProductivity(town), 0));
    this.controls += 10;
    this.predicates = { second_original_capital_owned: observed.originalCapitalCityId === `city-${path.seat}` && capital.civId === path.seat && lost, second_four_work_families: families, second_capital_bonus_percent: observed.modifiers.capitalConstructionWorkPercent, second_opening_modifier_order_exact: constructionWork(synthetic, rounding) === expected && constructionWork(path.constructionStarted, capital) === q(((capital.focus === 'industry' ? CONSTRUCTION_RULES.industryWork : CONSTRUCTION_RULES.baseWork) + 1) * cityProductivity(capital) * 1.15), second_single_final_rounding: expected !== q(q(raw) * 1.15) && constructionWork(synthetic, rounding) === expected, second_current_projection_exact: observed.government?.active?.governmentId === 'autocracy' && observed.modifiers.constructionWork === 1 && observed.modifiers.capitalConstructionWorkPercent === 15, second_existing_order_snapshots_preserved: equal(immutable(order), immutable(progressed)) && equal(city(path.built, path.cityId).construction?.lastCompleted?.paid, order.paid), second_future_work_only: order.workDone === 0 && progressed.workDone === constructionWork(path.constructionStarted, capital) && equal(path.completed.cities, path.accepted.cities), completion_before_output: equal(lastStep.result.state.civilizations.map(civ => civ.resources), withoutCompletion.state.civilizations.map(civ => civ.resources)) && city(path.built, path.cityId).buildings.includes('theater-square'), second_historical_work_not_relabelled: equal(path.completed.cities.map(town => town.construction?.lastCompleted), path.accepted.cities.map(town => town.construction?.lastCompleted)) && !Object.hasOwn(must(city(path.built, path.cityId).construction?.lastCompleted), 'governmentId'), second_chiefdom_food_tradeoff_exact: q(production(baseline, 'food') - production(actual, 'food')) === foodDifference && equal(governmentModifiers(control, 0).baseProduction, { food: 1 }) && equal(observed.modifiers.baseProduction, {}), second_noncapital_work_unchanged: noncapital && path.constructionStarted.cities.filter(town => town.civId === 0 && town.id !== path.cityId).every(town => constructionWork(path.constructionStarted, town) === constructionWork(control, town)), second_fixed_charters_unchanged: this.charter(), second_other_ordinary_outputs_and_power_unchanged: RESOURCE_IDS.filter(resource => resource !== 'food').every(resource => actor(actual.state).resources[resource] === actor(baseline.state).resources[resource]) && equal(fixedPayments(actual), fixedPayments(baseline)) && this.fixedOperationControl(path.completed, 'autocracy').arrangement };
  }
  private fixedOperationControl(basis: WorldState, target: 'chiefdom' | 'autocracy'): { transition: boolean; arrangement: boolean } {
    let state = structuredClone(basis); const capital = city(state, 'city-0');
    actor(state).era = 3; capital.population = 24;
    syntheticTechnologies(state, 0, ['industrialization', 'printing']);
    for (const buildingId of ['industrial-zone', 'printing-house', 'coal-plant', 'factory']) if (!capital.buildings.includes(buildingId)) syntheticInstitution(state, capital.id, buildingId);
    for (const definition of BUILDINGS.filter(building => capital.buildings.includes(building.id))) initializeLocalPower(state, capital, definition);
    for (const civilization of state.civilizations) for (const resource of RESOURCE_IDS) civilization.resources[resource] = Math.max(civilization.resources[resource], 200);
    actor(state).strategicResources = { ...actor(state).strategicResources, coal: 100 };
    assert.ok(isWorldState(state), 'Detached fixed-economic prerequisites must be canonical');
    const proposal = must(legalActions(state, 0, time(state)).find(option => option.action.type === 'propose-trade' && option.action.recipeId === 'harvest-for-materials'));
    const proposed = command(state, proposal.action); assert.ok(proposed.ok, proposed.error); state = proposed.state;
    const offer = must(state.tradeOffers?.find(candidate => candidate.proposer === 0 && candidate.status === 'pending'));
    const consented = applyCommand(state, { seat: offer.recipient, expectedRevision: state.revision, timestamp: time(state), action: { type: 'respond-trade', offerId: offer.id, accept: true } }); assert.ok(consented.ok, consented.error); state = consented.state;
    const due = must(state.routes.find(route => route.agreement?.offerId === offer.id)?.agreement).nextDeliveryRound;
    for (let count = 0; state.round < due - 1 && count < 60; count++) state = beat(state).state;
    assert.equal(state.round, due - 1);
    const accepted = command(state, { type: 'adopt-government', governmentId: target, assignments: [{ slotType: 'economic', slotIndex: 0, policyId: 'urban-planning' }] }); assert.ok(accepted.ok, accepted.error); state = accepted.state;
    const nonzero = (result: TransitionResult): boolean => {
      const operations = city(result.state, 'city-0').buildingOperations; const plant = operations?.['coal-plant']?.lastResult; const factory = operations?.factory?.lastResult;
      return operations?.['printing-house']?.lastResult?.paid.materials === 1 && plant?.strategicPaid?.coal === 2 && plant.localPower?.generated === 8 && plant.emissionsProduced === 4 && factory?.localPower?.consumed === 3 && factory.residents?.allocated === 3;
    };
    let transition = true;
    for (let count = 0; count < 2; count++) {
      const idle = structuredClone(state); must(actor(idle).government).pending = null;
      const actual = beat(state); const normal = beat(idle); this.fixedControls.push({ actual, normal }); this.controls++;
      transition &&= nonzero(actual) && equal(fixedPayments(actual), fixedPayments(normal)) && (count !== 0 || actual.events.some(event => event.type === 'trade-delivered'));
      state = actual.state;
    }
    const other = structuredClone(state); must(actor(other).government?.active).governmentId = target === 'autocracy' ? 'chiefdom' : 'autocracy';
    const actual = beat(state); const normal = beat(other); this.fixedControls.push({ actual, normal }); this.controls++;
    const arrangement = nonzero(actual) && equal(fixedPayments(actual), fixedPayments(normal)) && RESOURCE_IDS.filter(resource => resource !== 'food').every(resource => actor(actual.state).resources[resource] === actor(normal.state).resources[resource]);
    return { transition, arrangement };
  }
  private charter(): boolean {
    let base = structuredClone(this.getPath().constructionStarted);
    const recipe = must(PUBLIC_PROJECT_RECIPES[0]);
    if (!base.routes.some(candidate => candidate.agreement?.enabled)) {
      base = beat(base).state;
      const proposal = must(legalActions(base, 0, time(base)).find(option => option.action.type === 'propose-trade' && option.action.recipeId === 'harvest-for-materials'));
      assert.ok(proposal.action.type === 'propose-trade');
      const proposed = command(base, proposal.action); assert.ok(proposed.ok, proposed.error); base = proposed.state;
      const offer = must(base.tradeOffers?.find(candidate => candidate.proposer === 0 && candidate.status === 'pending'));
      const consented = applyCommand(base, { seat: offer.recipient, expectedRevision: base.revision, timestamp: time(base), action: { type: 'respond-trade', offerId: offer.id, accept: true } });
      assert.ok(consented.ok, consented.error); base = consented.state;
    }
    const route = must(base.routes.find(candidate => candidate.agreement?.enabled));
    for (const seat of [route.owner, route.partner]) { const civ = must(base.civilizations.find(candidate => candidate.id === seat)); if (!civ.technologies.includes(recipe.requiredTechnology)) civ.technologies.push(recipe.requiredTechnology); const town = must(base.cities.find(candidate => candidate.civId === seat)); if (!town.buildings.includes(recipe.requiredBuilding)) town.buildings.push(recipe.requiredBuilding); for (const resource of RESOURCE_IDS) civ.resources[resource] = Math.max(civ.resources[resource], 100); }
    route.damage = 50; base.publicProjects = [{ id: 'synthetic-fixed-charter', routeId: route.id, agreementOfferId: must(route.agreement).offerId, proposer: route.owner, recipient: route.partner, terms: structuredClone(recipe.terms), proposedRound: base.round, status: 'committed', acceptedRound: base.round, dueRound: base.round + recipe.terms.completionDelayRounds }];
    const untouched = structuredClone(base.publicProjects); const waitingEvents: GameEvent[] = []; resolvePublicProjects(base, waitingEvents); const waiting = equal(base.publicProjects, untouched) && waitingEvents.length === 0;
    base.round += recipe.terms.completionDelayRounds; const other = structuredClone(base); must(actor(other).government?.active).governmentId = 'chiefdom'; const a: GameEvent[] = []; const b: GameEvent[] = []; resolvePublicProjects(base, a); resolvePublicProjects(other, b); this.controls += 2;
    return waiting && a.some(event => event.publicProjectResult?.outcome === 'completed') && equal(a, b) && equal(base.routes, other.routes) && equal(base.civilizations.map(civ => civ.resources), other.civilizations.map(civ => civ.resources));
  }
  private switch(): void {
    const path = this.getPath(); this.select(path.transitionCompleted); const pending = must(actor(path.accepted).government?.pending); const first = this.step(path.firstTransitionBeat).result; const second = this.step(path.transitionCompleted).result;
    let outputs = true; let fixed = true;
    for (const step of [this.step(path.firstTransitionBeat), this.step(path.transitionCompleted), this.step(path.returnFirstBeat), this.step(path.returned)]) {
      const idle = structuredClone(step.before); must(actor(idle).government).pending = null; const normal = replayCoastalStep(idle, step.input); assert.ok(normal.ok); const opening = structuredClone(step.before); opening.round++;
      const full = outputAmounts(opening, 1); const reduced = outputAmounts(opening, 0.75);
      outputs &&= RESOURCE_IDS.every(resource => q(actor(normal.state).resources[resource] - actor(step.result.state).resources[resource]) === q(full[resource] - reduced[resource])); fixed &&= equal(fixedPayments(normal), fixedPayments(step.result)); this.controls++;
    }
    const oldWork = constructionWork(path.returnAccepted, city(path.returnAccepted, path.cityId)); const retainedWork = constructionWork(path.returnFirstBeat, city(path.returnFirstBeat, path.cityId)); const nextWork = constructionWork(path.returned, city(path.returned, path.cityId));
    const initialWork = constructionWork(path.accepted, city(path.accepted, path.cityId)); const delayedWork = constructionWork(path.firstTransitionBeat, city(path.firstTransitionBeat, path.cityId)); const newWork = constructionWork(path.transitionCompleted, city(path.transitionCompleted, path.cityId));
    this.transition = [this.step(path.accepted).result, first, second, this.step(path.returnAccepted).result, this.step(path.returnFirstBeat).result, this.step(path.returned).result];
    this.predicates = { second_real_transition: pending.targetGovernmentId === 'autocracy' && actor(path.returnAccepted).government?.pending?.targetGovernmentId === 'chiefdom', second_transition_beats: pending.completionRound - pending.acceptedRound, second_transition_output_percent: Math.round(CIVIC_RULES.transitionOutput * 100), second_old_arrangement_openings_exact: outputs && actor(first.state).government?.active?.governmentId === 'chiefdom' && actor(second.state).government?.active?.governmentId === 'autocracy' && actor(second.state).government?.pending === null && first.state.round === path.accepted.round + 1 && second.state.round === path.accepted.round + 2, second_target_starts_next_opening: initialWork === delayedWork && newWork > delayedWork && second.events.filter(event => event.type === 'transition-completed' && event.actor === 0).length === 1, second_commitment_enforced: must(actor(second.state).government?.active).policyLockUntilRound === second.state.round + 4 && !!governmentActionBlock(second.state, 0, 'chiefdom', []), second_outgoing_capital_bonus_retained: oldWork === retainedWork && nextWork < retainedWork && actor(path.returnFirstBeat).government?.active?.governmentId === 'autocracy', second_transition_fixed_payments_preserved: fixed && this.fixedOperationControl(path.completed, 'autocracy').transition && this.fixedOperationControl(path.beforeReturn, 'chiefdom').transition, second_fixed_charters_unchanged: this.charter() };
  }
  private retain(): void {
    const path = this.getPath(); this.select(path.returned); const entitlement = must(actor(path.completed).civics?.reformEntitlement); const marker = entitlement.completionEventId;
    let replaces = true; let previousId: string | undefined;
    for (const frame of path.civicFrames) { const latest = must(actor(frame.completed).civics); replaces &&= latest.reformEntitlement?.completionEventId === latest.lastCompleted?.eventId && latest.reformEntitlement?.civicId === frame.civicId && latest.reformEntitlement?.completionEventId !== previousId; previousId = latest.reformEntitlement?.completionEventId; }
    let pruned = structuredClone(path.returned); for (let index = 0; index < 8 && pruned.events.some(event => event.id === marker); index++) pruned = beat(pruned).state;
    const restored = structuredClone(pruned); must(actor(restored).civics).reformEntitlement = structuredClone(entitlement);
    const malformed = structuredClone(path.completed); const event = must(malformed.events.find(candidate => candidate.id === marker)); event.actor = 4;
    const pendingBase = structuredClone(path.accepted); const pending = structuredClone(must(actor(pendingBase).government?.pending));
    CIVICS.push({ id: 'synthetic-pending-civic', name: 'Synthetic pending completion control', requiredFeatures: ['civic-bootstrap'], requires: ['political-philosophy'], cost: 1, capability: 'Generic timing control only' });
    let during = false;
    try { const selected = command(pendingBase, { type: 'choose-civic', civicId: 'synthetic-pending-civic' }); assert.ok(selected.ok, selected.error); const advanced = beat(selected.state); during = actor(advanced.state).civics?.lastCompleted?.civicId === 'synthetic-pending-civic' && actor(advanced.state).civics?.reformEntitlement?.completionEventId !== marker && equal(actor(advanced.state).government?.pending, pending) && actor(advanced.state).government?.lastSpentReformCompletionEventId === marker && isWorldState(advanced.state); } finally { CIVICS.pop(); }
    this.controls += 4;
    this.predicates = { second_latest_entitlement_replaces: replaces, second_consumed_marker_preserved: [path.accepted, path.transitionCompleted, path.reslotted, path.returnAccepted, path.returned, pruned].every(state => actor(state).government?.lastSpentReformCompletionEventId === marker), second_pending_completion_entitlement_preserved: during, second_pruned_entitlement_cannot_reinstate: !pruned.events.some(candidate => candidate.id === marker) && isWorldState(pruned) && !isWorldState(restored) && !!governmentActionBlock(restored, 0, 'autocracy', []), second_retained_events_cross_checked: isWorldState(path.completed) && !isWorldState(malformed) };
  }
  private refuse(): void {
    const path = this.getPath(); this.select(path.completed);
    const unavailable = structuredClone(path.initial); unavailable.unlockedFeatures = unavailable.unlockedFeatures.filter(feature => feature !== 'second-government');
    const controls: Array<[WorldState, GameAction, RegExp]> = [
      [unavailable, { type: 'choose-civic', civicId: 'craftsmanship' }, /not released/],
      [path.prepared, { type: 'choose-civic', civicId: 'political-philosophy' }, /Missing completed civics/],
      [path.prepared, { type: 'adopt-government', governmentId: 'autocracy', assignments: [] }, /completed civics/],
      [path.completed, { type: 'adopt-government', governmentId: 'autocracy', assignments: [{ slotType: 'economic', slotIndex: 1, policyId: 'urban-planning' }] }, /slot does not exist/],
      [path.completed, { type: 'adopt-government', governmentId: 'autocracy', assignments: [{ slotType: 'military', slotIndex: 0, policyId: 'urban-planning' }] }, /incompatible/],
      [path.completed, { type: 'adopt-government', governmentId: 'autocracy', assignments: [{ slotType: 'economic', slotIndex: 0, policyId: 'urban-planning' }, { slotType: 'wildcard', slotIndex: 0, policyId: 'urban-planning' }] }, /only once/],
      [path.accepted, { type: 'adopt-government', governmentId: 'autocracy', assignments: [] }, /transition must finish/],
      [path.transitionCompleted, { type: 'adopt-government', governmentId: 'chiefdom', assignments: [] }, /commitment/],
      [path.completed, { type: 'adopt-government', governmentId: 'democracy', assignments: [] }, /completed civics/],
    ];
    const poor = structuredClone(path.beforeReturn); actor(poor).resources.credits = 9; controls.push([poor, { type: 'adopt-government', governmentId: 'chiefdom', assignments: [] }, /Insufficient Credits/]);
    const stale = structuredClone(path.beforeReturn); must(actor(stale).civics).reformEntitlement = structuredClone(must(actor(path.completed).civics?.reformEntitlement)); controls.push([stale, { type: 'adopt-government', governmentId: 'chiefdom', assignments: [] }, /latest actual civic completion/]);
    let refuse = true; let zero = true;
    for (const [state, action, reason] of controls) { const before = structuredClone(state); const result = command(state, action); const blocker = action.type === 'choose-civic' ? civicActionBlock(state, 0, action.civicId) : action.type === 'adopt-government' ? governmentActionBlock(state, 0, action.governmentId, action.assignments) : null; refuse &&= !result.ok && reason.test(blocker ?? ''); zero &&= equal(result.state, before) && equal(state, before) && result.events.length === 0; this.controls++; }
    const staleRevision = applyCommand(path.completed, { seat: 0, expectedRevision: path.completed.revision - 1, timestamp: time(path.completed), action: { type: 'adopt-government', governmentId: 'autocracy', assignments: [] } });
    this.control = staleRevision; this.controls++;
    this.predicates = { second_refusals_discriminate: refuse && !staleRevision.ok && /revision/i.test(staleRevision.error ?? ''), second_zero_effect_refusals: zero && equal(staleRevision.state, path.completed) && staleRevision.events.length === 0, second_no_unimplemented_choices: equal(GOVERNMENTS.map(government => government.id), ['chiefdom', 'autocracy']) && equal(POLICIES.map(policy => policy.id), ['urban-planning']) };
  }
  private replay(): void {
    const path = this.getPath(); this.before = structuredClone(path.initial); let state = structuredClone(path.initial); let snapshots = true;
    for (const step of path.steps) { assert.deepEqual(state, step.before); const retained = structuredClone(state); const result = replayCoastalStep(state, structuredClone(step.input)); assert.deepEqual(state, retained); assert.deepEqual(result, step.result); assert.ok(result.ok, result.error); assert.ok(isWorldState(result.state), `Invalid government replay frame ${result.state.revision}`); snapshots &&= equal(result.state.civilizations.map(civ => ({ civics: civ.civics, government: civ.government })), step.result.state.civilizations.map(civ => ({ civics: civ.civics, government: civ.government }))); state = result.state; this.result = result; this.replayedFrames++; }
    this.state = state; const capital = city(path.constructionStarted, path.cityId); const order = must(capital.construction?.active); const control = structuredClone(path.constructionStarted); must(actor(control).government?.active).governmentId = 'chiefdom';
    this.predicates = { second_current_paid_civic_sequence: path.civicFrames.length === 5 && path.steps.filter(step => step.before.revision >= path.prepared.revision && step.input.kind === 'action' && step.input.command.action.type === 'choose-civic').length === 5, second_real_transition: actor(path.firstTransitionBeat).government?.active?.governmentId === 'chiefdom' && actor(path.transitionCompleted).government?.active?.governmentId === 'autocracy', second_actual_paid_capital_consequence: constructionWork(path.constructionStarted, capital) > constructionWork(control, capital) && Object.values(order.paid).some(amount => amount > 0) && RESOURCE_IDS.every(resource => q(actor(this.step(path.constructionStarted).before).resources[resource] - actor(path.constructionStarted).resources[resource]) === (order.paid[resource] ?? 0)) && city(path.firstWorkBeat, path.cityId).construction?.active?.workDone === constructionWork(path.constructionStarted, capital) && city(path.built, path.cityId).construction?.lastCompleted?.orderId === order.id, second_replay_exact: equal(state, path.returned) && this.replayedFrames === path.steps.length, second_pending_and_completed_snapshots_exact: snapshots, second_consumed_marker_preserved: actor(state).government?.lastSpentReformCompletionEventId === actor(path.completed).civics?.lastCompleted?.eventId };
  }
}
