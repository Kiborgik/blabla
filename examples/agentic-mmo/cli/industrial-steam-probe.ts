import assert from 'node:assert/strict';
import { isDeepStrictEqual as equal } from 'node:util';
import { INDUSTRIAL_RULES, RESOURCE_IDS, TECHNOLOGIES } from '../core/content.ts';
import { applyCommand, legalActions } from '../core/engine.ts';
import { resolveTrade } from '../core/simulation/trade.ts';
import { resolveHistory } from '../core/simulation/history.ts';
import { createLandTransportPlanner, createSteamTransportPlanner, isSteamTransportQuote, transportBlock, transportCadence } from '../core/simulation/transport.ts';
import { extractCityMetals, strategicCapacity } from '../core/simulation/metals.ts';
import { allocateOperations } from '../core/simulation/operations.ts';
import { districtSiteOccupied } from '../core/simulation/districts.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { isWorldState } from '../core/validation.ts';
import type { GameAction, GameEvent, WorldState } from '../core/types.ts';
import { industrialSteamJourney } from '../tests/fixtures/industrial-steam-journey.ts';
import { coastalPrefixTime, replayCoastalStep, type CoastalPrefixStep } from '../tests/fixtures/coastal-prefix.ts';

const actions = ['complete_connected_research', 'extract_finite_coal', 'construct_owned_rail', 'quote_steam_exchange', 'consent_steam_exchange', 'deliver_funded_steam_exchange', 'block_unfunded_steam_exchange', 'attain_industrial_milestone', 'replay_industrial_history', 'refuse_industrial_action'];
const round = (value: number) => Math.round(value * 100) / 100;
function actor(state: WorldState, seat = 0) { const result = state.civilizations.find(candidate => candidate.id === seat); assert.ok(result); return result; }
function time(state: WorldState): string { return coastalPrefixTime(Math.max((state.independentTurns?.strategyTicks ?? 0) * 60 + 20, ...state.civilizations.map(civilization => ((state.independentTurns?.lastActionWindow[civilization.id] ?? -1) + 1) * 10))); }
function command(state: WorldState, action: GameAction, seat = 0) { return applyCommand(state, { seat, expectedRevision: state.revision, timestamp: time(state), action }); }
function stocks(state: WorldState) { return state.civilizations.map(civilization => ({ ordinary: civilization.resources, strategic: civilization.strategicResources })); }
function oldTerms(state: WorldState, before: WorldState): boolean { return before.routes.length > 0 && before.routes.every(route => equal(state.routes.find(candidate => candidate.id === route.id)?.agreement?.terms, route.agreement?.terms)); }

export class IndustrialSteamProbe {
  private path: ReturnType<typeof industrialSteamJourney> | null = null;
  private state: WorldState | null = null;
  private before: WorldState | null = null;
  private operation = '';
  private predicates: Record<string, boolean> = {};
  private replayedFrames = 0;
  private controls = 0;
  private priorConsent: { before: WorldState; after: WorldState; routeId: string } | null = null;
  reset(): void { this.state = null; this.before = null; this.operation = ''; this.predicates = {}; this.replayedFrames = 0; this.controls = 0; this.priorConsent = null; }
  snapshot() { return structuredClone({ state: this.state, before: this.before, operation: this.operation, predicates: this.predicates, replayedFrames: this.replayedFrames, controls: this.controls, priorConsent: this.priorConsent }); }
  private getPath() { this.path ??= industrialSteamJourney(); return this.path; }
  private select(step: CoastalPrefixStep): void { this.before = structuredClone(step.before); const result = replayCoastalStep(this.before, structuredClone(step.input)); assert.deepEqual(this.before, step.before); assert.deepEqual(result, step.result); assert.ok(result.ok, result.error); assert.ok(isWorldState(result.state), `Durable frame ${result.state.revision}`); this.state = result.state; }
  call(action: string): void {
    if (!actions.includes(action)) throw new RangeError(`Unknown industrial action ${action}`);
    const path = this.getPath(); this.operation = action; this.predicates = {}; this.controls = 0; this.replayedFrames = 0; this.priorConsent = null;
    this.before = structuredClone(path.initial); this.state = structuredClone(path.state);
    if (action === 'complete_connected_research') {
      const expected = [['scientific-method', 150, ['printing', 'astronomy']], ['shipbuilding', 66, ['sailing', 'celestial-navigation']], ['industrialization', 220, ['apprenticeship', 'metal-casting', 'scientific-method']], ['steam-power', 240, ['industrialization', 'shipbuilding']]] as const;
      let currentOnly = true; let explicit = true;
      for (const step of path.steps.filter(item => item.before.revision >= path.prepared.revision && item.result.state.revision <= path.researched.revision)) {
        const before = actor(step.before); const after = actor(step.result.state); if (step.input.kind !== 'strategy' || !before.researchTarget) continue;
        const definition = TECHNOLOGIES.find(item => item.id === before.researchTarget); assert.ok(definition);
        const effect = step.result.events.find(event => event.type === 'settlement-production' && event.actor === 0)?.effects.find(item => item.endsWith(' science')); assert.ok(effect);
        const invested = round((after.researchTarget === before.researchTarget ? after.researchProgress : definition.cost) - before.researchProgress);
        currentOnly &&= invested === round(Math.min(Number(effect.split(' ')[1]), definition.cost - before.researchProgress));
        if (after.technologies.includes(definition.id)) explicit &&= after.researchTarget === '' && after.researchProgress === 0;
      }
      this.predicates = { exact_research_dependencies: expected.every(([id, , requires]) => equal(TECHNOLOGIES.find(tech => tech.id === id)?.requires, requires)), exact_research_costs: expected.every(([id, cost]) => TECHNOLOGIES.find(tech => tech.id === id)?.cost === cost), current_science_only: currentOnly, no_era_selection_gate: actor(path.researched).era === 2 && expected.every(([id]) => actor(path.researched).technologies.includes(id)), no_automatic_successor: explicit };
    } else if (action === 'extract_finite_coal') this.extractionControls();
    else if (action === 'construct_owned_rail') this.railControls();
    else if (action === 'quote_steam_exchange') {
      const receipt = path.state.industrialEvidence?.steamDelivery; assert.ok(receipt?.terms.transport?.mode === 'steam'); const quote = receipt.terms.transport;
      const planned = createSteamTransportPlanner(path.beforeOffer).quote(quote.tileIds[0] ?? -1, quote.tileIds.at(-1) ?? -1, quote.baseCadence);
      const reordered = structuredClone(path.beforeOffer); reordered.tiles.reverse();
      const repeat = createSteamTransportPlanner(reordered).quote(quote.tileIds[0] ?? -1, quote.tileIds.at(-1) ?? -1, quote.baseCadence);
      const unrailed = createLandTransportPlanner(path.beforeOffer).quote(quote.tileIds[0] ?? -1, quote.tileIds.at(-1) ?? -1);
      this.predicates = { deterministic_weighted_path: equal(planned, quote) && equal(repeat, quote) && isSteamTransportQuote(quote, path.beforeOffer.tiles.length) && transportBlock(path.beforeOffer, quote, quote.tileIds[0] ?? -1, quote.tileIds.at(-1) ?? -1) === null, exact_snapshot_cadence: receipt.terms.cadenceRounds === Math.max(quote.baseCadence, Math.ceil(quote.weightedDistance / 2)) && receipt.terms.cadenceRounds === transportCadence(quote.baseCadence, quote) && unrailed?.edges === quote.unrailedEdges && quote.unrailedCadence === Math.max(quote.baseCadence, Math.ceil(quote.unrailedEdges / 2)) };
    } else if (action === 'consent_steam_exchange') {
      const offer = path.proposed.tradeOffers?.find(item => item.id === path.offerId); const route = path.accepted.routes.find(item => item.agreement?.offerId === path.offerId); assert.ok(offer && route?.agreement);
      this.predicates = { explicit_new_consent: equal(stocks(path.beforeOffer), stocks(path.proposed)) && !path.proposed.routes.some(item => item.id === route.id) && route.agreement.deliveryCount === 0 && route.agreement.lastSteamDelivery === null && RESOURCE_IDS.every(resource => actor(path.accepted).resources[resource] === actor(path.proposed).resources[resource] - (offer.terms.constructionCost[resource] ?? 0)), exact_snapshot_cadence: equal(route.agreement.terms, offer.terms) && route.agreement.nextDeliveryRound === route.agreement.acceptedRound + offer.terms.cadenceRounds, old_quote_schedule_preserved: this.priorConsentControl() };
    } else if (action === 'deliver_funded_steam_exchange') this.shipmentControls(false);
    else if (action === 'block_unfunded_steam_exchange') this.shipmentControls(true);
    else if (action === 'attain_industrial_milestone') {
      const evidence = path.state.industrialEvidence; assert.ok(evidence?.steamDelivery);
      const control = structuredClone(path.twoFoundries); const events: GameEvent[] = []; resolveHistory(control, events);
      const retained = structuredClone(path.state); const once: GameEvent[] = []; resolveHistory(retained, once);
      this.predicates = { two_distinct_operated_towns: new Set(evidence.foundryOperations.map(item => item.cityId)).size === 2 && evidence.foundryOperations.every(item => item.paid.energy === 2 && item.strategicPaid.iron === 1 && item.residents.allocated === 3 && (item.produced.materials ?? 0) > 0), genuine_steam_receipt: evidence.steamDelivery.terms.transport?.mode === 'steam' && evidence.steamDelivery.terms.cadenceRounds < evidence.steamDelivery.terms.transport.unrailedCadence && evidence.steamDelivery.proposerStrategicPaid.coal === 1, durable_evidence: actor(control).era === 2 && !control.calendarMilestones.includes('industrial-world') && actor(path.state).era === 3 && once.length === 0 && equal(retained.industrialEvidence, evidence), no_calendar_change: path.state.year === path.prepared.year && path.state.clockTicks === path.prepared.clockTicks }; this.controls = 2;
    } else if (action === 'replay_industrial_history') {
      let state = structuredClone(path.initial);
      for (const step of path.steps) { assert.deepEqual(state, step.before); const before = structuredClone(state); const result = replayCoastalStep(state, structuredClone(step.input)); assert.deepEqual(state, before); assert.deepEqual(result, step.result); assert.ok(isWorldState(result.state), `Durable frame ${result.state.revision}`); state = result.state; this.replayedFrames++; }
      const pruned = structuredClone(state); pruned.events = []; assert.ok(isWorldState(pruned));
      this.state = state; this.predicates = { replay_exact: equal(state, path.state) && this.replayedFrames === path.steps.length, durable_evidence: equal(pruned.industrialEvidence, path.state.industrialEvidence) && equal(JSON.parse(JSON.stringify(pruned)).industrialEvidence, path.state.industrialEvidence), old_quote_schedule_preserved: oldTerms(state, path.accepted) && equal(pruned.routes, path.state.routes) && equal(JSON.parse(JSON.stringify(pruned)).routes, path.state.routes), old_iron_preserved: equal(state.strategicDeposits, path.initial.strategicDeposits) && equal(pruned.strategicDeposits, path.initial.strategicDeposits) };
    } else this.refusalControls();
  }
  private priorConsentControl(): boolean {
    const path = this.getPath(); let state = structuredClone(path.beforeOffer);
    const steamStep = path.steps.find(step => step.result.state.revision === path.proposed.revision); assert.ok(steamStep?.input.kind === 'action' && steamStep.input.command.action.type === 'propose-trade');
    const steamAction = steamStep.input.command.action;
    const landOption = legalActions(state, path.seat, time(state)).find(option => option.action.type === 'propose-trade' && option.tradeQuote?.transport.mode === 'land' && option.action.partner !== steamAction.partner); assert.ok(landOption);
    const landProposed = command(state, landOption.action, path.seat); assert.ok(landProposed.ok, landProposed.error); state = landProposed.state;
    const landOffer = state.tradeOffers?.find(offer => offer.status === 'pending' && offer.proposer === path.seat); assert.ok(landOffer);
    const landAccepted = command(state, { type: 'respond-trade', offerId: landOffer.id, accept: true }, landOffer.recipient); assert.ok(landAccepted.ok, landAccepted.error); state = landAccepted.state;
    const priorRoute = state.routes.find(route => route.agreement?.offerId === landOffer.id); assert.ok(priorRoute?.agreement && priorRoute.agreement.terms.transport?.mode === 'land');
    const before = structuredClone(state);
    const proposed = command(state, steamAction, path.seat); assert.ok(proposed.ok, proposed.error); state = proposed.state;
    const offer = state.tradeOffers?.find(candidate => candidate.status === 'pending' && candidate.proposer === path.seat); assert.ok(offer);
    const accepted = command(state, { type: 'respond-trade', offerId: offer.id, accept: true }, offer.recipient); assert.ok(accepted.ok, accepted.error);
    this.priorConsent = { before, after: accepted.state, routeId: priorRoute.id }; this.controls++;
    return before.routes.length > 0 && accepted.state.routes.length === before.routes.length + 1 && equal(accepted.state.routes.find(route => route.id === priorRoute.id), priorRoute) && oldTerms(accepted.state, before);
  }
  private extractionControls(): void {
    const path = this.getPath();
    const state = structuredClone(path.coalReady); const city = state.cities.find(item => item.id === path.mineCityId); const deposit = state.coalDeposits?.deposits[String(path.mineTileId)]; assert.ok(city && deposit);
    const iron = structuredClone(state.strategicDeposits); actor(state).strategicResources ??= {}; const stock = actor(state).strategicResources; assert.ok(stock); stock.coal = strategicCapacity(state, 0, 'coal') - 1; deposit.remaining = 1; state.round++;
    allocateOperations(state); extractCityMetals(state, city); const result = city.improvements?.[String(path.mineTileId)]?.operation.lastResult; const extraction = result?.extraction; assert.ok(extraction);
    const exhausted = structuredClone(state); const exhaustedCity = exhausted.cities.find(item => item.id === city.id); assert.ok(exhaustedCity); allocateOperations(exhausted); extractCityMetals(exhausted, exhaustedCity);
    const paused = structuredClone(path.coalReady); const pausedCity = paused.cities.find(item => item.id === city.id); const improvement = pausedCity?.improvements?.[String(path.mineTileId)]; assert.ok(improvement && pausedCity); improvement.operation.enabled = false; const pausedBefore = structuredClone(paused.coalDeposits); allocateOperations(paused); extractCityMetals(paused, pausedCity);
    this.predicates = { credited_equals_depleted: extraction.quantity === 1 && extraction.reserveBefore - extraction.reserveAfter === extraction.quantity && extraction.stockAfter - extraction.stockBefore === extraction.quantity && exhaustedCity.improvements?.[String(path.mineTileId)]?.operation.lastResult?.extraction?.quantity === 0, opening_resident_respected: result?.residents?.allocated === 1 && equal(paused.coalDeposits, pausedBefore), per_resource_capacity: state.cities.some(city => city.civId === 0) && extraction.capacity === 60 * state.cities.filter(city => city.civId === 0).length && strategicCapacity(state, 0, 'iron') === 40 * state.cities.filter(city => city.civId === 0).length && extraction.stockAfter === extraction.capacity, old_iron_preserved: equal(state.strategicDeposits, iron) }; this.controls = 3;
  }
  private railControls(): void {
    const path = this.getPath(); const step = path.steps.find(item => item.input.kind === 'action' && item.input.command.action.type === 'build-rail'); assert.ok(step && step.input.kind === 'action' && step.input.command.action.type === 'build-rail'); this.select(step); assert.ok(this.before && this.state); const action = step.input.command.action; const before = this.before; const after = this.state; const order = after.cities.find(city => city.id === action.cityId)?.construction?.active; assert.ok(order && 'kind' in order && order.kind === 'rail');
    const city = before.cities.find(item => item.id === action.cityId); const first = before.tiles.find(tile => tile.id === action.fromTileId); const second = before.tiles.find(tile => tile.id === action.toTileId); const center = before.tiles.find(tile => tile.id === city?.tileId); assert.ok(city && first && second && center);
    const duplicate = command(after, { ...action, fromTileId: action.toTileId, toTileId: action.fromTileId });
    const completed = path.state.railEdges?.[order.edgeId]; assert.ok(completed);
    this.predicates = { exact_owned_adjacent_edge: first.owner === 0 && second.owner === 0 && hexDistance(first, second) === 1, same_town_reach: hexDistance(first, center) <= 3 && hexDistance(second, center) <= 3, full_start_payment_once: false, one_town_lane: !duplicate.ok && equal(duplicate.state, after), completed_later_once: completed.completedRound > completed.startedRound && path.steps.flatMap(item => item.result.events).filter(event => event.railCompletion?.orderId === order.id).length === 1, no_tile_slot_consumed: before.tiles.every(tile => districtSiteOccupied(before, tile.id) === districtSiteOccupied(after, tile.id)) };
    this.predicates.full_start_payment_once = RESOURCE_IDS.every(resource => actor(after).resources[resource] === actor(before).resources[resource] - (Reflect.get(INDUSTRIAL_RULES.railCost, resource) as number | undefined ?? 0)) && actor(after).strategicResources?.iron === (actor(before).strategicResources?.iron ?? 0) - 1 && actor(after).strategicResources?.coal === (actor(before).strategicResources?.coal ?? 0) - 1 && equal(after.tiles, before.tiles) && equal(after.railEdges, before.railEdges); this.controls = 1;
  }
  private shipmentControls(blocked: boolean): void {
    const path = this.getPath(); const route = path.accepted.routes.find(item => item.agreement?.offerId === path.offerId); assert.ok(route?.agreement);
    const isolated = structuredClone(path.accepted); isolated.routes = [structuredClone(route)]; isolated.round = route.agreement.nextDeliveryRound;
    if (blocked) {
      let unchanged = true;
      for (const reason of ['coal', 'food', 'recipient', 'energy', 'rail', 'damage', 'disabled', 'early', 'recipient-capacity', 'incoming-fuel']) {
        const state = structuredClone(isolated); const target = state.routes[0]; assert.ok(target?.agreement);
        if (reason === 'coal') { actor(state).strategicResources ??= {}; const stock = actor(state).strategicResources; assert.ok(stock); stock.coal = 0; }
        if (reason === 'recipient-capacity') { target.agreement.terms.strategicCargo = { proposer: { iron: 2 }, recipient: {} }; actor(state, route.partner).strategicResources ??= {}; const stock = actor(state, route.partner).strategicResources; assert.ok(stock); stock.iron = strategicCapacity(state, route.partner, 'iron'); }
        if (reason === 'incoming-fuel') { target.agreement.terms.strategicCargo = { proposer: {}, recipient: { coal: 1 } }; actor(state).strategicResources ??= {}; actor(state, route.partner).strategicResources ??= {}; const source = actor(state).strategicResources; const recipient = actor(state, route.partner).strategicResources; assert.ok(source && recipient); source.coal = 0; recipient.coal = 1; }
        if (reason === 'food') actor(state).resources.food = 0;
        if (reason === 'recipient') actor(state, route.partner).resources.materials = 0;
        if (reason === 'energy') actor(state).resources.energy = 0;
        if (reason === 'rail') { const quote = target.agreement.terms.transport; assert.ok(quote?.mode === 'steam' && quote.railEdges[0] && state.railEdges); delete state.railEdges[quote.railEdges[0].edgeId]; }
        if (reason === 'damage') target.damage = 100;
        if (reason === 'disabled') target.agreement.enabled = false;
        if (reason === 'early') state.round--;
        const before = structuredClone(stocks(state)); const events: GameEvent[] = []; resolveTrade(state, events); const retained = structuredClone(state); const duplicate: GameEvent[] = []; resolveTrade(state, duplicate);
        unchanged &&= equal(stocks(state), before) && !events.some(event => event.steamDelivery) && equal(state, retained) && duplicate.length === 0 && !state.industrialEvidence?.steamDelivery; this.controls++;
      }
      this.predicates = { no_payment_on_block: unchanged, once_only_due_delivery: unchanged }; return;
    }
    const before = structuredClone(isolated); const events: GameEvent[] = []; resolveTrade(isolated, events); const receipt = events.find(event => event.steamDelivery)?.steamDelivery; assert.ok(receipt); const terms = route.agreement.terms;
    const atomic = RESOURCE_IDS.every(resource => actor(isolated).resources[resource] === round(actor(before).resources[resource] - (terms.proposerCargo[resource] ?? 0) - (terms.proposerUpkeep[resource] ?? 0) + (terms.recipientCargo[resource] ?? 0) + (terms.proposerYield[resource] ?? 0)) && actor(isolated, route.partner).resources[resource] === round(actor(before, route.partner).resources[resource] - (terms.recipientCargo[resource] ?? 0) - (terms.recipientUpkeep[resource] ?? 0) + (terms.proposerCargo[resource] ?? 0) + (terms.recipientYield[resource] ?? 0)));
    const retained = structuredClone(isolated); const duplicate: GameEvent[] = []; resolveTrade(isolated, duplicate);
    const floor = structuredClone(path.accepted); const floorRoute = structuredClone(route); floor.routes = [floorRoute]; assert.ok(floorRoute.agreement && terms.transport?.mode === 'steam'); const floorBase = terms.transport.unrailedCadence; const floorQuote = createSteamTransportPlanner(floor).quote(terms.transport.tileIds[0] ?? -1, terms.transport.tileIds.at(-1) ?? -1, floorBase); assert.ok(floorQuote && floorQuote.railEdges.length > 0);
    floorRoute.agreement.terms.transport = floorQuote; floorRoute.agreement.terms.cadenceRounds = transportCadence(floorBase, floorQuote); floorRoute.agreement.nextDeliveryRound = floorRoute.agreement.acceptedRound + floorRoute.agreement.terms.cadenceRounds; floor.round = floorRoute.agreement.nextDeliveryRound;
    const floorEvents: GameEvent[] = []; resolveTrade(floor, floorEvents); resolveHistory(floor, floorEvents);
    const floorRespected = floorQuote.weightedDistance < floorQuote.unrailedEdges && floorRoute.agreement.terms.cadenceRounds === floorQuote.unrailedCadence && !!floorRoute.agreement.lastSteamDelivery && floor.industrialEvidence?.steamDelivery === null && !floor.calendarMilestones.includes('industrial-world');
    this.predicates = { full_atomic_fuel_and_cargo: atomic && actor(isolated).strategicResources?.coal === (actor(before).strategicResources?.coal ?? 0) - 1, once_only_due_delivery: equal(isolated, retained) && duplicate.length === 0, complete_delivery_receipt: receipt.acceptedRound === route.agreement.acceptedRound && equal(receipt.terms, terms) && receipt.proposerStrategicPaid.coal === 1 && equal(receipt, isolated.routes[0]?.agreement?.lastSteamDelivery), current_paid_industrial_sequence: path.steps.every(step => step.result.ok) && path.state.industrialEvidence?.steamDelivery?.eventId === path.steps.at(-1)?.result.events.find(event => event.steamDelivery)?.id, faster_than_unrailed_baseline: terms.transport?.mode === 'steam' && terms.cadenceRounds < terms.transport.unrailedCadence && terms.transport.railEdges.length > 0 && floorRespected }; this.controls = 2;
  }
  private refusalControls(): void {
    const path = this.getPath(); let refused = true; let unchanged = true;
    const edge = Object.values(path.state.railEdges ?? {})[0]; assert.ok(edge);
    for (const action of [{ type: 'build-rail', cityId: edge.cityId, fromTileId: edge.toTileId, toTileId: edge.tileId }, { type: 'build-rail', cityId: 'city-1', fromTileId: 48, toTileId: 49 }, { type: 'build-rail', cityId: 'city-0', fromTileId: 57, toTileId: 57 }, { type: 'build-rail', cityId: 'missing-town', fromTileId: 57, toTileId: 58 }, { type: 'propose-trade', transportMode: 'steam', partner: 0, recipeId: 'harvest-for-materials', sourceCityId: 'city-0', recipientCityId: 'city-0' }] as GameAction[]) {
      const before = structuredClone(path.state); const result = command(before, action); refused &&= !result.ok; unchanged &&= equal(result.state, before) && equal(before, path.state) && result.events.length === 0; this.controls++;
    }
    const railStep = path.steps.find(step => step.input.kind === 'action' && step.input.command.action.type === 'build-rail'); assert.ok(railStep?.input.kind === 'action');
    const railBase = railStep.before; const offered = legalActions(railBase, 0, time(railBase)).find(option => equal(option.action, railStep.input.kind === 'action' ? railStep.input.command.action : null)); assert.ok(offered);
    for (const resource of ['materials', 'credits', 'iron', 'coal']) {
      const state = structuredClone(railBase);
      if (resource === 'materials' || resource === 'credits') actor(state).resources[resource] = 0;
      else { const stock = actor(state).strategicResources; assert.ok(stock); stock[resource as 'iron' | 'coal'] = 0; }
      const before = structuredClone(state); const result = command(state, offered.action); refused &&= !result.ok; unchanged &&= equal(result.state, before) && equal(state, before) && result.events.length === 0; this.controls++;
    }
    const stale = applyCommand(railBase, { seat: 0, expectedRevision: railBase.revision - 1, timestamp: time(railBase), action: offered.action }); refused &&= !stale.ok; unchanged &&= equal(stale.state, railBase) && stale.events.length === 0; this.controls++;
    this.predicates = { refused, no_effects: unchanged };
  }
  observe() { return { initialized: this.state !== null, ...this.predicates, replayed_frames: this.replayedFrames, controls: this.controls, provenance: 'Synthetic named fresh industrial prerequisites followed by actual paid typed actions; finite-reserve/capacity, isolated-shipment and invalid-action controls are detached' }; }
}
