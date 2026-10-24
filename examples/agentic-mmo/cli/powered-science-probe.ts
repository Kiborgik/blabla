import assert from 'node:assert/strict';
import { isDeepStrictEqual as equal } from 'node:util';
import { BUILDINGS, TECHNOLOGIES, RESOURCE_IDS, CONSTRUCTION_RULES } from '../core/content.ts';
import { applyCommand, createWorld } from '../core/engine.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import { extractCityMetals } from '../core/simulation/metals.ts';
import { isWorldState } from '../core/validation.ts';
import type { BuildingOperationResult, GameAction, TransitionResult, WorldState } from '../core/types.ts';
import { poweredScienceJourney } from '../tests/fixtures/powered-science-journey.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixStep } from '../tests/fixtures/coastal-prefix.ts';

export const POWERED_SCIENCE_ACTIONS = ['research_powered_science', 'construct_research_laboratory', 'operate_research_laboratory', 'fund_laboratory_research', 'retain_laboratory_history', 'refuse_powered_science', 'replay_powered_science'] as const;
const q = (value: number): number => Math.round(value * 100) / 100;
function town(state: WorldState, id: string) { const found = state.cities.find(city => city.id === id); assert.ok(found); return found; }
function actor(state: WorldState, seat: number) { const found = state.civilizations.find(civilization => civilization.id === seat); assert.ok(found); return found; }
function time(state: WorldState): string { return coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(civilization => ((state.independentTurns?.lastActionWindow[civilization.id] ?? -1) + 1) * 10))); }
function command(state: WorldState, seat: number, action: GameAction) { return applyCommand(state, { seat, expectedRevision: state.revision, timestamp: time(state), action }); }
function empty(result: BuildingOperationResult | null | undefined): boolean { return !!result && equal(result.paid, {}) && equal(result.strategicPaid, {}) && equal(result.produced, {}) && result.residents?.allocated === 0 && result.localPower?.consumed === 0 && result.localPower.generated === 0 && result.emissionsProduced === 0; }
function science(result: TransitionResult, seat: number): number { return result.events.filter(event => event.type === 'settlement-production' && event.actor === seat).reduce((sum, event) => sum + event.effects.reduce((value, effect) => value + Number(effect.match(/^Produced ([\d.]+) science$/)?.[1] ?? 0), 0), 0); }

export class PoweredScienceProbe {
  private path: ReturnType<typeof poweredScienceJourney> | null = null;
  private state: WorldState | null = null;
  private predicates: Record<string, boolean | number> = {};
  private controls = 0;
  private replayedFrames = 0;
  private getPath() { this.path ??= poweredScienceJourney(); return this.path; }
  private step(state: WorldState): CoastalPrefixStep { const found = this.getPath().steps.find(step => step.result.state.revision === state.revision); assert.ok(found); return found; }
  private select(state: WorldState): void { const step = this.step(state); const before = structuredClone(step.before); const result = replayCoastalStep(before, step.input); assert.ok(result.ok, result.error); assert.deepEqual(before, step.before); assert.deepEqual(result, step.result); this.state = result.state; }
  reset(): void { this.state = null; this.predicates = {}; this.controls = 0; this.replayedFrames = 0; }
  snapshot() { return structuredClone({ state: this.state, predicates: this.predicates, controls: this.controls, replayedFrames: this.replayedFrames }); }
  observe() { return { initialized: this.state !== null, ...this.predicates, controls: this.controls, replayed_frames: this.replayedFrames, provenance: 'Synthetic named fresh-rule prerequisites followed by actual paid powered-Science actions; detached shortage, malformed-state and counterfactual controls are not live play' }; }
  call(action: string): void {
    if (!POWERED_SCIENCE_ACTIONS.some(item => item === action)) throw new RangeError(`Unknown powered Science action ${action}`);
    this.predicates = {}; this.controls = 0; this.replayedFrames = 0;
    if (action === 'research_powered_science') this.research();
    if (action === 'construct_research_laboratory') this.construct();
    if (action === 'operate_research_laboratory') this.operate();
    if (action === 'fund_laboratory_research') this.fund();
    if (action === 'retain_laboratory_history') this.retain();
    if (action === 'refuse_powered_science') this.refuse();
    if (action === 'replay_powered_science') this.replay();
  }
  private marginalOutput(state: WorldState, buildingId: 'factory' | 'research-lab', resource: 'materials' | 'science'): number {
    const path = this.getPath(); const step = this.step(state); const without = structuredClone(step.before);
    const operation = town(without, path.cityId).buildingOperations?.[buildingId]; assert.ok(operation); operation.enabled = false;
    const control = replayCoastalStep(without, step.input); assert.ok(control.ok, control.error); this.controls++;
    return resource === 'science' ? q(science(step.result, path.seat) - science(control, path.seat)) : q(actor(step.result.state, path.seat).resources.materials - actor(control.state, path.seat).resources.materials);
  }
  private research(): void {
    const path = this.getPath(); this.select(path.chemistryCompleted);
    const sanitation = TECHNOLOGIES.find(item => item.id === 'sanitation'); const chemistry = TECHNOLOGIES.find(item => item.id === 'chemistry'); assert.ok(sanitation && chemistry);
    let future = true; let explicit = true; let noEra = true;
    for (const [selected, completed, definition] of [[path.sanitationSelected, path.sanitationCompleted, sanitation], [path.chemistrySelected, path.chemistryCompleted, chemistry]] as const) {
      const choice = this.step(selected); explicit &&= choice.input.kind === 'action' && choice.input.command.action.type === 'research' && choice.input.command.action.technology === definition.id && equal(actor(choice.before, path.seat).resources, actor(selected, path.seat).resources) && actor(completed, path.seat).researchTarget === '';
      for (const step of path.steps.filter(candidate => candidate.input.kind === 'strategy' && actor(candidate.before, path.seat).researchTarget === definition.id)) {
        const before = actor(step.before, path.seat); const after = actor(step.result.state, path.seat); const invested = q(after.technologies.includes(definition.id) ? definition.cost - before.researchProgress : after.researchProgress - before.researchProgress);
        future &&= invested === Math.min(science(step.result, path.seat), q(before.resources.science + science(step.result, path.seat)), q(definition.cost - before.researchProgress)) && after.resources.science === q(before.resources.science + science(step.result, path.seat) - invested);
      }
      const earlier = structuredClone(choice.before); actor(earlier, path.seat).era = 0; noEra &&= command(earlier, path.seat, { type: 'research', technology: definition.id }).ok; this.controls++;
    }
    const unavailable = structuredClone(path.initial); unavailable.unlockedFeatures = unavailable.unlockedFeatures.filter(feature => feature !== 'powered-science');
    const old = command(unavailable, path.seat, { type: 'research', technology: 'sanitation' }); this.controls++;
    const prefix = structuredClone(path.chemistryCompleted); const ids = actor(prefix, path.seat).technologies; const s = ids.indexOf('sanitation'); const c = ids.indexOf('chemistry'); const sanitationId = ids[s]; const chemistryId = ids[c]; assert.ok(s >= 0 && c > s && sanitationId && chemistryId); [ids[s], ids[c]] = [chemistryId, sanitationId];
    const badActive = structuredClone(path.chemistrySelected); actor(badActive, path.seat).researchProgress = chemistry.cost;
    const noPrerequisite = structuredClone(path.sanitationSelected); actor(noPrerequisite, path.seat).technologies = actor(noPrerequisite, path.seat).technologies.filter(id => id !== 'education'); this.controls += 3;
    this.predicates = { sanitation_science_cost: sanitation.cost, chemistry_science_cost: chemistry.cost, powered_science_exact_prerequisites: equal(sanitation.requires, ['construction', 'education']) && equal(chemistry.requires, ['scientific-method', 'sanitation']), powered_science_release_required: !old.ok && equal(old.state, unavailable) && old.events.length === 0, powered_science_eras_are_metadata: noEra, powered_science_future_output_only: future, powered_science_explicit_target_only: explicit, powered_science_completion_prefix_validated: isWorldState(path.chemistryCompleted) && !isWorldState(prefix), powered_science_active_target_validated: isWorldState(path.chemistrySelected) && !isWorldState(badActive) && !isWorldState(noPrerequisite) };
  }
  private construct(): void {
    const path = this.getPath(); this.select(path.labCompleted); const lab = BUILDINGS.find(item => item.id === 'research-lab'); assert.ok(lab);
    const start = this.step(path.labStarted); const before = actor(start.before, path.seat); const after = actor(path.labStarted, path.seat); const order = town(path.labStarted, path.cityId).construction?.active; assert.ok(order && !('kind' in order));
    const lane = command(path.labStarted, path.seat, { type: 'build', cityId: path.cityId, project: 'research-lab' }); const duplicate = command(path.labCompleted, path.seat, { type: 'build', cityId: path.cityId, project: 'research-lab' }); this.controls += 2;
    this.predicates = { laboratory_materials_cost: lab.cost.materials ?? 0, laboratory_credits_cost: lab.cost.credits ?? 0, laboratory_required_work: order.workRequired, laboratory_minimum_era: lab.minEra, laboratory_exact_local_campus: equal(lab.requiresBuildings, ['campus']) && town(start.before, path.cityId).buildings.includes('campus'), laboratory_chemistry_and_feature_required: equal(lab.requires, ['chemistry']) && lab.requiredFeatures.includes('powered-science') && before.technologies.includes('chemistry'), laboratory_once_only_owned_town_commitment: town(start.before, path.cityId).civId === path.seat && RESOURCE_IDS.every(resource => q(before.resources[resource] - after.resources[resource]) === (lab.cost[resource] ?? 0)) && equal(order.paid, lab.cost) && Reflect.get(CONSTRUCTION_RULES.requiredWork, lab.id) === 18 && !lane.ok && equal(lane.state, path.labStarted) && !duplicate.ok && equal(duplicate.state, path.labCompleted), laboratory_first_output_after_installation: town(path.labCompleted, path.cityId).buildingOperations?.['research-lab']?.lastResult === null && (town(path.productive, path.cityId).buildingOperations?.['research-lab']?.lastResult?.round ?? 0) > path.labCompleted.round, laboratory_installed_null_result_valid: isWorldState(path.labCompleted) };
  }
  private operate(): void {
    const path = this.getPath(); this.select(path.productive); const proof = town(path.productive, path.cityId).localPower?.lastProductiveBeat; assert.ok(proof); const lab = proof.operations.find(item => item.buildingId === 'research-lab'); assert.ok(lab);
    let blocked = true; let noBorrowing = true;
    for (const kind of ['credits', 'residents', 'power', 'paused', 'other-town', 'carryover']) {
      const state = structuredClone(path.labCompleted); const city = town(state, path.cityId); const civilization = actor(state, path.seat); const operation = city.buildingOperations?.['research-lab']; const plant = city.buildingOperations?.['coal-plant']; assert.ok(operation && plant);
      civilization.resources.energy = 100000; civilization.strategicResources = { ...civilization.strategicResources, coal: 2 };
      if (kind === 'credits') civilization.resources.credits = 1;
      if (kind === 'residents') city.population = 9;
      if (kind === 'power' || kind === 'other-town' || kind === 'carryover') plant.enabled = false;
      if (kind === 'paused') operation.enabled = false;
      if (kind === 'carryover') { const ledger = town(path.productive, path.cityId).localPower; assert.ok(ledger); city.localPower = structuredClone(ledger); }
      if (kind === 'other-town') { const second = structuredClone(city); second.id = `${city.id}-synthetic-generator`; second.buildings = ['coal-plant']; second.buildingOperations = { 'coal-plant': { enabled: true, lastResult: null } }; second.improvements = {}; state.cities.push(second); }
      const credits = civilization.resources.credits; const energy = civilization.resources.energy; allocateOperations(state);
      blocked &&= operation.lastResult?.status !== 'operated' && empty(operation.lastResult) && civilization.resources.credits === credits;
      noBorrowing &&= civilization.resources.energy === energy && operation.lastResult?.localPower?.consumed === 0; this.controls++;
    }
    const later = structuredClone(path.labCompleted); actor(later, path.seat).strategicResources = { ...actor(later, path.seat).strategicResources, coal: 0 }; allocateOperations(later); for (const city of later.cities) extractCityMetals(later, city);
    const noRefuel = (actor(later, path.seat).strategicResources?.coal ?? 0) > 0 && empty(town(later, path.cityId).buildingOperations?.['research-lab']?.lastResult); this.controls++;
    const zero = structuredClone(path.labCompleted); town(zero, path.cityId).damage = 100; actor(zero, path.seat).strategicResources = { ...actor(zero, path.seat).strategicResources, coal: 2 }; zero.round++; zero.revision++; resolveEconomy(zero, []); const zeroTown = town(zero, path.cityId); const zeroLab = zeroTown.buildingOperations?.['research-lab']?.lastResult; this.controls++;
    this.predicates = { laboratory_power_input: lab.recipe.localPowerInput, laboratory_operating_credits: lab.recipe.inputs.credits ?? 0, laboratory_residents_required: lab.recipe.residentsRequired, laboratory_atomic_opening_allocation: equal(lab.result.paid, { credits: 2 }) && lab.result.localPower.consumed === 3 && lab.result.residents.allocated === 3 && lab.result.status === 'operated', laboratory_shortages_and_pause_pay_nothing: blocked, laboratory_no_cross_town_energy_or_carryover: noBorrowing, laboratory_no_same_beat_refuelling: noRefuel, laboratory_stable_existing_allocation_order: equal(proof.operations.map(item => item.buildingId), ['coal-plant', 'factory', 'research-lab']) && lab.result.localPower.availableBefore === 5 && lab.result.residents.available === proof.openingPopulation - proof.communityReserve - 6, laboratory_with_factory_power_generated: proof.generated, laboratory_with_factory_power_consumed: proof.consumed, laboratory_with_factory_power_expired: proof.expired, laboratory_power_and_emissions_unmodified: zeroLab?.status === 'operated' && equal(zeroLab.produced, {}) && zeroLab.localPower?.consumed === 3 && zeroTown.localPower?.lastBeat?.generated === 8 && zeroTown.localPower.lastBeat.operations[0]?.result.emissionsProduced === 4 };
  }
  private fund(): void {
    const path = this.getPath(); this.select(path.researchInvested); const step = this.step(path.researchInvested); const before = actor(step.before, path.seat); const after = actor(step.result.state, path.seat); const lab = town(step.result.state, path.cityId).buildingOperations?.['research-lab']?.lastResult; assert.ok(lab);
    const without = structuredClone(step.before); const operation = town(without, path.cityId).buildingOperations?.['research-lab']; assert.ok(operation); operation.enabled = false; const control = replayCoastalStep(without, step.input); assert.ok(control.ok);
    const difference = q(after.researchProgress - actor(control.state, path.seat).researchProgress); const produced = science(step.result, path.seat); const technology = TECHNOLOGIES.find(item => item.id === before.researchTarget); assert.ok(technology);
    const completing = structuredClone(step.before); actor(completing, path.seat).researchProgress = technology.cost - 1; const completed = replayCoastalStep(completing, step.input); assert.ok(completed.ok);
    const idle = structuredClone(step.before); actor(idle, path.seat).researchTarget = ''; actor(idle, path.seat).researchProgress = 0; const idleResult = replayCoastalStep(idle, step.input); assert.ok(idleResult.ok);
    const fractional = structuredClone(step.before); const fractionalTown = town(fractional, path.cityId); fractionalTown.wellbeing = 0.3; fractionalTown.infrastructure = 0; fractionalTown.damage = 0;
    const on = replayCoastalStep(fractional, step.input); assert.ok(on.ok); const off = structuredClone(fractional); const offLab = town(off, path.cityId).buildingOperations?.['research-lab']; assert.ok(offLab); offLab.enabled = false; const offResult = replayCoastalStep(off, step.input); assert.ok(offResult.ok);
    const actual = town(on.state, path.cityId).buildingOperations?.['research-lab']?.lastResult?.produced.science ?? 0;
    this.controls += 5;
    this.predicates = { laboratory_base_science: BUILDINGS.find(item => item.id === 'research-lab')?.production.science ?? 0, laboratory_exact_modified_science: lab.produced.science === q(produced - science(control, path.seat)) && actual === q(science(on, path.seat) - science(offResult, path.seat)), laboratory_same_beat_productive_research: before.researchTarget === 'banking' && difference === lab.produced.science && after.researchProgress === q(before.researchProgress + produced), laboratory_existing_research_caps: after.researchProgress - before.researchProgress === Math.min(produced, q(before.resources.science + produced), technology.cost - before.researchProgress) && actor(completed.state, path.seat).researchTarget === '' && actor(completed.state, path.seat).resources.science === q(actor(completing, path.seat).resources.science + science(completed, path.seat) - 1), powered_science_explicit_target_only: actor(path.researchSelected, path.seat).researchTarget === 'banking' && actor(idleResult.state, path.seat).researchTarget === '' && actor(idleResult.state, path.seat).researchProgress === 0, laboratory_completion_not_retroactive: equal(town(completed.state, path.cityId).buildingOperations, town(step.result.state, path.cityId).buildingOperations), laboratory_no_same_beat_refuelling: equal(town(completed.state, path.cityId).localPower, town(step.result.state, path.cityId).localPower) };
  }
  private retain(): void {
    const path = this.getPath(); this.select(path.pruned); const proof = town(path.productive, path.cityId).localPower?.lastProductiveBeat; assert.ok(proof); const lab = proof.operations.find(item => item.buildingId === 'research-lab'); assert.ok(lab);
    let rejects = true;
    for (const kind of ['recipe', 'paid', 'identity', 'event', 'conservation']) {
      const state = structuredClone(path.productive); const ledger = town(state, path.cityId).localPower; assert.ok(ledger?.lastBeat); const entry = ledger.lastBeat.operations.find(item => item.buildingId === 'research-lab'); assert.ok(entry);
      if (kind === 'recipe') entry.recipe.baseOutputs.science = 13;
      if (kind === 'paid') entry.result.paid.credits = 1;
      if (kind === 'identity') entry.buildingId = 'factory';
      if (kind === 'event') { const event = state.events.find(item => item.id === ledger.lastBeat?.eventId); assert.ok(event); event.actor = 4; }
      if (kind === 'conservation') ledger.lastBeat.expired++;
      rejects &&= !isWorldState(state); this.controls++;
    }
    const retained = town(path.pruned, path.cityId).localPower; const replacement = town(path.replacedByFactory, path.cityId).localPower?.lastProductiveBeat; assert.ok(retained && replacement);
    const installed = town(path.labCompleted, path.cityId); const old = installed.localPower?.lastBeat;
    this.predicates = { laboratory_exact_versioned_recipe_and_payment: equal(lab.recipe, { ruleVersion: 1, inputs: { credits: 2 }, strategicInputs: {}, baseOutputs: { science: 12 }, residentsRequired: 3, localPowerInput: 3, localPowerOutput: 0, emissionsPerOperation: 0 }) && equal(lab.result.paid, { credits: 2 }), laboratory_historical_identity_and_residents: proof.cityId === path.cityId && proof.civId === path.seat && lab.result.residents.openingPopulation === proof.openingPopulation && lab.result.residents.allocated === 3, laboratory_old_participant_subsets_valid: !!old && old.operations.every(item => item.buildingId !== 'research-lab') && isWorldState(path.labCompleted), laboratory_installed_null_result_valid: installed.buildingOperations?.['research-lab']?.lastResult === null && isWorldState(path.labCompleted), laboratory_last_attempt_and_productive_distinct: retained.lastBeat?.consumed === 0 && retained.lastBeat.round > proof.round && equal(retained.lastProductiveBeat, proof), laboratory_positive_science_required: (lab.result.produced.science ?? 0) > 0 && retained.lastBeat?.generated === 8 && equal(retained.lastProductiveBeat, proof), laboratory_receipt_identity_and_output_distinct: lab.buildingId === 'research-lab' && equal(lab.result.produced, { science: this.marginalOutput(path.productive, 'research-lab', 'science') }) && equal(proof.operations.find(item => item.buildingId === 'factory')?.result.produced, { materials: this.marginalOutput(path.productive, 'factory', 'materials') }), laboratory_pruned_receipts_self_contained: !path.pruned.events.some(event => event.id === proof.eventId) && equal(retained.lastProductiveBeat, proof) && isWorldState(path.pruned), laboratory_retained_events_cross_checked: rejects && isWorldState(path.productive), laboratory_later_productive_town_beat_can_replace: replacement.round > proof.round && (replacement.operations.find(item => item.buildingId === 'factory')?.result.produced.materials ?? 0) > 0 && equal(replacement.operations.find(item => item.buildingId === 'research-lab')?.result.produced, {}) };
  }
  private refuse(): void {
    const path = this.getPath(); this.select(path.beforeLab); let refused = true;
    for (const kind of ['feature', 'chemistry', 'era', 'campus', 'materials', 'credits', 'foreign', 'missing']) {
      const state = structuredClone(path.beforeLab); const city = town(state, path.cityId); const civilization = actor(state, path.seat);
      if (kind === 'feature') state.unlockedFeatures = state.unlockedFeatures.filter(item => item !== 'powered-science');
      if (kind === 'chemistry') civilization.technologies = civilization.technologies.filter(item => item !== 'chemistry');
      if (kind === 'era') civilization.era = 2;
      if (kind === 'campus') { city.buildings = city.buildings.filter(item => item !== 'campus'); delete city.districtSites?.campus; }
      if (kind === 'materials' || kind === 'credits') civilization.resources[kind] = 0;
      const before = structuredClone(state); const result = command(state, path.seat, { type: 'build', project: 'research-lab', cityId: kind === 'foreign' ? 'city-1' : kind === 'missing' ? 'missing-town' : path.cityId });
      refused &&= !result.ok && equal(result.state, before) && equal(state, before) && result.events.length === 0; this.controls++;
    }
    const unavailable = createWorld(path.initial.seed, path.initial.clockEpoch ?? undefined, 'settlement-second-government-1');
    let oldReferences = true;
    for (const source of [path.sanitationSelected, path.chemistryCompleted, path.labStarted, path.labCompleted, path.productive, path.pruned]) {
      const old = structuredClone(source); old.releaseId = unavailable.releaseId; old.unlockedFeatures = [...unavailable.unlockedFeatures]; oldReferences &&= !isWorldState(old); this.controls++;
    }
    const invalid = structuredClone(path.chemistryCompleted); actor(invalid, path.seat).technologies = actor(invalid, path.seat).technologies.filter(item => item !== 'sanitation');
    const stale = applyCommand(path.beforeLab, { seat: path.seat, expectedRevision: path.beforeLab.revision - 1, timestamp: time(path.beforeLab), action: { type: 'build', cityId: path.cityId, project: 'research-lab' } }); this.controls += 2;
    this.predicates = { powered_science_unreleased_references_refused: oldReferences && isWorldState(unavailable), powered_science_corrupt_branch_refused: !isWorldState(invalid), laboratory_invalid_admission_refused: refused, powered_science_refusals_zero_effect: refused && !stale.ok && equal(stale.state, path.beforeLab) && stale.events.length === 0 };
  }
  private replay(): void {
    const path = this.getPath(); let state = path.initial; let valid = true;
    for (const step of path.steps) { const before = structuredClone(state); const result = replayCoastalStep(state, step.input); assert.ok(result.ok, result.error); assert.deepEqual(state, before); assert.deepEqual(result, step.result); valid &&= isWorldState(result.state); state = result.state; this.replayedFrames++; }
    this.state = state; const proof = town(path.productive, path.cityId).localPower?.lastProductiveBeat; assert.ok(proof); const lab = proof.operations.find(item => item.buildingId === 'research-lab'); assert.ok(lab);
    this.predicates = { powered_science_current_paid_sequence: this.replayedFrames === path.steps.length && valid && lab.result.localPower.consumed === 3 && lab.result.residents.allocated === 3 && lab.result.paid.credits === 2, powered_science_actual_selected_research_witness: actor(path.researchSelected, path.seat).researchTarget === 'banking' && actor(path.researchInvested, path.seat).researchProgress > 0, laboratory_exact_modified_science: lab.result.produced.science === this.marginalOutput(path.productive, 'research-lab', 'science'), laboratory_same_beat_productive_research: actor(path.researchInvested, path.seat).researchProgress === q(actor(this.step(path.researchInvested).before, path.seat).researchProgress + science(this.step(path.researchInvested).result, path.seat)), powered_science_replay_exact: equal(state, path.state), powered_science_deferred_mechanics_absent: !BUILDINGS.some(item => item.id === 'sewer') && !Object.keys(actor(state, path.seat)).some(key => /knowledge|greatPerson/i.test(key)) && !Object.hasOwn(state, 'disease'), powered_science_calendar_unchanged: state.year === path.initial.year && state.clockTicks === path.initial.clockTicks && equal(state.calendarMilestones, path.initial.calendarMilestones) };
  }
}
