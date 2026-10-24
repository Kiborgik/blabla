import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { createLandworkPlanner, type FundedLandworkQuote } from '../core/behavior-landwork.ts';
import { exchangePromisedResources } from '../core/behavior-knowledge.ts';
import { civilizationBehaviorProfile, behaviorPolicyVersion } from '../core/behavior-profiles.ts';
import { deriveProgressionPlan, progressionAcquisitionPurpose } from '../core/behavior-progression.ts';
import { IMPROVEMENTS, TRADE_RECIPES } from '../core/content.ts';
import { applyCommand, catchUpStrategy, legalActions, observe } from '../core/engine.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { regionalIronPlanForWorld } from '../core/regional-iron.ts';
import { sameAction } from '../core/simulation/choices.ts';
import { improvementEligibility } from '../core/simulation/capabilities.ts';
import { improvementSiteBlock } from '../core/simulation/improvements.ts';
import { householdFoodUpkeep } from '../core/simulation/food-security.ts';
import { hexDistance } from '../core/simulation/geography.ts';
import { projectOperationAllocation } from '../core/simulation/operations.ts';
import { createTerritoryPlanner } from '../core/simulation/territory.ts';
import { turnAdmission } from '../core/simulation/turns.ts';
import { cityProductivity } from '../core/simulation/world.ts';
import type { City, GameAction, WorldState } from '../core/types.ts';
import { isWorldState } from '../core/validation.ts';
import { syntheticInstitution, syntheticTechnologies } from './fixtures/coastal-prefix.ts';

const epoch = '2026-10-24T00:00:00.000Z';
const seed = 73;
const cents = (value: number): number => Math.round(value * 100) / 100;
const regional = createGeneratedWorld(seed, epoch, 'settlement-regional-iron-1');
const priorFresh = createGeneratedWorld(seed, epoch, 'settlement-civic-works-1');
const certificate = regionalIronPlanForWorld(regional);
const terrain = (state: WorldState) => state.tiles.map(({ id, q, r, terrain, elevation, resource }) => ({ id, q, r, terrain, elevation, resource }));
const town = (state: WorldState, cityId: string): City => { const city = state.cities.find(city => city.id === cityId); assert.ok(city); return city; };
const actor = (state: WorldState, seat: number) => { const civilization = state.civilizations.find(actor => actor.id === seat); assert.ok(civilization); return civilization; };
const iron = (state: WorldState, seat: number) => actor(state, seat).strategicResources?.iron ?? 0;
const timestamp = (state: WorldState, seat: number): string => { const at = turnAdmission(state, seat).nextActionAt; assert.ok(at); return at; };
const options = (state: WorldState, seat: number) => legalActions(state, seat, timestamp(state, seat));

function commit(state: WorldState, seat: number, action: GameAction): WorldState {
  const before = structuredClone(state);
  const command = { seat, expectedRevision: state.revision, timestamp: timestamp(state, seat), action };
  assert.ok(options(state, seat).some(option => sameAction(option.action, action)), JSON.stringify(action));
  const result = applyCommand(state, command); assert.ok(result.ok, result.error);
  assert.deepEqual(state, before); assert.ok(isWorldState(result.state), `Actual ${action.type} frame ${result.state.revision}`);
  assert.deepEqual(applyCommand(JSON.parse(JSON.stringify(state)) as WorldState, command), result);
  return result.state;
}

function beat(state: WorldState): WorldState {
  const at = turnAdmission(state, 0).nextStrategyAt; assert.ok(at);
  const before = structuredClone(state); const result = catchUpStrategy(state, at); assert.ok(result.ok, result.error);
  assert.deepEqual(state, before); assert.equal(result.state.round, state.round + 1); assert.ok(isWorldState(result.state), `Actual beat ${result.state.round}`);
  assert.deepEqual(catchUpStrategy(JSON.parse(JSON.stringify(state)) as WorldState, at), result);
  return result.state;
}

function refuse(state: WorldState, seat: number, action: GameAction, code = 'illegal_action'): void {
  assert.ok(isWorldState(state), 'Refusal control must be a canonical opening, not invalid-state rejection');
  const before = structuredClone(state);
  const result = applyCommand(state, { seat, expectedRevision: state.revision, timestamp: timestamp(state, seat), action });
  assert.equal(result.ok, false); assert.equal(result.actionOutcome?.code, code); assert.deepEqual(result.events, []); assert.deepEqual(result.state, before); assert.deepEqual(state, before);
}

function chooseSite() {
  const planner = createTerritoryPlanner(regional);
  const candidates = regional.cities.flatMap(city => regional.strategicDeposits!.tileIds.toSorted((a, b) => a - b).flatMap(tileId => {
    const quote = planner.assess(city.civId, city.id, tileId).quote;
    if (!quote || quote.distance !== 2 || priorFresh.strategicDeposits!.tileIds.includes(tileId)) return [];
    const anchor = priorFresh.strategicDeposits!.tileIds.find(id => priorFresh.tiles.find(tile => tile.id === id)?.owner === city.civId);
    if (anchor === undefined) return [];
    const second = regional.strategicDeposits!.tileIds.toSorted((a, b) => a - b).find(id => id !== tileId && id !== anchor
      && hexDistance(regional.tiles[id]!, regional.tiles[tileId]!) === 1
      && hexDistance(regional.tiles[id]!, regional.tiles[city.tileId]!) <= 3
      && (regional.tiles[id]!.owner === null || regional.tiles[id]!.owner === city.civId));
    if (second === undefined) return [];
    const otherPriorIronInRange = priorFresh.strategicDeposits!.tileIds.filter(id => id !== anchor && hexDistance(priorFresh.tiles[id]!, priorFresh.tiles[city.tileId]!) <= 3);
    return [{ seat: city.civId, cityId: city.id, tileId, second, anchor, quote, otherPriorIronInRange }];
  }));
  candidates.sort((a, b) => a.otherPriorIronInRange.length - b.otherPriorIronInRange.length || a.seat - b.seat || a.tileId - b.tileId);
  const selected = candidates[0];
  assert.ok(selected, 'Fixed seed73 must expose a genuinely new purchasable distance-two regional hill and a neighboring second Mine site; no seed substitution');
  return selected;
}

const selected = chooseSite();
const { seat, cityId, tileId, second, anchor } = selected;
const acquire: GameAction = { type: 'acquire-tile', cityId, tileId };
const mine: GameAction = { type: 'improve', cityId, tileId, improvementId: 'mine' };

function opening(basis = regional): WorldState {
  const state = structuredClone(basis); const city = town(state, cityId); const civilization = actor(state, seat);
  civilization.resources = { food: 1000, materials: 1000, energy: 1000, credits: 1000, science: 0, culture: 1000 };
  city.population = 8; city.infrastructure = 0; city.wellbeing = 50; city.damage = 0; city.focus = 'industry';
  syntheticTechnologies(state, seat, ['writing']);
  assert.equal(observe(state, seat, timestamp(state, seat)).revealedDeposits?.some(deposit => deposit.resource === 'iron'), false);
  syntheticInstitution(state, cityId, 'campus', anchor);
  syntheticTechnologies(state, seat, ['metal-casting']); civilization.era = 2;
  const industrialSite = state.tiles.find(tile => tile.owner === seat && tile.id !== city.tileId && tile.id !== anchor && tile.id !== tileId && tile.id !== second
    && tile.terrain !== 'ocean' && tile.terrain !== 'mountain' && !regional.strategicDeposits!.tileIds.includes(tile.id)
    && !priorFresh.strategicDeposits!.tileIds.includes(tile.id));
  assert.ok(industrialSite, 'Synthetic completed Industrial zone must occupy a real owned non-Iron site');
  syntheticInstitution(state, cityId, 'industrial-zone', industrialSite.id);
  syntheticInstitution(state, cityId, 'foundry'); civilization.strategicResources = { iron: 0 };
  assert.deepEqual(terrain(state), terrain(basis)); assert.deepEqual(state.drainage, basis.drainage);
  assert.ok(isWorldState(state), 'Explicit synthetic Campus before reveal, prerequisites, stocks and Foundry must validate on untouched generated terrain');
  return state;
}

function mineQuote(state: WorldState, target = tileId): FundedLandworkQuote | undefined {
  return createLandworkPlanner(state, seat).quote(cityId, target).quotes.find(quote => quote.action.type === 'improve' && quote.action.improvementId === 'mine');
}

function journey(basis = regional) {
  const before = opening(basis); const purchase = commit(before, seat, acquire); const construction = commit(purchase, seat, mine);
  let completed = construction;
  for (let count = 0; count < 4 && town(completed, cityId).construction?.active; count++) completed = beat(completed);
  assert.equal(town(completed, cityId).construction?.active, null);
  assert.equal(town(completed, cityId).improvements?.[String(tileId)]?.operation.lastResult, null);
  const extraction = beat(completed); const foundry = beat(extraction);
  return { before, purchase, construction, completed, extraction, foundry };
}

let proved: ReturnType<typeof journey>;
let provedPrior: ReturnType<typeof journey>;

await test('fixed regional geography enables a paid Mine and only later retained Iron can supply the opening Foundry', context => {
  assert.deepEqual(terrain(regional), terrain(priorFresh), 'The fixed comparison must retain identical generated terrain, not silently compare another attempt');
  assert.deepEqual(regional.drainage, priorFresh.drainage);
  assert.ok(certificate && 'approaches' in certificate); assert.equal(certificate.approaches.length, 2);
  proved = journey(); const { before, purchase, construction, completed, extraction, foundry } = proved;
  const quote = mineQuote(before); assert.ok(quote); assert.deepEqual(quote.acquisitionCost, { credits: 16 }); assert.deepEqual(quote.setupCost, { materials: 6, credits: 3 });
  assert.deepEqual(quote.strategicInputs, {}); assert.ok(quote.marginalOutput.materials > 0); assert.equal('iron' in quote.marginalOutput, false);
  const receipt = purchase.tileAcquisitions?.[String(tileId)]; assert.ok(receipt);
  assert.deepEqual(receipt.pathTileIds, selected.quote.pathTileIds); assert.equal(receipt.distance, 2); assert.equal(receipt.priorCivilizationPurchases, 0);
  assert.equal(actor(purchase, seat).resources.credits, actor(before, seat).resources.credits - 16);
  assert.equal(actor(purchase, seat).resources.materials, actor(before, seat).resources.materials); assert.equal(iron(purchase, seat), 0);
  assert.equal(town(purchase, cityId).population, town(before, cityId).population); assert.equal(town(purchase, cityId).improvements?.[String(tileId)], undefined);
  const order = town(construction, cityId).construction?.active; assert.ok(order && 'kind' in order && order.kind === 'improvement');
  assert.deepEqual(order.paid, { materials: 6, credits: 3 }); assert.equal(order.workRequired, 4); assert.equal(order.workDone, 0); assert.equal(order.tileId, tileId);
  assert.equal(actor(construction, seat).resources.materials, actor(purchase, seat).resources.materials - 6);
  assert.equal(actor(construction, seat).resources.credits, actor(purchase, seat).resources.credits - 3);
  assert.deepEqual(town(completed, cityId).improvements![String(tileId)]!.completion.paid, order.paid);
  assert.equal(iron(completed, seat), 0); assert.equal(completed.strategicDeposits!.deposits[String(tileId)]!.remaining, 240);
  const extracted = town(extraction, cityId).improvements![String(tileId)]!.operation.lastResult!;
  assert.equal(extracted.status, 'operated'); assert.equal(extracted.residents.allocated, 1); assert.deepEqual(extracted.paid, {}); assert.ok(extracted.produced.materials! > 0);
  assert.deepEqual(extracted.extraction, { ruleVersion: 1, tileId, round: extraction.round, resource: 'iron', quantity: 2, reserveBefore: 240, reserveAfter: 238, stockBefore: 0, stockAfter: 2, capacity: 40, status: 'extracted' });
  const blocked = town(extraction, cityId).buildingOperations!.foundry!.lastResult!;
  assert.equal(blocked.status, 'blocked'); assert.deepEqual(blocked.paid, {}); assert.deepEqual(blocked.strategicPaid, {}); assert.equal(blocked.residents?.allocated, 0);
  assert.equal(iron(extraction, seat), 2);
  const supplied = town(foundry, cityId).buildingOperations!.foundry!.lastResult!;
  assert.equal(supplied.status, 'operated'); assert.deepEqual(supplied.paid, { energy: 2 }); assert.deepEqual(supplied.strategicPaid, { iron: 1 }); assert.equal(supplied.residents?.allocated, 3);
  assert.equal(supplied.produced.materials, cents(8 * cityProductivity(town(extraction, cityId))));
  assert.equal(foundry.round, extraction.round + 1); assert.equal(iron(foundry, seat), 3);
  assert.equal(foundry.strategicDeposits!.deposits[String(tileId)]!.remaining, 236);
  assert.ok(town(foundry, cityId).lastFoodSupply?.supplied); assert.equal(town(foundry, cityId).population, 8);
  assert.deepEqual(terrain(foundry), terrain(regional)); assert.deepEqual(foundry.drainage, regional.drainage);
  context.diagnostic(JSON.stringify({ seed, seat, cityId, tileId, second, anchor, nativeQuote: receipt, structuralCertificate: certificate, provenance: 'Synthetic opening prerequisites; actual deterministic paid engine transitions, not controller uptake', completionRound: completed.round, extractionRound: extraction.round, foundryRound: foundry.round }));
});

await test('the identical paid prior-fresh-rules hill supplies Materials but no Iron while its prior fresh owned anchor is occupied by the pre-revelation Campus', context => {
  const old = journey(priorFresh); provedPrior = old;
  assert.equal(town(old.before, cityId).districtSites?.campus, anchor); assert.ok(priorFresh.strategicDeposits!.tileIds.includes(anchor));
  refuse(old.purchase, seat, { ...mine, tileId: anchor });
  const actual = town(old.extraction, cityId).improvements![String(tileId)]!.operation.lastResult!;
  assert.equal(actual.status, 'operated'); assert.ok(actual.produced.materials! > 0); assert.notEqual(actual.extraction?.resource, 'iron'); assert.equal(iron(old.foundry, seat), 0);
  assert.equal(town(old.foundry, cityId).buildingOperations!.foundry!.lastResult?.status, 'blocked');
  assert.deepEqual(old.purchase.tileAcquisitions![String(tileId)], proved.purchase.tileAcquisitions![String(tileId)]);
  assert.deepEqual(actor(old.extraction, seat).resources, actor(proved.extraction, seat).resources);
  assert.deepEqual(town(old.extraction, cityId).lastFoodSupply, town(proved.extraction, cityId).lastFoodSupply);
  const plan = deriveProgressionPlan(proved.before, actor(proved.before, seat), civilizationBehaviorProfile(seed, seat, behaviorPolicyVersion(proved.before)), options(proved.before, seat));
  const oldPlan = deriveProgressionPlan(old.before, actor(old.before, seat), civilizationBehaviorProfile(seed, seat, behaviorPolicyVersion(old.before)), options(old.before, seat));
  assert.equal(progressionAcquisitionPurpose(acquire, actor(proved.before, seat), plan), 'strategic-extraction');
  assert.notEqual(progressionAcquisitionPurpose(acquire, actor(old.before, seat), oldPlan), 'strategic-extraction');
  context.diagnostic(JSON.stringify({ otherPriorIronWithinTownRange: selected.otherPriorIronInRange, strongCampusContrast: selected.otherPriorIronInRange.length === 0, limitation: 'Site-level paid benefit and changed existing candidate purpose only; no natural choice, optimality, global scarcity or industrial milestone claim' }));
});

await test('rival ownership, occupied sites, unpaid purchases, unpaid setup and an active town lane refuse without effects', () => {
  const definition = IMPROVEMENTS.find(item => item.id === 'mine')!;
  const rival = structuredClone(proved.before); rival.tiles[tileId]!.owner = (seat + 1) % 5;
  assert.match(createTerritoryPlanner(rival).assess(seat, cityId, tileId).blocker!, /currently unowned/); refuse(rival, seat, acquire);
  const poor = structuredClone(proved.before); actor(poor, seat).resources.credits = 15.99;
  assert.match(createTerritoryPlanner(poor).assess(seat, cityId, tileId).blocker!, /requires 16 Credits/); refuse(poor, seat, acquire);
  const occupied = structuredClone(proved.purchase); town(occupied, cityId).districtSites!.campus = tileId;
  assert.match(improvementSiteBlock(occupied, town(occupied, cityId), definition, tileId)!, /occupies this site/); refuse(occupied, seat, mine);
  const foreign = proved.purchase.cities.find(city => city.civId !== seat)!; refuse(proved.purchase, seat, { ...mine, cityId: foreign.id });
  for (const resource of ['materials', 'credits'] as const) {
    const unpaid = structuredClone(proved.purchase); actor(unpaid, seat).resources[resource] = resource === 'materials' ? 5.99 : 2.99;
    assert.ok(improvementEligibility(unpaid, seat, definition, cityId).blockers.some(blocker => blocker.kind === 'resource' && blocker.resource === resource)); refuse(unpaid, seat, mine);
  }
  refuse(proved.construction, seat, mine, 'active_commitment'); refuse(proved.purchase, seat, { ...mine, tileId: anchor });
});

await test('revelation, finite reserves, full storage and opening resident allocation remain independent extraction gates', () => {
  for (const kind of ['unrevealed', 'exhausted', 'storage-full', 'one-left'] as const) {
    const state = structuredClone(proved.completed); const civilization = actor(state, seat); town(state, cityId).buildingOperations!.foundry!.enabled = false;
    if (kind === 'unrevealed') {
      const city = town(state, cityId); city.buildings = city.buildings.filter(id => !['foundry', 'industrial-zone'].includes(id));
      delete city.buildingOperations!.foundry; delete city.districtSites!['industrial-zone'];
      civilization.technologies = []; syntheticTechnologies(state, seat, ['mining', 'writing']); civilization.era = 0;
    }
    if (kind === 'exhausted') state.strategicDeposits!.deposits[String(tileId)]!.remaining = 0;
    if (kind === 'storage-full') civilization.strategicResources = { iron: 40 };
    if (kind === 'one-left') state.strategicDeposits!.deposits[String(tileId)]!.remaining = 1;
    assert.ok(isWorldState(state), `Synthetic ${kind} opening`);
    const after = beat(state); const result = town(after, cityId).improvements![String(tileId)]!.operation.lastResult!;
    assert.equal(result.status, 'operated'); assert.ok(result.produced.materials! > 0);
    assert.equal(result.extraction?.status, kind === 'one-left' ? 'extracted' : kind); assert.equal(result.extraction?.quantity, kind === 'one-left' ? 1 : 0);
    assert.equal(result.extraction!.reserveBefore - result.extraction!.reserveAfter, result.extraction!.quantity);
    assert.equal(iron(after, seat) - iron(state, seat), result.extraction!.quantity);
    if (kind === 'one-left') assert.equal(town(beat(after), cityId).improvements![String(tileId)]!.operation.lastResult?.extraction?.status, 'exhausted');
  }
  const limited = structuredClone(proved.completed); town(limited, cityId).population = 6; town(limited, cityId).wellbeing = 60; actor(limited, seat).strategicResources = { iron: 10 };
  assert.ok(isWorldState(limited), 'Synthetic opening resident shortage remains canonical');
  const after = beat(limited); const city = town(after, cityId);
  assert.equal(city.buildingOperations!.foundry!.lastResult?.status, 'operated'); assert.equal(city.buildingOperations!.foundry!.lastResult?.residents?.allocated, 3);
  assert.equal(city.improvements![String(tileId)]!.operation.lastResult?.blockedReason, 'resident-shortage');
  assert.equal(city.improvements![String(tileId)]!.operation.lastResult?.residents.openingPopulation, 6); assert.equal(city.improvements![String(tileId)]!.operation.lastResult?.extraction, undefined);
  assert.equal(after.strategicDeposits!.deposits[String(tileId)]!.remaining, 240); assert.equal(iron(after, seat), 9); assert.equal(city.population, 7);
  const energyShort = structuredClone(proved.completed); actor(energyShort, seat).strategicResources = { iron: 10 }; actor(energyShort, seat).resources.energy = 1;
  assert.ok(isWorldState(energyShort), 'Synthetic opening Energy shortage remains canonical');
  const unfunded = beat(energyShort); const blocked = town(unfunded, cityId).buildingOperations!.foundry!.lastResult!;
  assert.equal(blocked.status, 'blocked'); assert.deepEqual(blocked.paid, {}); assert.deepEqual(blocked.strategicPaid, {}); assert.equal(blocked.residents?.allocated, 0);
  assert.equal(town(unfunded, cityId).improvements![String(tileId)]!.operation.lastResult?.extraction?.quantity, 2); assert.equal(iron(unfunded, seat), 12);
});

await test('an existing supplied Mine and full storage make a second paid district member redundant for Iron, not for ordinary Materials', () => {
  let state = structuredClone(proved.foundry); actor(state, seat).strategicResources = { iron: 40 };
  state = commit(state, seat, { type: 'set-building-operation', cityId, buildingId: 'foundry', enabled: false });
  if (state.tiles[second]!.owner === null) state = commit(state, seat, { type: 'acquire-tile', cityId, tileId: second });
  const beforeStart = structuredClone(state);
  state = commit(state, seat, { type: 'improve', cityId, tileId: second, improvementId: 'mine' });
  assert.equal(actor(state, seat).resources.materials, actor(beforeStart, seat).resources.materials - 6);
  for (let count = 0; count < 4 && town(state, cityId).construction?.active; count++) state = beat(state);
  assert.equal(town(state, cityId).construction?.active, null); state = beat(state);
  for (const id of [tileId, second]) {
    const result = town(state, cityId).improvements![String(id)]!.operation.lastResult!;
    assert.equal(result.status, 'operated'); assert.ok(result.produced.materials! > 0); assert.equal(result.extraction?.status, 'storage-full'); assert.equal(result.extraction?.quantity, 0);
  }
  assert.equal(iron(state, seat), 40); assert.equal(state.strategicDeposits!.deposits[String(second)]!.remaining, 240);
  assert.equal(state.strategicDeposits!.deposits[String(tileId)]!.remaining, proved.foundry.strategicDeposits!.deposits[String(tileId)]!.remaining);
  const resumed = commit(state, seat, { type: 'set-building-operation', cityId, buildingId: 'foundry', enabled: true });
  const two = beat(resumed); const paused = commit(state, seat, { type: 'set-improvement-operation', cityId, tileId: second, improvementId: 'mine', enabled: false });
  const one = beat(commit(paused, seat, { type: 'set-building-operation', cityId, buildingId: 'foundry', enabled: true }));
  assert.equal(iron(two, seat), 40); assert.equal(iron(one, seat), 40);
  assert.deepEqual(town(two, cityId).buildingOperations!.foundry!.lastResult, town(one, cityId).buildingOperations!.foundry!.lastResult);
  assert.equal([tileId, second].reduce((sum, id) => sum + town(two, cityId).improvements![String(id)]!.operation.lastResult!.extraction!.quantity, 0), 1);
});

await test('generic funded landwork protects opening households, existing paid allocation and accepted commitments without promising strategic output', () => {
  const state = structuredClone(proved.before); const city = town(state, cityId); const civilization = actor(state, seat);
  const quote = mineQuote(state); assert.ok(quote);
  assert.equal(quote.protectedBudget.ordinary.food, householdFoodUpkeep(state, 8) * quote.protectedHorizon);
  civilization.resources.food = quote.protectedBudget.ordinary.food - 0.01;
  assert.equal(mineQuote(state), undefined); assert.ok(options(state, seat).some(option => sameAction(option.action, acquire)));
  civilization.resources.food = 1000; civilization.strategicResources = { iron: 40 }; city.population = 6;
  assert.equal(town(projectOperationAllocation(state), cityId).buildingOperations!.foundry!.lastResult?.status, 'operated');
  assert.equal(mineQuote(state), undefined); city.population = 7;
  const protectedQuote = mineQuote(state); assert.ok(protectedQuote); assert.ok(protectedQuote.retainedOperations.includes(`${cityId}/building/foundry`));
  assert.equal(protectedQuote.protectedBudget.strategic.iron, protectedQuote.protectedHorizon);
  assert.equal(protectedQuote.protectedBudget.ordinary.energy, 2 * protectedQuote.protectedHorizon);
  const partner = state.cities.find(candidate => candidate.civId !== seat)!;
  const terms = { ...structuredClone(TRADE_RECIPES.find(recipe => recipe.id === 'harvest-for-materials')!.terms), cadenceRounds: 4 };
  state.tradeOffers ??= [];
  state.tradeOffers.push({ id: 'synthetic-accepted-regional-trade', proposer: seat, recipient: partner.civId, from: cityId, to: partner.id, createdRound: state.round, expiresRound: state.round + 8, status: 'accepted', terms: structuredClone(terms), routeId: 'synthetic-regional-route' });
  state.routes.push({ id: 'synthetic-regional-route', from: cityId, to: partner.id, owner: seat, partner: partner.civId, active: true, damage: 0, volume: 0,
    agreement: { offerId: 'synthetic-accepted-regional-trade', terms, enabled: true, acceptedRound: state.round, nextDeliveryRound: state.round + 4, lastAttemptRound: null, lastDeliveryRound: null, deliveryCount: 0, blockedBy: null, blockedReason: null, closedRound: null } });
  assert.ok(isWorldState(state), 'Explicit synthetic retained accepted commitment must validate');
  const accepted = structuredClone(state.routes); const funded = mineQuote(state); assert.ok(funded);
  const promised = exchangePromisedResources(state, seat, funded.protectedHorizon);
  assert.equal(funded.protectedBudget.ordinary.food, cents(householdFoodUpkeep(state, 7) * funded.protectedHorizon + promised.ordinary.food));
  assert.equal(funded.protectedBudget.ordinary.energy, cents(2 * funded.protectedHorizon + promised.ordinary.energy));
  const openingBudget = structuredClone(funded.protectedBudget.ordinary); civilization.resources = openingBudget;
  assert.ok(mineQuote(state)); civilization.resources.food -= 0.01; assert.equal(mineQuote(state), undefined);
  assert.deepEqual(state.routes, accepted);
});

await test('readonly fixture exports only validated actual paid transition states with explicit synthetic opening provenance', () => {
  const directory = process.env.REGIONAL_IRON_FIXTURE_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  const states = [...Object.entries(proved), ['prior-fresh-before', provedPrior.before] as const, ['prior-fresh-extraction', provedPrior.extraction] as const, ['prior-fresh-foundry', provedPrior.foundry] as const]; const files: Array<{ file: string; sha256: string; revision: number; round: number }> = [];
  for (const [name, state] of states) {
    assert.ok(isWorldState(state)); const file = `state-${name}.json`; const contents = JSON.stringify(state, null, 2) + '\n';
    writeFileSync(join(directory, file), contents); chmodSync(join(directory, file), 0o444);
    files.push({ file, sha256: createHash('sha256').update(contents).digest('hex'), revision: state.revision, round: state.round });
  }
  const manifest = { seed, seat, cityId, tileId, second, anchor, release: regional.releaseId, priorFreshRelease: priorFresh.releaseId, regionalGenesisSha256: createHash('sha256').update(JSON.stringify(regional)).digest('hex'), priorFreshGenesisSha256: createHash('sha256').update(JSON.stringify(priorFresh)).digest('hex'), provenance: 'Synthetic initial stocks, recursive technologies, population8, Campus before reveal, Industrial zone and enabled Foundry. Thereafter actual paid engine purchase, Mine setup, construction, finite extraction and later supplied Foundry; every transition canonical and detached-replayed. No natural uptake or browser injection.', nativeQuote: proved.purchase.tileAcquisitions![String(tileId)], structuralCertificate: certificate, otherPriorIronWithinTownRange: selected.otherPriorIronInRange, files };
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n'); chmodSync(join(directory, 'manifest.json'), 0o444);
});
