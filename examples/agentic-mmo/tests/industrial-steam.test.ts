import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TECHNOLOGIES, validateContent } from '../core/content.ts';

void test('industrial steam research uses the four accepted prerequisite records without retuning', () => {
  for (const [id, cost, requires] of [
    ['scientific-method', 150, ['printing', 'astronomy']],
    ['shipbuilding', 66, ['sailing', 'celestial-navigation']],
    ['industrialization', 220, ['apprenticeship', 'metal-casting', 'scientific-method']],
    ['steam-power', 240, ['industrialization', 'shipbuilding']],
  ] as const) {
    const technology = TECHNOLOGIES.find(candidate => candidate.id === id);
    assert.ok(technology, `Missing connected technology ${id}`);
    assert.equal(technology.cost, cost);
    assert.deepEqual(technology.requires, requires);
  }
});

import { industrialSteamPrefix } from './fixtures/industrial-steam-journey.ts';
import { legalActions } from '../core/engine.ts';
import { isGameAction } from '../core/planning.ts';

void test('rail and explicit steam proposals have strict typed actions without caller prices', () => {
  assert.equal(isGameAction({ type: 'build-rail', cityId: 'city-0', fromTileId: 1, toTileId: 2 }), true);
  assert.equal(isGameAction({ type: 'build-rail', cityId: 'city-0', fromTileId: 1, toTileId: 2, cost: 0 }), false);
  assert.equal(isGameAction({ type: 'propose-trade', transportMode: 'steam', partner: 1, recipeId: 'harvest-for-materials', sourceCityId: 'city-0', recipientCityId: 'city-1' }), true);
});

void test('legal productive research reveals an actually reachable finite Coal consumer before era three', () => {
  const journey = industrialSteamPrefix();

  for (const technology of ['scientific-method', 'shipbuilding', 'industrialization', 'steam-power']) journey.research(technology);
  const mine = legalActions(journey.state, journey.seat, journey.time()).find(option => option.action.type === 'improve' && option.action.improvementId === 'mine' && journey.state.coalDeposits?.deposits[String(option.action.tileId)]);
  assert.ok(mine && mine.action.type === 'improve', 'The legal release terrain must expose an exact owned Coal Mine');
  const mineCityId = mine.action.cityId; const mineTileId = mine.action.tileId;
  journey.act(mine.action);
  journey.until(() => !!journey.state.cities.find(city => city.id === mineCityId)?.improvements?.[String(mineTileId)], 'The paid Coal Mine completes');
  journey.until(() => (journey.state.civilizations[journey.seat]?.strategicResources?.coal ?? 0) >= 2, 'Existing allocated residents actually extract Coal');
  assert.equal(journey.state.civilizations[journey.seat]?.era, 2);
  assert.ok(legalActions(journey.state, journey.seat, journey.time()).some(option => option.action.type === 'build-rail'), 'A funded legal rail action requires actual Coal first');
  assert.ok(journey.state.industrialEvidence?.foundryOperations.some(receipt => receipt.cityId === 'city-1'), 'An existing supplied Foundry must earn genuine post-release durable proof');
});

import * as transportModule from '../core/simulation/transport.ts';
void test('steam has a separate weighted quote interpreter rather than changing historical land quotes', () => {
  assert.equal(typeof Reflect.get(transportModule, 'createSteamTransportPlanner'), 'function');
  assert.equal(typeof Reflect.get(transportModule, 'isTransportQuote'), 'function');
});

import { industrialSteamJourney } from './fixtures/industrial-steam-journey.ts';
void test('one fresh synthetic-prerequisite scenario joins actual research, Coal, paid Rail, consent, funded faster delivery and the two-town industrial milestone', context => {
  const journey = industrialSteamJourney();
  for (const step of journey.steps) assert.ok(isWorldState(step.result.state), `Invalid durable frame ${step.result.state.revision}`);
  const proof = journey.state.industrialEvidence; assert.ok(proof?.steamDelivery);
  assert.equal(new Set(proof.foundryOperations.map(receipt => receipt.cityId)).size, 2);
  assert.equal(journey.state.year, journey.prepared.year);
  assert.equal(journey.state.clockTicks, journey.prepared.clockTicks);
  assert.equal(journey.researched.civilizations[journey.seat]?.era, 2);
  assert.equal(journey.twoFoundries.civilizations[journey.seat]?.era, 2);
  assert.equal(journey.state.civilizations[journey.seat]?.era, 3);
  const planner = transportModule.createSteamTransportPlanner(journey.beforeOffer);
  const sources = journey.beforeOffer.cities.filter(city => city.civId === 0);
  for (const from of sources) for (const to of journey.beforeOffer.cities) if (from.id !== to.id) planner.quote(from.tileId, to.tileId, 4);
  assert.equal(planner.work.trees, sources.length);
  assert.ok(planner.work.visitedTiles <= sources.length * journey.beforeOffer.tiles.length);
  assert.ok(planner.work.relaxedEdges <= sources.length * journey.beforeOffer.tiles.length * 6);
  context.diagnostic(JSON.stringify({ planner: planner.work, unrailedPlanner: planner.unrailedWork, evidenceBytes: Buffer.byteLength(JSON.stringify(proof)), railBytes: Buffer.byteLength(JSON.stringify(journey.state.railEdges)) }));
  context.diagnostic(JSON.stringify({ steps: journey.steps.length, rails: Object.keys(journey.state.railEdges ?? {}), proof, rounds: [journey.prepared.round, journey.state.round] }));
});

import { isWorldState } from '../core/validation.ts';
import { RELEASES } from '../core/release.ts';
void test('every supported old release excludes Industrialization and the new catalogue validates', () => {
  assert.deepEqual(validateContent(), []);
  assert.ok(RELEASES.filter(release => !release.featureIds.includes('industrial-steam')).every(release => !release.featureIds.includes('industrialization')));
});
