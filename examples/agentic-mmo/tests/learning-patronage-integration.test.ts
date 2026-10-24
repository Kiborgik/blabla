import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT, validateContent } from '../core/content.ts';
import { createGeneratedWorld } from '../core/generated-world.ts';
import { isWorldState } from '../core/validation.ts';
import { isKnowledgeInstitutionProof, knowledgeOperationEventMatches } from '../core/knowledge-validation.ts';
import type { KnowledgeInstitutionProof } from '../core/knowledge-types.ts';
import type { GameEvent } from '../core/types.ts';
import { ACTIVE_LOCAL_RELEASE_ID, LOCAL_SIMULATION_STORAGE_KEY, createLocalSimulation, advanceLocalSimulation, parseLocalSimulation } from '../web/local-simulation.ts';

void test('current patronage genesis starts empty and preserves exact same-version continuation', () => {
  const fresh = createLocalSimulation(1701);
  assert.match(ACTIVE_LOCAL_RELEASE_ID, /^settlement-/);
  assert.match(LOCAL_SIMULATION_STORAGE_KEY, /^civitas:procedural-observatory:/);
  assert.equal(fresh.state.releaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.equal(fresh.state.origin?.initialReleaseId, ACTIVE_LOCAL_RELEASE_ID);
  assert.ok(fresh.state.unlockedFeatures.includes('learning-patronage'));
  assert.ok(fresh.state.unlockedFeatures.includes('renewing-worked-woodlands'));
  assert.ok(fresh.state.civilizations.every(actor => actor.government?.active === null));
  assert.deepEqual(fresh.state.events.map(event => event.type), ['world-founded']);
  assert.ok(isWorldState(fresh.state));
  const progressed = advanceLocalSimulation(fresh, 6);
  const restored = parseLocalSimulation(JSON.parse(JSON.stringify(progressed)));
  assert.ok(restored);
  assert.deepEqual(advanceLocalSimulation(restored, 2), advanceLocalSimulation(progressed, 2));
  const missingFeature = structuredClone(fresh.state);
  missingFeature.unlockedFeatures = missingFeature.unlockedFeatures.filter(feature => feature !== 'learning-patronage');
  assert.equal(isWorldState(missingFeature), false);
});

void test('registered component genesis cannot silently grant the new policy feature', () => {
  const oldRules = createGeneratedWorld(1701, '2026-10-24T00:00:00.000Z', 'settlement-renewing-worked-woodlands-1');
  assert.ok(isWorldState(oldRules));
  assert.ok(!oldRules.unlockedFeatures.includes('learning-patronage'));
  assert.equal(oldRules.releaseId, 'settlement-renewing-worked-woodlands-1');
});

void test('data-defined policy effects require a meaningful gated paid-institution scope', () => {
  assert.deepEqual(validateContent(), []);
  const variants: Array<[string, (catalog: typeof CONTENT) => void]> = [
    ['empty modifier', catalog => { delete catalog.policies.find(policy => policy.id === 'learning-patronage')!.institutionalSciencePercent; }],
    ['missing gate', catalog => { const policy = catalog.policies.find(policy => policy.id === 'learning-patronage')!; policy.requiredFeatures = policy.requiredFeatures.filter(feature => feature !== 'learning-patronage'); }],
    ['empty group', catalog => { catalog.policies.find(policy => policy.id === 'learning-patronage')!.exclusiveGroup = ' '; }],
    ['unknown institution', catalog => { catalog.policies.find(policy => policy.id === 'learning-patronage')!.institutionalSciencePercent = { percent: 25, buildingIds: ['unknown'] }; }],
    ['duplicate institution', catalog => { catalog.policies.find(policy => policy.id === 'learning-patronage')!.institutionalSciencePercent = { percent: 25, buildingIds: ['library', 'library'] }; }],
    ['nonpositive percent', catalog => { catalog.policies.find(policy => policy.id === 'learning-patronage')!.institutionalSciencePercent = { percent: 0, buildingIds: ['library'] }; }],
    ['powered output', catalog => { catalog.policies.find(policy => policy.id === 'learning-patronage')!.institutionalSciencePercent = { percent: 25, buildingIds: ['research-lab'] }; }],
  ];
  for (const [label, mutate] of variants) {
    const catalog = structuredClone(CONTENT); mutate(catalog);
    assert.ok(validateContent(catalog).some(error => error.includes('policy learning-patronage:')), label);
  }
});

void test('teaching proofs retain exact policy receipt arithmetic and operation event effects', () => {
  const proof: KnowledgeInstitutionProof = {
    civId: 0, cityId: 'city-0', tileId: 1, institutionId: 'academy', inputs: { culture: 2, credits: 1 }, residentsRequired: 3, operationEventId: '12:3',
    result: { round: 7, status: 'operated', paid: { culture: 2, credits: 1 }, produced: { science: 3.75 }, shortages: [],
      residents: { ruleVersion: 1, openingPopulation: 9, communityReserve: 3, required: 3, available: 6, allocated: 3 },
      policyContribution: { policyId: 'learning-patronage', percent: 25, unboostedScience: 3, bonusScience: 0.75 } },
  };
  const event: GameEvent = { id: '12:3', round: 7, type: 'building-operation', title: 'Synthetic raw binding fixture', detail: 'city-0/academy at strategic round 7', actor: 0, target: 0, tileId: 1, cause: 'Raw validation case, not earned play', importance: 1,
    effects: ['Paid 1 credits', 'Paid 2 culture', 'Produced 3.75 science', 'Residents: required 3, opening capacity remaining 6, allocated 3; population is not consumed', 'Learning patronage: +0.75 science from 3 at 25%'] };
  assert.equal(isKnowledgeInstitutionProof(proof), true);
  assert.equal(knowledgeOperationEventMatches(event, proof), true);
  const altered = structuredClone(proof); altered.result.policyContribution!.bonusScience = 1;
  assert.equal(isKnowledgeInstitutionProof(altered), false);
  assert.equal(knowledgeOperationEventMatches(event, altered), false);
  assert.equal(knowledgeOperationEventMatches({ ...event, effects: event.effects.slice(0, -1) }, proof), false);
  assert.equal(knowledgeOperationEventMatches({ ...event, effects: [...event.effects, 'Invented contribution'] }, proof), false);
});
