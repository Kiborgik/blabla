import { PoweredScienceProbe, POWERED_SCIENCE_ACTIONS } from './powered-science-probe.ts';
import assert from 'node:assert/strict';
import { isDeepStrictEqual as equal } from 'node:util';
import { BUILDINGS, RESOURCE_IDS } from '../core/content.ts';
import { applyCommand, applyRelease } from '../core/engine.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import { resolveEconomy } from '../core/simulation/economy.ts';
import { extractCityMetals } from '../core/simulation/metals.ts';
import { resolveTrade } from '../core/simulation/trade.ts';
import { isWorldState } from '../core/validation.ts';
import type { BuildingOperationResult, GameAction, WorldState } from '../core/types.ts';
import { localPowerJourney } from '../tests/fixtures/local-power-journey.ts';
import { coastalPrefixTime, replayCoastalStep } from '../tests/fixtures/coastal-prefix.ts';

const actions = ['adopt_local_power', 'construct_power_building', 'operate_local_generator', 'operate_powered_consumer', 'expire_local_power', 'change_power_operation', 'retain_local_power_receipt', 'replay_local_power'];
const q = (value: number): number => Math.round(value * 100) / 100;
function town(state: WorldState, id: string) { const result = state.cities.find(city => city.id === id); assert.ok(result); return result; }
function actor(state: WorldState, id: number) { const result = state.civilizations.find(civilization => civilization.id === id); assert.ok(result); return result; }
function time(state: WorldState): string { return coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(civilization => ((state.independentTurns?.lastActionWindow[civilization.id] ?? -1) + 1) * 10))); }
function command(state: WorldState, seat: number, action: GameAction) { return applyCommand(state, { seat, expectedRevision: state.revision, timestamp: time(state), action }); }
function emptyPayment(result: BuildingOperationResult | null | undefined): boolean {
  return !!result && Object.values(result.paid).every(value => value === 0) && Object.values(result.strategicPaid ?? {}).every(value => value === 0) && Object.values(result.produced).every(value => value === 0) && result.residents?.allocated === 0 && result.localPower?.consumed === 0 && result.localPower.generated === 0 && result.emissionsProduced === 0;
}

export class LocalPowerProbe {
  private successor: PoweredScienceProbe | null = null;
  private path: ReturnType<typeof localPowerJourney> | null = null;
  private state: WorldState | null = null;
  private predicates: Record<string, boolean> = {};
  private controls = 0;
  private replayedFrames = 0;
  private getPath() { this.path ??= localPowerJourney(); return this.path; }
  reset(): void { this.successor = null; this.state = null; this.predicates = {}; this.controls = 0; this.replayedFrames = 0; }
  snapshot() { if (this.successor) return this.successor.snapshot(); return structuredClone({ state: this.state, predicates: this.predicates, controls: this.controls, replayedFrames: this.replayedFrames }); }
  observe() { if (this.successor) return this.successor.observe(); return { initialized: this.state !== null, ...this.predicates, controls: this.controls, replayed_frames: this.replayedFrames, provenance: 'Genuine typed industrial-to-local-Power journey; detached shortage, synthetic contention/output and invalid-state controls are not live play' }; }
  call(action: string): void {
    if (POWERED_SCIENCE_ACTIONS.some(item => item === action)) { this.successor ??= new PoweredScienceProbe(); this.successor.call(action); return; }
    if (!actions.includes(action)) throw new RangeError(`Unknown local Power action ${action}`);
    this.successor = null; const path = this.getPath(); this.state = structuredClone(path.state); this.predicates = {}; this.controls = 0; this.replayedFrames = 0;
    const positive = town(path.productive, path.cityId).localPower?.lastProductiveBeat; assert.ok(positive);
    if (action === 'adopt_local_power') {
      const before = path.beforeRelease; const after = path.adopted;
      const result = applyRelease(before, { expectedRevision: before.revision, expectedFromReleaseId: before.releaseId, targetReleaseId: after.releaseId, timestamp: time(before) });
      this.predicates = { compatible_empty_adoption: result.ok && equal(result.state, after) && after.cities.every(city => city.localPower === undefined && !city.buildings.includes('coal-plant') && !city.buildings.includes('factory')), prior_world_preserved: equal(before.civilizations, after.civilizations) && equal(before.cities, after.cities) && equal(before.routes, after.routes) && equal(before.tradeOffers, after.tradeOffers) && equal(before.tiles, after.tiles) && equal(before.coalDeposits, after.coalDeposits) && equal(before.strategicDeposits, after.strategicDeposits) && equal(before.industrialEvidence, after.industrialEvidence) && equal(before.railEdges, after.railEdges) && before.rng === after.rng, no_clock_era_or_milestone_change: before.year === after.year && before.clockTicks === after.clockTicks && equal(before.calendarMilestones, after.calendarMilestones) && before.civilizations.every(civilization => actor(after, civilization.id).era === civilization.era) };
    } else if (action === 'construct_power_building') {
      const starts = path.steps.filter(step => step.input.kind === 'action' && step.input.command.action.type === 'build' && ['coal-plant', 'factory'].includes(step.input.command.action.project));
      let paid = starts.length === 2; let admission = true; let work = true;
      for (const step of starts) {
        assert.ok(step.input.kind === 'action' && step.input.command.action.type === 'build'); const project = step.input.command.action.project; const definition = BUILDINGS.find(building => building.id === project); assert.ok(definition);
        const order = town(step.result.state, path.cityId).construction?.active;
        paid &&= RESOURCE_IDS.every(resource => q(actor(step.before, path.seat).resources[resource] - actor(step.result.state, path.seat).resources[resource]) === (definition.cost[resource] ?? 0));
        work &&= !!order && !('kind' in order) && order.workRequired === 18 && equal(order.paid, definition.cost);
        admission &&= actor(step.before, path.seat).era >= 3 && actor(step.before, path.seat).technologies.includes('industrialization') && town(step.before, path.cityId).buildings.includes('industrial-zone');
      }
      const lane = command(path.plantStarted, path.seat, { type: 'build', cityId: path.cityId, project: 'factory' });
      const unpowered = command(path.beforePlant, path.seat, { type: 'build', cityId: path.cityId, project: 'factory' });
      const plant = town(path.plantCompleted, path.cityId).construction?.lastCompleted; const factory = town(path.factoryCompleted, path.cityId).construction?.lastCompleted;
      this.predicates = { exact_catalogue_admission: admission && unpowered.ok && this.refusals(), exact_start_cost_and_work: paid && work, one_owned_town_lane: !lane.ok && equal(lane.state, path.plantStarted), paid_and_installed_once: !!plant && !!factory && path.steps.flatMap(step => step.result.events).filter(event => event.id === plant.eventId).length === 1 && path.steps.flatMap(step => step.result.events).filter(event => event.id === factory.eventId).length === 1, first_operation_later: town(path.plantCompleted, path.cityId).buildingOperations?.['coal-plant']?.lastResult === null && town(path.factoryCompleted, path.cityId).buildingOperations?.factory?.lastResult === null && !!factory && positive.round > factory.completedRound };
      this.controls += 2;
    } else if (action === 'operate_local_generator') this.generatorControls();
    else if (action === 'operate_powered_consumer') this.consumerControls();
    else if (action === 'expire_local_power') {
      const unused = town(path.unused, path.cityId).localPower?.lastBeat; assert.ok(unused);
      const state = structuredClone(path.productive); const civilization = actor(state, path.seat); civilization.strategicResources = { ...civilization.strategicResources, coal: 0 }; civilization.resources.energy = 100000;
      allocateOperations(state); const blocked = town(state, path.cityId).buildingOperations?.factory?.lastResult;
      this.predicates = { power_conserved_and_expired: positive.generated === 8 && positive.consumed === 3 && positive.expired === 5 && unused.generated === unused.consumed + unused.expired && unused.expired === 8, unused_generation_remains_paid: unused.operations.some(operation => operation.phase === 'generator' && operation.result.strategicPaid.coal === 2 && operation.result.residents.allocated === 3 && operation.result.emissionsProduced === 4), no_spendable_receipt_or_carryover: blocked?.status === 'blocked' && blocked.localPower?.availableBefore === 0 && equal(town(state, path.cityId).localPower, town(path.productive, path.cityId).localPower) && !Object.hasOwn(civilization.resources, 'power') && !Object.hasOwn(civilization.strategicResources, 'power') }; this.controls = 1;
    } else if (action === 'change_power_operation') {
      const before = town(path.productive, path.cityId); const paused = town(path.paused, path.cityId); const after = town(path.unused, path.cityId);
      const resumed = command(path.unused, path.seat, { type: 'set-building-operation', cityId: path.cityId, buildingId: 'factory', enabled: true });
      this.predicates = { toggles_only_affect_future_opening: paused.buildingOperations?.factory?.enabled === false && equal(paused.buildingOperations.factory.lastResult, before.buildingOperations?.factory?.lastResult) && after.buildingOperations?.factory?.lastResult?.status === 'paused' && resumed.ok && equal(town(resumed.state, path.cityId).buildingOperations?.factory?.lastResult, after.buildingOperations.factory.lastResult), toggles_preserve_receipts: equal(paused.localPower, before.localPower) && equal(town(resumed.state, path.cityId).localPower, after.localPower) && equal(actor(path.productive, path.seat).resources, actor(path.paused, path.seat).resources) && equal(actor(path.productive, path.seat).strategicResources, actor(path.paused, path.seat).strategicResources) }; this.controls = 1;
    } else if (action === 'retain_local_power_receipt') this.retentionControls();
    else if (action === 'replay_local_power') {
      let state = structuredClone(path.initial);
      for (const step of path.steps) { assert.deepEqual(state, step.before); const before = structuredClone(state); const result = replayCoastalStep(state, structuredClone(step.input)); assert.deepEqual(state, before); assert.deepEqual(result, step.result); state = result.state; this.replayedFrames++; }
      const factory = positive.operations.find(operation => operation.phase === 'consumer');
      const duplicate = replayCoastalStep(path.unused, { kind: 'strategy', timestamp: coastalPrefixTime((path.unused.independentTurns?.strategyTicks ?? 0) * 60) });
      const stale = applyCommand(path.beforePlant, { seat: path.seat, expectedRevision: path.beforePlant.revision - 1, timestamp: time(path.beforePlant), action: { type: 'build', cityId: path.cityId, project: 'coal-plant' } });
      this.predicates = { legal_unedited_consumer_journey: path.steps.every(step => step.result.ok) && path.beforeRelease.industrialEvidence?.steamDelivery !== null && actor(path.beforeRelease, path.seat).era === 3 && path.steps.filter(step => step.input.kind === 'action' && step.input.command.action.type === 'build' && ['coal-plant', 'factory'].includes(step.input.command.action.project)).length === 2, same_town_same_beat_power: positive.cityId === path.cityId && positive.operations.every(operation => operation.result.round === positive.round), exact_modified_materials: factory?.result.produced.materials === 23.4 && factory.recipe.baseOutputs.materials === 12, replay_exact: equal(state, path.state), refused_actions_have_no_effects: this.refusals() && !stale.ok && equal(stale.state, path.beforePlant) && equal(duplicate.state, path.unused) && duplicate.events.length === 0, legacy_behavior_preserved: path.steps.filter(step => !step.before.unlockedFeatures.includes('local-power')).every(step => step.before.cities.every(city => !city.localPower)), bounded_self_contained_retention: equal(town(path.unused, path.cityId).localPower?.lastProductiveBeat, positive) && isWorldState(path.productive) && isWorldState(path.unused) }; this.controls += 2;
    }
  }
  private refusals(): boolean {
    const path = this.getPath(); let refused = true;
    for (const kind of ['feature', 'technology', 'era', 'district', 'materials', 'credits', 'foreign', 'missing']) {
      const state = structuredClone(path.beforePlant); const city = town(state, path.cityId); const civilization = actor(state, path.seat);
      if (kind === 'feature') state.unlockedFeatures = state.unlockedFeatures.filter(feature => feature !== 'local-power');
      if (kind === 'technology') civilization.technologies = civilization.technologies.filter(technology => technology !== 'industrialization');
      if (kind === 'era') civilization.era = 2;
      if (kind === 'district') { city.buildings = city.buildings.filter(building => building !== 'industrial-zone'); delete city.districtSites?.['industrial-zone']; }
      if (kind === 'materials' || kind === 'credits') civilization.resources[kind] = 0;
      const before = structuredClone(state); const result = command(state, path.seat, { type: 'build', project: 'coal-plant', cityId: kind === 'foreign' ? 'city-1' : kind === 'missing' ? 'missing-town' : path.cityId });
      refused &&= !result.ok && equal(result.state, before) && equal(state, before) && result.events.length === 0; this.controls++;
    }
    return refused;
  }
  private generatorControls(): void {
    const path = this.getPath(); const proof = town(path.productive, path.cityId).localPower?.lastProductiveBeat; assert.ok(proof);
    const plant = proof.operations.find(operation => operation.phase === 'generator'); assert.ok(plant);
    let blocked = true;
    for (const kind of ['zero-coal', 'one-coal', 'residents', 'paused']) {
      const state = structuredClone(path.factoryCompleted); const city = town(state, path.cityId); const civilization = actor(state, path.seat); const operation = city.buildingOperations?.['coal-plant']; assert.ok(operation);
      if (kind === 'zero-coal' || kind === 'one-coal') civilization.strategicResources = { ...civilization.strategicResources, coal: kind === 'zero-coal' ? 0 : 1 };
      if (kind === 'residents') city.population = 5;
      if (kind === 'paused') operation.enabled = false;
      const coal = civilization.strategicResources?.coal; allocateOperations(state);
      blocked &&= operation.lastResult?.status !== 'operated' && emptyPayment(operation.lastResult) && civilization.strategicResources?.coal === coal; this.controls++;
    }
    const later = structuredClone(path.factoryCompleted); actor(later, path.seat).strategicResources = { ...actor(later, path.seat).strategicResources, coal: 0 };
    allocateOperations(later); for (const city of later.cities) extractCityMetals(later, city);
    const afterMine = (actor(later, path.seat).strategicResources?.coal ?? 0) > 0 && town(later, path.cityId).buildingOperations?.['coal-plant']?.lastResult?.status === 'blocked';
    const incoming = structuredClone(path.factoryCompleted); actor(incoming, path.seat).strategicResources = { ...actor(incoming, path.seat).strategicResources, coal: 0 }; allocateOperations(incoming);
    const route = incoming.routes.find(candidate => candidate.owner === path.seat && candidate.agreement?.terms.transport?.mode === 'steam'); assert.ok(route?.agreement);
    incoming.routes = [route]; route.agreement.terms.strategicCargo = { proposer: {}, recipient: { coal: 2 } }; delete route.agreement.terms.transport; route.agreement.nextDeliveryRound = incoming.round; route.agreement.lastAttemptRound = null;
    actor(incoming, route.partner).strategicResources = { ...actor(incoming, route.partner).strategicResources, coal: 2 }; resolveTrade(incoming, []);
    const afterTrade = actor(incoming, path.seat).strategicResources?.coal === 2 && town(incoming, path.cityId).buildingOperations?.['coal-plant']?.lastResult?.status === 'blocked';
    const ordered = structuredClone(path.factoryCompleted); const first = town(ordered, path.cityId); first.population = 9; const academy = first.buildingOperations?.academy; assert.ok(academy); academy.enabled = true; actor(ordered, path.seat).resources.culture = 2; actor(ordered, path.seat).strategicResources = { ...actor(ordered, path.seat).strategicResources, coal: 2 };
    const second = structuredClone(first); second.id = `${first.id}-synthetic-second`; second.improvements = {}; ordered.cities = [second, first]; allocateOperations(ordered);
    const order = first.buildingOperations?.['coal-plant']?.lastResult?.residents?.available === 6 && first.buildingOperations?.academy?.lastResult?.status === 'operated' && first.buildingOperations?.factory?.lastResult?.status === 'blocked' && second.buildingOperations?.['coal-plant']?.lastResult?.status === 'blocked';
    this.controls += 3;
    this.predicates = { stable_town_and_phase_order: order, complete_opening_generator_reservation: plant.result.strategicPaid.coal === 2 && plant.result.residents.allocated === 3 && plant.result.localPower.availableBefore === 0, fixed_coal_power_and_emissions: plant.result.localPower.generated === 8 && plant.result.emissionsProduced === 4 && equal(plant.result.paid, {}) && equal(plant.result.produced, {}), blocked_generator_has_no_effects: blocked, later_supply_cannot_refuel: afterMine && afterTrade };
  }
  private consumerControls(): void {
    const path = this.getPath(); const proof = town(path.productive, path.cityId).localPower?.lastProductiveBeat; assert.ok(proof); const factory = proof.operations.find(operation => operation.phase === 'consumer'); assert.ok(factory);
    let blocked = true;
    for (const kind of ['power', 'residents', 'paused', 'other-town']) {
      const state = structuredClone(path.factoryCompleted); const city = town(state, path.cityId); const civilization = actor(state, path.seat); const plant = city.buildingOperations?.['coal-plant']; const operation = city.buildingOperations?.factory; assert.ok(plant && operation);
      civilization.resources.energy = 100000;
      if (kind === 'power' || kind === 'other-town') plant.enabled = false;
      if (kind === 'residents') city.population = 6;
      if (kind === 'paused') operation.enabled = false;
      if (kind === 'other-town') { const second = structuredClone(city); second.id = `${city.id}-synthetic-generator`; const secondPlant = second.buildingOperations?.['coal-plant']; assert.ok(secondPlant); secondPlant.enabled = true; second.buildings = second.buildings.filter(id => id !== 'factory'); delete second.buildingOperations?.factory; second.improvements = {}; state.cities.push(second); }
      const energy = civilization.resources.energy; allocateOperations(state); blocked &&= emptyPayment(operation.lastResult) && operation.lastResult?.status !== 'operated' && civilization.resources.energy === energy; this.controls++;
    }
    const zero = structuredClone(path.productive); const city = town(zero, path.cityId); city.damage = 100; actor(zero, path.seat).strategicResources = { ...actor(zero, path.seat).strategicResources, coal: 2 }; zero.round++; zero.revision++; resolveEconomy(zero, []);
    const zeroFactory = city.buildingOperations?.factory?.lastResult; const zeroPlant = city.buildingOperations?.['coal-plant']?.lastResult;
    this.predicates = { complete_atomic_consumer_allocation: factory.result.localPower.consumed === 3 && factory.result.residents.allocated === 3 && equal(factory.result.paid, {}) && equal(factory.result.strategicPaid, {}), same_town_same_beat_power: proof.cityId === path.cityId && proof.operations.every(operation => operation.result.round === proof.round), exact_modified_materials: factory.recipe.baseOutputs.materials === 12 && factory.result.produced.materials === 23.4, blocked_consumer_has_no_effects: blocked, no_energy_substitution: blocked, ordinary_multipliers_exclude_power: zeroFactory?.status === 'operated' && equal(zeroFactory.produced, {}) && zeroFactory.localPower?.consumed === 3 && zeroPlant?.localPower?.generated === 8 && zeroPlant.emissionsProduced === 4 && equal(city.localPower?.lastProductiveBeat, proof) }; this.controls++;
  }
  private retentionControls(): void {
    const path = this.getPath(); const proof = town(path.productive, path.cityId).localPower?.lastProductiveBeat; assert.ok(proof);
    let state = structuredClone(path.unused);
    for (let count = 0; count < 3 && state.events.some(event => event.id === proof.eventId); count++) { const result = replayCoastalStep(state, { kind: 'strategy', timestamp: coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60) }); assert.ok(result.ok); state = result.state; this.controls++; }
    let rejects = true;
    for (const kind of ['power', 'town', 'round', 'payment', 'event']) {
      const corrupted = structuredClone(path.productive); const ledger = town(corrupted, path.cityId).localPower; assert.ok(ledger?.lastBeat);
      const receipt = ledger.lastBeat;
      if (kind === 'power') receipt.expired++;
      if (kind === 'town') receipt.cityId = 'other-town';
      if (kind === 'round') receipt.round++;
      if (kind === 'payment') { const operation = receipt.operations[0]; assert.ok(operation); operation.result.strategicPaid.coal = 1; }
      if (kind === 'event') { const event = corrupted.events.find(candidate => candidate.id === receipt.eventId); assert.ok(event); event.actor = 4; }
      rejects &&= !isWorldState(corrupted); this.controls++;
    }
    const latest = town(path.unused, path.cityId).localPower;
    const identities = proof.operations.every(operation => operation.recipe.ruleVersion === 1 && operation.result.residents.openingPopulation === proof.openingPopulation && operation.result.residents.communityReserve === 3 && path.productive.events.some(event => event.id === operation.result.operationEventId && event.round === proof.round && event.actor === proof.civId));
    this.predicates = { exact_versioned_operation_snapshots: identities && proof.operations[0]?.recipe.strategicInputs.coal === 2 && proof.operations[1]?.recipe.baseOutputs.materials === 12, historical_identity_and_residents: proof.cityId === path.cityId && proof.civId === path.seat && proof.operations.every(operation => operation.result.residents.allocated === 3), latest_attempt_distinct_from_productive: latest?.lastBeat?.round !== latest?.lastProductiveBeat?.round && equal(latest?.lastProductiveBeat, proof), positive_consumer_required: latest?.lastBeat?.consumed === 0 && latest.lastBeat.generated === 8 && equal(town(state, path.cityId).localPower?.lastProductiveBeat, proof), bounded_self_contained_retention: !state.events.some(event => event.id === proof.eventId) && equal(town(state, path.cityId).localPower?.lastProductiveBeat, proof) && isWorldState(state) && Object.keys(town(state, path.cityId).localPower ?? {}).length === 3, retained_events_cross_checked: isWorldState(path.productive) && rejects, emissions_are_receipt_only: proof.operations[0]?.result.emissionsProduced === 4 && path.productive.climate === path.beforeRelease.climate && !Object.hasOwn(state, 'emissions'), no_clock_era_or_milestone_change: state.year === path.beforeRelease.year && state.clockTicks === path.beforeRelease.clockTicks && equal(state.calendarMilestones, path.beforeRelease.calendarMilestones) };
  }
}
