import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTION_FEATURES, BUILDINGS, CIVILIZATIONS, CONTENT, DIRECTOR_CLOCK_RULES,
  DIRECTOR_EVENTS, ERAS, HISTORICAL_MILESTONES, TECHNOLOGIES, VICTORY_RULES, validateContent,
} from '../core/content.ts';
import { CIV_COUNT } from '../core/types.ts';

function required<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}

await test('the shared catalogue is valid and has five distinct civilization identities', () => {
  assert.deepEqual(validateContent(), []);
  assert.equal(CIVILIZATIONS.length, CIV_COUNT);
  assert.equal(new Set(CIVILIZATIONS.map(civ => civ.name)).size, CIV_COUNT);
  assert.equal(new Set(CIVILIZATIONS.map(civ => civ.capital)).size, CIV_COUNT);
});

await test('the historical roadmap links each era to a discovery without promising it is released', () => {
  assert.equal(ERAS.length, 6);
  assert.equal(ERAS[0]?.id, 'settlement');
  assert.equal(ERAS.at(-1)?.id, 'interplanetary');
  for (const [index, era] of ERAS.entries()) {
    const technology = TECHNOLOGIES.find(item => item.id === era.technology);
    assert.ok(technology);
    assert.equal(technology.era, index);
    assert.equal(era.cost, technology.cost);
    assert.equal(era.capability, technology.capability);
    if (index > 0) assert.ok(technology.requires.includes(required(ERAS[index - 1]).technology));
  }
});

await test('the catalogue rejects duplicate identities and missing prerequisite references', () => {
  const duplicate = structuredClone(CONTENT);
  required(duplicate.technologies[1]).id = required(duplicate.technologies[0]).id;
  assert.ok(validateContent(duplicate).some(error => error.includes('duplicate')));
  const missing = structuredClone(CONTENT);
  required(missing.technologies[1]).requires = ['missing-discovery'];
  assert.ok(validateContent(missing).some(error => error.includes('missing-discovery')));
});

await test('research prerequisites cannot form a cycle or require an undiscovered future era', () => {
  const cycle = structuredClone(CONTENT);
  required(cycle.technologies[0]).requires = [required(cycle.technologies.at(-1)).id];
  assert.ok(validateContent(cycle).some(error => error.includes('cycle')));
  assert.ok(validateContent(cycle).some(error => error.includes('future')));
});

await test('construction uses valid discovery gates and real production or world effects', () => {
  assert.ok(BUILDINGS.some(building => Object.keys(building.production).length > 0));
  assert.ok(BUILDINGS.every(building => building.effects.length > 0));
  const launchpad = BUILDINGS.find(building => building.id === VICTORY_RULES.mars.requiredBuilding);
  assert.ok(launchpad);
  assert.ok(launchpad.requires.includes(VICTORY_RULES.mars.requiredTechnology));
  const broken = structuredClone(CONTENT);
  required(broken.buildings[0]).cost.food = -1;
  assert.ok(validateContent(broken).some(error => error.includes('cost')));
  required(broken.buildings[0]).requires = ['unknown-building-prerequisite'];
  assert.ok(validateContent(broken).some(error => error.includes('unknown-building-prerequisite')));
});

await test('director events use meaningful shared effects with era and cadence gates', () => {
  const calm = DIRECTOR_EVENTS.find(event => event.id === 'calm');
  assert.ok(calm);
  assert.equal(calm.effects.length, 0);
  assert.ok(DIRECTOR_EVENTS.filter(event => event.id !== 'calm').every(event => event.effects.length > 0));
  const effectKinds = new Set(DIRECTOR_EVENTS.flatMap(event => event.effects.map(effect => effect.kind)));
  assert.ok(effectKinds.has('resource'));
  assert.ok(effectKinds.has('city'));
  assert.ok(effectKinds.has('route'));
  assert.ok(effectKinds.has('civilization'));
  assert.ok(required(DIRECTOR_EVENTS.find(event => event.id === 'crypto-boom')).minEra >= 4);
  const broken = structuredClone(CONTENT);
  required(required(broken.events.find(event => event.id === 'drought')).effects[0]).amount = Number.NaN;
  assert.ok(validateContent(broken).some(error => error.includes('finite')));
});

await test('Mars and federation require developed supplied worlds rather than a single action', () => {
  assert.equal(VICTORY_RULES.mars.minEra, ERAS.length - 1);
  assert.ok(VICTORY_RULES.mars.suppliedRounds > 1);
  assert.ok(VICTORY_RULES.mars.population > 0);
  assert.ok(VICTORY_RULES.federation.minEra >= 4);
  assert.ok(VICTORY_RULES.federation.members >= 3);
  assert.ok(VICTORY_RULES.federation.members <= CIV_COUNT);
  assert.ok(VICTORY_RULES.federation.infrastructurePerMember > 0);
  assert.ok(VICTORY_RULES.federation.suppliedRounds > 1);
  assert.ok(VICTORY_RULES.federation.wellbeing > 0);
  for (const rule of Object.values(VICTORY_RULES)) {
    assert.ok(rule.upkeep.food && rule.upkeep.food > 0);
    assert.ok(rule.upkeep.energy && rule.upkeep.energy > 0);
  }
  const shortcut = structuredClone(CONTENT);
  shortcut.victoryRules.federation.minEra = 0;
  shortcut.victoryRules.federation.suppliedRounds = 1;
  assert.ok(validateContent(shortcut).some(error => error.includes('federation')));
});

await test('validation is deterministic and does not mutate the content it checks', () => {
  const input = structuredClone(CONTENT);
  const before = JSON.stringify(input);
  assert.deepEqual(validateContent(input), validateContent(input));
  assert.equal(JSON.stringify(input), before);
});

await test('unreleased systems have explicit gates in both content and action data', () => {
  assert.ok(TECHNOLOGIES.every(technology => technology.requiredFeatures.length > 0));
  assert.ok(BUILDINGS.every(building => building.requiredFeatures.length > 0));
  assert.ok(DIRECTOR_EVENTS.every(event => event.requiredFeatures.length > 0));
  assert.deepEqual(ACTION_FEATURES.trade, ['trade-routes']);
  assert.deepEqual(ACTION_FEATURES.expedition, ['interplanetary-logistics']);
  assert.ok(VICTORY_RULES.mars.requiredFeatures.includes('interplanetary-logistics'));
  const broken = structuredClone(CONTENT);
  required(broken.technologies[0]).requiredFeatures = ['unregistered-capability'];
  assert.ok(validateContent(broken).some(error => error.includes('unregistered-capability')));
});

await test('capability milestones require shipped features and actual world evidence', () => {
  assert.ok(HISTORICAL_MILESTONES.every(milestone => milestone.requiredFeatures.length > 0 && milestone.conditions.length > 0));
  const noEvidence = structuredClone(CONTENT);
  required(noEvidence.milestones[0]).conditions = [];
  assert.ok(validateContent(noEvidence).some(error => error.includes('world evidence')));
  const noFeature = structuredClone(CONTENT);
  required(noFeature.milestones[0]).requiredFeatures = [];
  assert.ok(validateContent(noFeature).some(error => error.includes('release feature gate')));
  const cycle = structuredClone(CONTENT);
  required(cycle.milestones[0]).requiresMilestones = [required(cycle.milestones.at(-1)).id];
  assert.ok(validateContent(cycle).some(error => error.includes('cycle')));
});

await test('the clock advances ten years per six minutes without event or review double-counting', () => {
  assert.equal(DIRECTOR_CLOCK_RULES.intervalMs, 6 * 60 * 1000);
  assert.equal(DIRECTOR_CLOCK_RULES.yearsPerTick, 10);
  assert.equal(DIRECTOR_CLOCK_RULES.majorEveryTicks * DIRECTOR_CLOCK_RULES.yearsPerTick, 100);
  assert.equal(DIRECTOR_CLOCK_RULES.maxCatchUpTicks, 240);
  assert.equal(DIRECTOR_CLOCK_RULES.eventAdvanceYears, 0);
  assert.equal(DIRECTOR_CLOCK_RULES.reviewAdvanceYears, 0);
  assert.ok(!('requiredFeatures' in DIRECTOR_CLOCK_RULES));
});

await test('a capability milestone cannot require a building unlocked by that same milestone', () => {
  const circular = structuredClone(CONTENT);
  required(circular.milestones.find(milestone => milestone.id === 'rise-of-states')).conditions = [{ kind: 'building-count', building: 'monument', minimum: 1 }];
  assert.ok(validateContent(circular).some(error => error.includes('circular building eligibility')));
});
