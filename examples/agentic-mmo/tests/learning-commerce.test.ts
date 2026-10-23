import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDINGS, TECHNOLOGIES } from '../core/content.ts';
import { applyCommand, catchUpStrategy, legalActions } from '../core/engine.ts';
import { projectCapabilities } from '../core/capabilities.ts';
import { coastalPrefixTime, replayCoastalStep } from './fixtures/coastal-prefix.ts';
import { metalEconomyPrefix } from './fixtures/metal-economy-prefix.ts';
import { connectedMetalJourney } from './metal-economy.test.ts';

export function learningCommerceJourney(rulesId = 'settlement-metal-learning-1') {
  const journey = connectedMetalJourney(metalEconomyPrefix(rulesId));
  const exchange = (proposer: number, recipient: number): void => {
    journey.act(proposer, { type: 'propose-trade', partner: recipient, recipeId: 'harvest-for-materials', sourceCityId: `city-${proposer}`, recipientCityId: `city-${recipient}` });
    const offer = journey.state.tradeOffers?.find(candidate => candidate.proposer === proposer && candidate.recipient === recipient && candidate.status === 'pending'); assert.ok(offer);
    journey.act(recipient, { type: 'respond-trade', offerId: offer.id, accept: true });
  };
  journey.build('city-0', 'farm');
  journey.research(0, 'civic-institutions');
  journey.research(1, 'agriculture');
  journey.research(1, 'civic-institutions');
  exchange(0, 2); exchange(2, 1); exchange(1, 3);
  journey.until(() => journey.state.calendarMilestones.includes('rise-of-states'));
  journey.research(0, 'currency');
  journey.research(0, 'mathematics');
  journey.research(0, 'education');
  const institutionReady = structuredClone(journey.state);
  journey.build('city-0', 'university');
  const universityCompleted = structuredClone(journey.state);
  journey.beat();
  const universityOperated = structuredClone(journey.state);
  const hub = legalActions(journey.state, 0, journey.time()).find(option => option.action.type === 'build' && option.action.cityId === 'city-0' && option.action.project === 'commercial-hub');
  assert.ok(hub && hub.action.type === 'build' && hub.action.tileId !== undefined);
  journey.build('city-0', 'commercial-hub', hub.action.tileId);
  journey.build('city-0', 'market');
  journey.beat();
  const marketOperated = structuredClone(journey.state);
  journey.research(0, 'banking');
  assert.equal(journey.state.civilizations[0]?.era, 1);
  assert.ok(!legalActions(journey.state, 0, journey.time()).some(option => option.action.type === 'build' && option.action.project === 'bank'));
  journey.research(0, 'navigation');
  const departure = journey.state.cities.find(city => city.tileId === 23); assert.ok(departure);
  journey.build(departure.id, 'boat-yard');
  assert.ok(!legalActions(journey.state, 0, journey.time()).some(option => option.action.type === 'settle' && option.action.tileId === 26));
  journey.act(0, { type: 'settle-coast', sourceCityId: departure.id, tileId: 26 });
  journey.until(() => journey.state.calendarMilestones.includes('connected-world'));
  journey.build('city-0', 'bank');
  const bankCompleted = structuredClone(journey.state);
  journey.beat();
  return { journey, institutionReady, universityCompleted, universityOperated, marketOperated, bankCompleted };
}

await test('accepted learning and commerce cards retain exact discovery, local institution and era prerequisites', () => {
  for (const [id, cost, requires] of [['mathematics', 132, ['writing', 'currency']], ['education', 216, ['mathematics', 'writing']], ['banking', 360, ['currency', 'education']]] as const) {
    const technology = TECHNOLOGIES.find(candidate => candidate.id === id); assert.ok(technology, `${id} must be implemented`);
    assert.equal(technology.cost, cost); assert.deepEqual([...technology.requires].toSorted(), [...requires].toSorted());
  }
  for (const [id, prerequisite, minEra, cost] of [['university', 'campus', 1, { materials: 28, credits: 14 }], ['market', 'commercial-hub', 1, { materials: 18, credits: 10 }], ['bank', 'commercial-hub', 2, { materials: 30, credits: 18 }]] as const) {
    const building = BUILDINGS.find(candidate => candidate.id === id); assert.ok(building, `${id} must be implemented`);
    assert.ok(building.requiresBuildings?.includes(prerequisite)); assert.equal(building.minEra, minEra); assert.deepEqual(building.cost, cost);
  }
});

await test('released future learning remains locked behind actual research and historical capability stages', () => {
  const journey = connectedMetalJourney();
  assert.equal(journey.state.civilizations[0]?.era, 0);
  const choices = legalActions(journey.state, 0, journey.time());
  for (const project of ['university', 'commercial-hub', 'market', 'bank']) assert.ok(!choices.some(option => option.action.type === 'build' && option.action.project === project));
  assert.ok(!choices.some(option => option.action.type === 'research' && option.action.technology === 'banking'));
});

await test('real research, consensual working routes and coastal founding reach paid University, Market and Bank operations', context => {
  const result = learningCommerceJourney();
  const city = result.journey.state.cities.find(candidate => candidate.id === 'city-0'); assert.ok(city);
  assert.equal(result.universityCompleted.cities[0]?.buildingOperations?.university?.lastResult, null);
  assert.equal(result.bankCompleted.cities[0]?.buildingOperations?.bank?.lastResult, null);
  for (const [state, id, paid, resource] of [[result.universityOperated, 'university', { credits: 2 }, 'science'], [result.marketOperated, 'market', { credits: 1 }, 'credits'], [result.journey.state, 'bank', { credits: 1 }, 'credits']] as const) {
    const receipt = state.cities[0]?.buildingOperations?.[id]?.lastResult; assert.ok(receipt);
    assert.equal(receipt.status, 'operated'); assert.deepEqual(receipt.paid, paid); assert.ok((receipt.produced[resource] ?? 0) > 0); assert.equal(receipt.residents?.allocated, 3);
  }
  assert.equal(result.journey.state.civilizations[0]?.era, 2);
  assert.ok(city.districtSites?.['commercial-hub'] !== undefined);
  assert.ok(result.journey.state.calendarMilestones.includes('rise-of-states'));
  assert.ok(result.journey.state.calendarMilestones.includes('connected-world'));
  context.diagnostic(JSON.stringify({ source: 'entirely legal deterministic witness, not live play', revision: result.journey.state.revision, round: result.journey.state.round, transitions: result.journey.prefix.steps.length + result.journey.steps.length, university: result.universityOperated.cities[0]?.buildingOperations?.university?.lastResult, market: result.marketOperated.cities[0]?.buildingOperations?.market?.lastResult, bank: city.buildingOperations?.bank?.lastResult }));
});

await test('new institutions keep exact own-town dependencies, construction costs and detached canonical facts', () => {
  const { journey, institutionReady } = learningCommerceJourney();
  const state = institutionReady;
  const timestamp = coastalPrefixTime((state.independentTurns?.strategyTicks ?? 0) * 60 + 50);
  const other = state.cities.find(city => city.civId === 0 && city.id !== 'city-0'); assert.ok(other);
  const refused = applyCommand(state, { seat: 0, expectedRevision: state.revision, timestamp, action: { type: 'build', cityId: other.id, project: 'university' } });
  assert.equal(refused.ok, false); assert.deepEqual(refused.state, state); assert.deepEqual(refused.events, []);
  const rows = projectCapabilities(state, 0, other.id, timestamp);
  assert.equal(rows.buildings.find(row => row.nodeId === 'building:university')?.status, 'locked');
  const own = projectCapabilities(journey.state, 0, 'city-0', journey.time());
  for (const id of ['university', 'commercial-hub', 'market', 'bank']) assert.equal(own.buildings.find(row => row.nodeId === `building:${id}`)?.status, 'done');
  const bank = own.buildings.find(row => row.nodeId === 'building:bank'); assert.ok(bank?.operation?.lastResult);
  bank.operation.lastResult.produced.credits = 999;
  assert.notEqual(journey.state.cities[0]?.buildingOperations?.bank?.lastResult?.produced.credits, 999);
  for (const step of journey.steps) assert.deepEqual(replayCoastalStep(structuredClone(step.before), step.input), step.result);
});

await test('synthetic opening credit scarcity after legal institutions cannot fund paid commerce from its own same-beat output', () => {
  const { journey } = learningCommerceJourney();
  const state = structuredClone(journey.state); const civ = state.civilizations[0]; assert.ok(civ);
  civ.resources.credits = 0;
  const before = structuredClone(state);
  const result = catchUpStrategy(state, coastalPrefixTime(((state.independentTurns?.strategyTicks ?? 0) + 1) * 60));
  assert.ok(result.ok, result.error); assert.deepEqual(state, before);
  for (const id of ['library', 'university', 'market', 'bank']) {
    const receipt = result.state.cities[0]?.buildingOperations?.[id]?.lastResult; assert.ok(receipt);
    assert.equal(receipt.status, 'blocked'); assert.deepEqual(receipt.paid, {}); assert.deepEqual(receipt.produced, {}); assert.equal(receipt.residents?.allocated, 0);
  }
  assert.ok((result.state.civilizations[0]?.resources.credits ?? 0) > 0);
});

await test('all five civilizations can legally reach two independent useful branches without a research-era selection gate', context => {
  const journey = connectedMetalJourney();
  for (const seat of [0, 1, 2, 3, 4]) {
    for (const technology of ['agriculture', 'kiln-firing', 'writing', 'mining']) if (!journey.state.civilizations[seat]?.technologies.includes(technology)) journey.research(seat, technology);
  }
  const frontiers = [];
  for (const seat of [0, 1, 2, 3, 4]) {
    const choices = legalActions(journey.state, seat, journey.time(seat));
    const research = choices.flatMap(option => option.action.type === 'research' ? [option.action.technology] : []);
    assert.ok(research.includes('bronze-working')); assert.ok(research.includes('currency'));
    assert.ok(choices.some(option => option.action.type === 'improve' && option.action.cityId === `city-${seat}`) || Object.values(journey.state.cities.find(city => city.id === `city-${seat}`)?.improvements ?? {}).some(improvement => improvement.improvementId === 'mine'));
    frontiers.push({ seat, era: journey.state.civilizations[seat]?.era, research: research.filter(id => ['bronze-working', 'currency'].includes(id)) });
  }
  assert.ok(journey.state.civilizations.every(civ => civ.era === 0));
  context.diagnostic(JSON.stringify({ source: 'legal all-five prefix, no injected technologies', frontiers }));
});
