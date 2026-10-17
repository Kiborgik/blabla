import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTION_FEATURES, BUILDINGS, BUILDING_CAPABILITY_ACTIONS, COASTAL_FOUNDING_RULES, RESEARCH_INVESTMENT_RULES, CIVILIZATIONS, CONTENT, DIRECTOR_CLOCK_RULES, SETTLEMENT_SITE_OUTPUTS, ECONOMY_RULES,
  DIRECTOR_EVENTS, ERAS, HISTORICAL_MILESTONES, TECHNOLOGIES, TRADE_RECIPES, TRADE_RULES, LAND_TRANSPORT_RULES, PUBLIC_PROJECT_RECIPES, PUBLIC_PROJECT_RULES, VICTORY_RULES, validateContent,
} from '../core/content.ts';
import { CIV_COUNT } from '../core/types.ts';
import { CURRENT_RELEASE, RELEASES } from '../core/release.ts';

function required<T>(value: T | undefined): T {
  assert.ok(value !== undefined);
  return value;
}

await test('worked land has an explicit meaningful improvement catalogue', () => {
  const improvements: unknown = Reflect.get(CONTENT, 'improvements');
  assert.ok(Array.isArray(improvements) && improvements.length > 0);
});

await test('worked Mine data rejects broken site support and productive purpose', () => {
  const mine = required(CONTENT.improvements.find(improvement => improvement.id === 'mine'));
  assert.deepEqual(mine.cost, { materials: 6, credits: 3 });
  assert.equal(mine.requiredWork, 4);
  assert.equal(mine.residentsRequired, 1);
  assert.deepEqual(mine.production, { materials: 2 });
  assert.deepEqual(mine.requires, ['mining']);
  for (const mutate of [
    (catalog: typeof CONTENT) => { required(catalog.improvements[0]).residentsRequired = 0; },
    (catalog: typeof CONTENT) => { required(catalog.improvements[0]).siteRange = 0; },
    (catalog: typeof CONTENT) => { required(catalog.improvements[0]).requiredWork = -1; },
    (catalog: typeof CONTENT) => { required(catalog.improvements[0]).production = {}; },
    (catalog: typeof CONTENT) => { required(catalog.improvements[0]).requires = ['unknown']; },
    (catalog: typeof CONTENT) => { required(catalog.improvements[0]).requires = ['spaceflight']; },
    (catalog: typeof CONTENT) => { required(catalog.improvements[0]).requiredFeatures = ['mining']; },
    (catalog: typeof CONTENT) => { required(catalog.improvements[0]).cost.materials = Number.NaN; },
  ]) {
    const broken = structuredClone(CONTENT);
    mutate(broken);
    assert.ok(validateContent(broken).some(error => error.includes('improvement')));
  }
});

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
  required(cycle.technologies.find(technology => technology.id === 'agriculture')).requires = ['spaceflight'];
  assert.ok(validateContent(cycle).some(error => error.includes('cycle')));
  assert.ok(validateContent(cycle).some(error => error.includes('future')));
});

await test('construction uses valid gates and real production, world effects or consumed capabilities', () => {
  assert.ok(BUILDINGS.some(building => Object.keys(building.production).length > 0));
  assert.ok(BUILDINGS.every(building => building.effects.length > 0 || (building.housing ?? 0) > 0 || Object.values(building.production).some(amount => amount > 0) || (building.capabilities ?? []).some(capability => BUILDING_CAPABILITY_ACTIONS[capability]?.length > 0)));
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

await test('trade recipes and pacing are validated shared content rather than hidden engine constants', () => {
  assert.equal(TRADE_RULES.offerExpiryRounds, 8);
  assert.equal(required(TRADE_RECIPES[0]).terms.cadenceRounds, 4);
  const base = { ...structuredClone(CONTENT), tradeRecipes: structuredClone(TRADE_RECIPES), tradeRules: { ...TRADE_RULES } };
  required(base.tradeRecipes[0]).terms.cadenceRounds = 0;
  assert.ok(validateContent(base).some(error => error.includes('trade')));
  const invalidCost = { ...structuredClone(CONTENT), tradeRecipes: structuredClone(TRADE_RECIPES), tradeRules: { ...TRADE_RULES } };
  required(invalidCost.tradeRecipes[0]).terms.proposerCargo.food = -1;
  assert.ok(validateContent(invalidCost).some(error => error.includes('trade')));
  const invalidIdentity = { ...structuredClone(CONTENT), tradeRecipes: structuredClone(TRADE_RECIPES), tradeRules: { ...TRADE_RULES } };
  required(invalidIdentity.tradeRecipes[0]).terms.recipeVersion = 2;
  assert.ok(validateContent(invalidIdentity).some(error => error.includes('trade')));
  const invalidFeature = { ...structuredClone(CONTENT), tradeRecipes: structuredClone(TRADE_RECIPES), tradeRules: { ...TRADE_RULES } };
  required(invalidFeature.tradeRecipes[0]).requiredFeatures = ['missing-trade-feature'];
  assert.ok(validateContent(invalidFeature).some(error => error.includes('missing-trade-feature')));
  const invalidLimit = { ...structuredClone(CONTENT), tradeRecipes: structuredClone(TRADE_RECIPES), tradeRules: { ...TRADE_RULES, maxPendingPerPair: 0 } };
  assert.ok(validateContent(invalidLimit).some(error => error.includes('trade')));
});

await test('prepared production branches require shared operating inputs and explicit release gates', () => {
  for (const [technologyId, buildingId, resource, amount] of [['water-management', 'irrigation', 'materials', 1], ['kiln-firing', 'kiln', 'energy', 2]] as const) {
    const technology = required(TECHNOLOGIES.find(item => item.id === technologyId));
    const building = required(BUILDINGS.find(item => item.id === buildingId));
    assert.equal(technology.cost, 16);
    assert.deepEqual(technology.requires, ['agriculture']);
    assert.ok(building.requires.includes(technologyId));
    assert.ok(building.requiredFeatures.includes('building-operations'));
    assert.equal(building.operatingInputs?.[resource], amount);
    const invalid = structuredClone(CONTENT);
    required(invalid.buildings.find(item => item.id === buildingId)).operatingInputs = { [resource]: -1 };
    assert.ok(validateContent(invalid).some(error => error.includes('operating inputs')));
  }
  assert.deepEqual(ACTION_FEATURES['set-building-operation'], ['building-operations']);
});

await test('frontier site yields are shared validated data and founding keeps a populated source', () => {
  assert.deepEqual(SETTLEMENT_SITE_OUTPUTS.grassland, { food: 2 });
  assert.deepEqual(SETTLEMENT_SITE_OUTPUTS.forest, { materials: 2 });
  assert.equal(ECONOMY_RULES.settle.population, 3);
  assert.equal(ECONOMY_RULES.settle.minimumSourcePopulation, 3);
  for (const siteOutputs of [{ grassland: { food: -1 } }, { forest: { materials: Infinity } }, { ocean: { food: 2 } }]) {
    assert.ok(validateContent({ ...structuredClone(CONTENT), siteOutputs }).some(error => error.includes('site output')));
  }
});

await test('recoverable disasters use gated effects while preserving historical earthquake data', () => {
  const earthquake = required(DIRECTOR_EVENTS.find(event => event.id === 'earthquake'));
  assert.ok(earthquake.effects.some(effect => effect.kind === 'city' && effect.field === 'infrastructure' && effect.amount === -1));
  const released = required(earthquake.releasedEffects);
  assert.deepEqual(released.requiredFeatures, ['city-repair']);
  assert.ok(released.effects.some(effect => effect.kind === 'city' && effect.field === 'damage' && effect.amount === 35));
  assert.ok(!released.effects.some(effect => effect.kind === 'city' && effect.field === 'infrastructure'));
  assert.deepEqual(ACTION_FEATURES['repair-city'], ['city-repair']);
  for (const variant of [
    { requiredFeatures: [], effects: released.effects },
    { requiredFeatures: ['unknown-recovery-feature'], effects: released.effects },
    { requiredFeatures: released.requiredFeatures, effects: [] },
    { requiredFeatures: released.requiredFeatures, effects: [{ kind: 'city' as const, field: 'damage' as const, amount: Infinity }] },
  ]) {
    const invalid = structuredClone(CONTENT);
    required(invalid.events.find(event => event.id === 'earthquake')).releasedEffects = structuredClone(variant);
    assert.ok(validateContent(invalid).some(error => error.includes('released effects')));
  }
});

await test('the civic branch connects culture-funded learning to a useful fuel commitment behind one explicit release', () => {
  const learning = required(BUILDINGS.find(building => building.id === 'academy'));
  assert.deepEqual(learning.operatingInputs, { culture: 2, credits: 1 });
  assert.deepEqual(learning.production, { science: 3 });
  assert.ok(learning.requiredFeatures.includes('building-operations'));
  const fuel = required(TECHNOLOGIES.find(technology => technology.id === 'fuel-management'));
  assert.equal(fuel.cost, 28);
  assert.deepEqual(fuel.requires, ['civic-institutions', 'kiln-firing']);
  const yard = required(BUILDINGS.find(building => building.id === 'fuel-yard'));
  assert.deepEqual(yard.cost, { materials: 14, credits: 8 });
  assert.deepEqual(yard.operatingInputs, { materials: 2 });
  assert.deepEqual(yard.production, { energy: 3 });
  assert.deepEqual(yard.effects, []);
  assert.deepEqual(yard.requires, [fuel.id]);
  const civic = required(RELEASES.find(release => release.id === 'settlement-civics-1'));
  assert.deepEqual(civic.compatibleFrom, ['settlement-recovery-1']);
  assert.deepEqual(RELEASES.filter(release => release.featureIds.includes('statecraft')).map(release => release.id), [civic.id, 'settlement-charters-1', 'settlement-endpoints-1', 'settlement-land-transport-1', 'settlement-operating-exchange-1', 'settlement-decisions-1', 'settlement-residents-1', 'settlement-coastal-1', 'settlement-research-rate-1', 'settlement-writing-1', 'settlement-mining-1', 'settlement-metal-learning-1', 'settlement-manufacturing-1', 'settlement-wonders-1', 'settlement-growth-1', 'settlement-water-land-1', 'settlement-forest-production-1', 'settlement-world-expansion-1', 'settlement-territory-1', 'settlement-culture-production-1', 'settlement-foundry-1', 'settlement-observatory-1']);
  assert.equal(CURRENT_RELEASE.id, 'settlement-foundations-1');
  assert.deepEqual(validateContent(), []);
});

await test('exact trade town selection is an additive explicit capability without changing the default world', () => {
  const charter = required(RELEASES.find(release => release.id === 'settlement-charters-1'));
  const endpoints = required(RELEASES.find(release => release.id === 'settlement-endpoints-1'));
  assert.deepEqual(endpoints.compatibleFrom, [charter.id]);
  assert.deepEqual(endpoints.featureIds, [...charter.featureIds, 'exact-trade-endpoints']);
  assert.deepEqual(RELEASES.filter(release => release.featureIds.includes('exact-trade-endpoints')).map(release => release.id), [endpoints.id, 'settlement-land-transport-1', 'settlement-operating-exchange-1', 'settlement-decisions-1', 'settlement-residents-1', 'settlement-coastal-1', 'settlement-research-rate-1', 'settlement-writing-1', 'settlement-mining-1', 'settlement-metal-learning-1', 'settlement-manufacturing-1', 'settlement-wonders-1', 'settlement-growth-1', 'settlement-water-land-1', 'settlement-forest-production-1', 'settlement-world-expansion-1', 'settlement-territory-1', 'settlement-culture-production-1', 'settlement-foundry-1', 'settlement-observatory-1']);
  assert.equal(CURRENT_RELEASE.id, 'settlement-foundations-1');
  assert.deepEqual(validateContent(), []);
});

await test('public repair promises use validated bounded shared civic terms', () => {
  const recipe = required(PUBLIC_PROJECT_RECIPES.find(candidate => candidate.id === 'joint-road-repair'));
  assert.deepEqual(recipe.terms.proposerContribution, { materials: 2, energy: 1 });
  assert.deepEqual(recipe.terms.recipientContribution, recipe.terms.proposerContribution);
  assert.equal(recipe.terms.damageReduction, 25);
  assert.equal(recipe.terms.pendingLifetimeRounds, 4);
  assert.equal(recipe.terms.completionDelayRounds, 2);
  assert.equal(recipe.requiredTechnology, 'civic-institutions');
  assert.equal(recipe.requiredBuilding, 'monument');
  assert.equal(PUBLIC_PROJECT_RULES.maxActivePerPair, 1);
  assert.equal(PUBLIC_PROJECT_RULES.maxActiveTotal, CIV_COUNT * (CIV_COUNT - 1) / 2);
  for (const action of ['propose-public-project', 'respond-public-project', 'cancel-public-project'] as const)
    assert.deepEqual(ACTION_FEATURES[action], ['public-projects']);
  assert.ok(!CURRENT_RELEASE.featureIds.includes('public-projects'));
  const civic = required(RELEASES.find(release => release.id === 'settlement-civics-1'));
  const charter = required(RELEASES.find(release => release.id === 'settlement-charters-1'));
  assert.deepEqual(charter.compatibleFrom, [civic.id]);
  assert.deepEqual(charter.featureIds, [...civic.featureIds, 'public-projects']);
  assert.deepEqual(validateContent(), []);
});

await test('public project catalogue rejects empty payments, invalid timing and unknown civic gates', () => {
  for (const change of [
    { terms: { proposerContribution: {} } },
    { terms: { recipientContribution: { energy: -1 } } },
    { terms: { damageReduction: 101 } },
    { terms: { completionDelayRounds: 0 } },
    { terms: { pendingLifetimeRounds: 0.5 } },
    { terms: { recipeVersion: 99 } },
    { requiredTechnology: 'missing-discovery' },
    { requiredBuilding: 'missing-building' },
    { requiredFeatures: [] },
  ]) {
    const invalid = structuredClone(CONTENT);
    const recipe = required(invalid.publicProjectRecipes[0]);
    Object.assign(recipe, change, { terms: { ...recipe.terms, ...change.terms } });
    assert.ok(validateContent(invalid).some(error => error.startsWith('public project')));
  }
  const duplicate = structuredClone(CONTENT);
  duplicate.publicProjectRecipes.push(structuredClone(required(duplicate.publicProjectRecipes[0])));
  assert.ok(validateContent(duplicate).some(error => error.includes('duplicate identifier')));
  const invalidLimit = structuredClone(CONTENT);
  invalidLimit.publicProjectRules.maxActiveTotal = 0;
  assert.ok(validateContent(invalidLimit).some(error => error.includes('public project rules')));
});

await test('land transport is versioned shared data behind a compatible explicit release', () => {
  const endpoints = required(RELEASES.find(release => release.id === 'settlement-endpoints-1'));
  const land = required(RELEASES.find(release => release.id === 'settlement-land-transport-1'));
  assert.deepEqual(land.compatibleFrom, [endpoints.id]);
  assert.deepEqual(land.featureIds, [...endpoints.featureIds, 'land-transport']);
  assert.deepEqual(LAND_TRANSPORT_RULES, { ruleVersion: 1, edgesPerBeat: 2, passable: { grassland: true, forest: true, desert: true, tundra: true, mountain: false, ocean: false } });
  assert.equal(CURRENT_RELEASE.id, 'settlement-foundations-1');
  assert.equal(land.featureIds.includes('navigation'), false);
  for (const pace of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    const invalid = structuredClone(CONTENT);
    invalid.landTransportRules.edgesPerBeat = pace;
    assert.ok(validateContent(invalid).some(error => error.includes('land transport')));
  }
  const missingTerrain = structuredClone(CONTENT);
  Reflect.deleteProperty(missingTerrain.landTransportRules.passable, 'ocean');
  assert.ok(validateContent(missingTerrain).some(error => error.includes('passability')));
  assert.deepEqual(validateContent(), []);
});

await test('coastal yards grant only a validated consumed capability behind an explicit compatible release', () => {
  const yard = required(BUILDINGS.find(building => building.id === 'boat-yard'));
  assert.deepEqual(yard.requires, ['water-management']);
  assert.equal(yard.minEra, 0);
  assert.equal(yard.siteRequirement, 'coastal');
  assert.deepEqual(yard.capabilities, ['coastal-departure']);
  assert.deepEqual(yard.production, {});
  assert.deepEqual(yard.effects, []);
  assert.deepEqual(yard.cost, { materials: 14, credits: 10 });
  assert.deepEqual(BUILDING_CAPABILITY_ACTIONS['coastal-departure'], ['settle-coast']);
  assert.equal(COASTAL_FOUNDING_RULES.requiredTechnology, 'navigation');
  const release = required(RELEASES.find(candidate => candidate.id === 'settlement-coastal-1'));
  const prior = required(RELEASES.find(candidate => candidate.id === 'settlement-residents-1'));
  assert.deepEqual(release.compatibleFrom, [prior.id]);
  assert.deepEqual(release.featureIds, [...prior.featureIds, 'navigation', 'coastal-founding']);
  assert.ok(!prior.featureIds.includes('coastal-founding'));
  const connected = required(HISTORICAL_MILESTONES.find(milestone => milestone.id === 'connected-world'));
  assert.ok(connected.conditions.some(condition => condition.kind === 'recorded-event-count' && condition.eventType === 'coastal-founded' && condition.minimum === 1));
  for (const [field, value, error] of [
    ['capabilities', ['unknown-capability'], 'unknown capability'],
    ['capabilities', [], 'no production or world effect'],
    ['capabilities', ['coastal-departure', 'coastal-departure'], 'duplicate capabilities'],
    ['siteRequirement', undefined, 'coastal departure requires'],
    ['siteRequirement', 'mountain', 'unknown site requirement'],
    ['requiredFeatures', [], 'coastal departure requires'],
  ] as const) {
    const invalid = structuredClone(CONTENT);
    Reflect.set(required(invalid.buildings.find(building => building.id === 'boat-yard')), field, value);
    assert.ok(validateContent(invalid).some(message => message.includes(error)), error);
  }
});

await test('productive research is a prospective release with a canonical output budget', () => {
  const prior = required(RELEASES.find(release => release.id === 'settlement-coastal-1'));
  const current = required(RELEASES.find(release => release.id === 'settlement-research-rate-1'));
  assert.equal(RESEARCH_INVESTMENT_RULES.ruleVersion, 1);
  assert.equal(RESEARCH_INVESTMENT_RULES.budget, 'current-city-science-output');
  assert.ok(!prior.featureIds.includes(RESEARCH_INVESTMENT_RULES.featureId));
  assert.ok(current.featureIds.includes(RESEARCH_INVESTMENT_RULES.featureId));
  assert.deepEqual(current.featureIds.filter(feature => !prior.featureIds.includes(feature)), ['productive-research']);
});

await test('district metadata and local building dependencies are validated before release', () => {
  const campus = required(BUILDINGS.find(building => building.id === 'campus'));
  const library = required(BUILDINGS.find(building => building.id === 'library'));
  assert.deepEqual(library.requiresBuildings, ['campus']);
  assert.deepEqual(campus.district, { range: 3, adjacency: { terrain: 'mountain', resource: 'science', amount: 1, maximum: 3 } });
  for (const [field, value, error] of [
    ['range', 0, 'district range'],
    ['range', 1.5, 'district range'],
    ['terrain', 'unknown', 'district terrain'],
    ['resource', 'unknown', 'district resource'],
    ['amount', Number.NaN, 'district adjacency'],
    ['amount', -1, 'district adjacency'],
    ['maximum', -1, 'district adjacency'],
  ] as const) {
    const invalid = structuredClone(CONTENT);
    const district = required(required(invalid.buildings.find(building => building.id === 'campus')).district);
    Reflect.set(field === 'range' ? district : required(district.adjacency), field, value);
    assert.ok(validateContent(invalid).some(message => message.includes(error)), error);
  }
  const unknown = structuredClone(CONTENT);
  required(unknown.buildings.find(building => building.id === 'library')).requiresBuildings = ['missing-campus'];
  assert.ok(validateContent(unknown).some(message => message.includes('missing building prerequisite')));
  const cycle = structuredClone(CONTENT);
  required(cycle.buildings.find(building => building.id === 'campus')).requiresBuildings = ['library'];
  assert.ok(validateContent(cycle).some(message => message.includes('prerequisite cycle')));
  const future = structuredClone(CONTENT);
  required(future.buildings.find(building => building.id === 'campus')).minEra = 1;
  assert.ok(validateContent(future).some(message => message.includes('future building prerequisite')));
  const ungated = structuredClone(CONTENT);
  required(ungated.buildings.find(building => building.id === 'campus')).requiredFeatures = ['writing'];
  assert.ok(validateContent(ungated).some(message => message.includes('district-planning feature')));
  assert.deepEqual(validateContent(), []);
});

await test('connected metal and learning branch has useful compatible declarations', () => {
  for (const [id, cost, requires] of [
    ['bronze-working', 36, ['mining']], ['currency', 42, ['writing']],
    ['mathematics', 44, ['writing', 'currency']], ['education', 72, ['mathematics', 'writing']],
    ['banking', 120, ['currency', 'education']],
  ] as const) {
    const technology = required(TECHNOLOGIES.find(item => item.id === id));
    assert.equal(technology.cost, cost * 3);
    assert.deepEqual(technology.requires, requires);
  }
  const hub = required(BUILDINGS.find(item => item.id === 'commercial-hub'));
  assert.deepEqual(hub.district, { range: 3 });
  assert.deepEqual(hub.production, { credits: 2 });
  for (const [id, building, inputs, output] of [
    ['market', 'commercial-hub', { credits: 1 }, { credits: 4 }],
    ['university', 'campus', { credits: 2 }, { science: 5 }],
    ['bank', 'commercial-hub', { credits: 1 }, { credits: 7 }],
  ] as const) {
    const definition = required(BUILDINGS.find(item => item.id === id));
    assert.deepEqual(definition.requiresBuildings, [building]);
    assert.deepEqual(definition.operatingInputs, inputs);
    assert.deepEqual(definition.production, output);
  }
  const recipe = required(TRADE_RECIPES.find(item => item.id === 'iron-for-food'));
  assert.equal(Reflect.get(recipe, 'requiredTechnology'), 'currency');
  assert.deepEqual(Reflect.get(recipe.terms, 'strategicCargo'), { proposer: { iron: 2 }, recipient: {} });
  assert.deepEqual(recipe.terms.recipientCargo, { food: 5 });
  const release = required(RELEASES.find(item => item.id === 'settlement-metal-learning-1'));
  assert.deepEqual(release.compatibleFrom, ['settlement-mining-1']);
  assert.deepEqual(validateContent(), []);
});

await test('unique wonders declare a compatible paid contest and bounded boost benefit', () => {
  const wonder = required(CONTENT.wonders.find(item => item.id === 'great-library'));
  assert.deepEqual(wonder.requires, ['writing']);
  assert.equal(wonder.minEra, 1);
  assert.deepEqual(wonder.cost, { materials: 50, credits: 25 });
  assert.equal(wonder.requiredWork, 24);
  assert.deepEqual(wonder.production, { science: 4 });
  assert.deepEqual(CONTENT.wonderRules, { ruleVersion: 1, featureId: 'unique-wonders', loserMaterialRefundPercent: 50, boostLimit: 2, boostPercent: 20, boostMaximumEra: 1 });
  assert.deepEqual(required(RELEASES.find(item => item.id === 'settlement-wonders-1')).compatibleFrom, ['settlement-manufacturing-1']);
  assert.deepEqual(validateContent(), []);
});

await test('wonder declarations reject invalid gates work prerequisites and benefit rules', () => {
  for (const mutate of [
    (catalog: typeof CONTENT) => { required(catalog.wonders[0]).requiredWork = 0; },
    (catalog: typeof CONTENT) => { required(catalog.wonders[0]).siteRange = -1; },
    (catalog: typeof CONTENT) => { required(catalog.wonders[0]).requires = ['unknown']; },
    (catalog: typeof CONTENT) => { required(catalog.wonders[0]).requires = ['spaceflight']; },
    (catalog: typeof CONTENT) => { required(catalog.wonders[0]).requiredFeatures = ['recurring-decisions']; },
    (catalog: typeof CONTENT) => { required(catalog.wonders[0]).cost = {}; },
    (catalog: typeof CONTENT) => { required(catalog.wonders[0]).production = {}; },
    (catalog: typeof CONTENT) => { Reflect.set(catalog.wonderRules, 'boostLimit', 3); },
    (catalog: typeof CONTENT) => { Reflect.set(catalog.wonderRules, 'loserMaterialRefundPercent', 100); },
  ]) {
    const invalid = structuredClone(CONTENT);
    mutate(invalid);
    assert.ok(validateContent(invalid).some(error => error.includes('wonder')));
  }
});

await test('local growth data declares a gated paid housing consequence without rewriting legacy rules', () => {
  const masonry = required(TECHNOLOGIES.find(technology => technology.id === 'masonry'));
  const granary = required(BUILDINGS.find(building => building.id === 'granary'));
  assert.equal(masonry.cost, 84);
  assert.deepEqual(masonry.requires, ['mining']);
  assert.deepEqual(granary.cost, { materials: 14, credits: 6 });
  assert.equal(granary.housing, 4);
  assert.deepEqual(granary.production, { food: 2 });
  assert.equal(granary.operatingInputs, undefined);
  assert.equal(ECONOMY_RULES.growth.cityPopulationCap, 20);
  assert.equal(ECONOMY_RULES.growth.foodCost, 6);
  const release = required(RELEASES.find(item => item.id === 'settlement-growth-1'));
  assert.deepEqual(release.compatibleFrom, ['settlement-wonders-1']);
  assert.ok(release.featureIds.includes('local-growth'));
  for (const housing of [-1, 0, 1.5, Number.NaN]) {
    const broken = structuredClone(CONTENT);
    required(broken.buildings.find(item => item.id === 'granary')).housing = housing;
    assert.ok(validateContent(broken).some(error => error.includes('housing')));
  }
  const ungated = structuredClone(CONTENT);
  required(ungated.buildings.find(item => item.id === 'granary')).requiredFeatures = ['settlement-production'];
  assert.ok(validateContent(ungated).some(error => error.includes('housing')));
});

await test('water and land connect real sites and local infrastructure without a phantom horse stock', () => {
  for (const [id, cost, prerequisites] of [
    ['animal-husbandry', 60, ['agriculture']],
    ['wheel', 84, ['animal-husbandry', 'kiln-firing']],
    ['engineering', 144, ['wheel', 'masonry']],
  ] as const) {
    const technology = required(TECHNOLOGIES.find(item => item.id === id));
    assert.equal(technology.cost, cost);
    assert.deepEqual(technology.requires, prerequisites);
    assert.deepEqual(technology.requiredFeatures, ['water-land']);
  }
  const pasture = required(CONTENT.improvements.find(item => item.id === 'pasture'));
  assert.equal(pasture.siteRequirement, 'revealed-horse-site');
  assert.deepEqual(pasture.cost, { materials: 6, credits: 3 });
  assert.equal(pasture.requiredWork, 3);
  assert.equal(pasture.residentsRequired, 1);
  assert.deepEqual(pasture.production, { food: 2 });
  const mill = required(BUILDINGS.find(item => item.id === 'water-mill'));
  assert.deepEqual(mill.requiresBuildings, ['irrigation']);
  assert.deepEqual(mill.production, { food: 1, materials: 2 });
  const aqueduct = required(BUILDINGS.find(item => item.id === 'aqueduct'));
  assert.equal(aqueduct.siteRequirement, 'mountain-catchment');
  assert.equal(aqueduct.housing, 6);
  assert.equal(aqueduct.minEra, 1);
  assert.deepEqual(aqueduct.production, {});
  assert.equal(CONTENT.pastoralRules.placement.maximumSites, 10);
  assert.equal(CONTENT.pastoralRules.placement.seedSalt, 0x50415354);
  assert.equal(CONTENT.pastoralRules.resource, 'horses');
  const predecessor = required(RELEASES.find(item => item.id === 'settlement-growth-1'));
  const release = required(RELEASES.find(item => item.id === 'settlement-water-land-1'));
  assert.deepEqual(release.compatibleFrom, [predecessor.id]);
  assert.deepEqual(release.featureIds, [...predecessor.featureIds, 'water-land']);
  assert.equal(CURRENT_RELEASE.id, 'settlement-foundations-1');
  assert.deepEqual(validateContent(), []);
});

await test('water land catalogue refuses invalid retained placement and ungated site consumers', () => {
  for (const mutate of [
    (catalog: typeof CONTENT) => { Reflect.set(catalog.pastoralRules.placement, 'seedSalt', 0); },
    (catalog: typeof CONTENT) => { Reflect.set(catalog.pastoralRules.placement, 'maximumSites', 0); },
    (catalog: typeof CONTENT) => { Reflect.set(catalog.pastoralRules.placement, 'frontierMinimumDistance', 0); },
    (catalog: typeof CONTENT) => { Reflect.set(catalog.pastoralRules, 'revealTechnology', 'unknown'); },
    (catalog: typeof CONTENT) => { required(catalog.improvements.find(item => item.id === 'pasture')).requiredFeatures = ['worked-land', 'resident-capacity', 'recurring-decisions']; },
    (catalog: typeof CONTENT) => { required(catalog.buildings.find(item => item.id === 'aqueduct')).requiredFeatures = ['local-growth']; },
    (catalog: typeof CONTENT) => { required(catalog.buildings.find(item => item.id === 'aqueduct')).housing = 0; },
  ]) {
    const broken = structuredClone(CONTENT);
    mutate(broken);
    assert.ok(validateContent(broken).length > 0);
  }
});

await test('forest and append-only extent are explicit compatible successors', async () => {
  const { WORLD_EXPANSION_RULES } = await import('../core/content.ts');
  assert.deepEqual(validateContent(), []);
  assert.equal(TECHNOLOGIES.find(item => item.id === 'archery')?.cost, 72);
  assert.deepEqual(TECHNOLOGIES.find(item => item.id === 'machinery')?.requires, ['engineering', 'archery']);
  const mill = CONTENT.improvements.find(item => item.id === 'lumber-mill');
  assert.equal(mill?.requiredWork, 6); assert.equal(mill?.residentsRequired, 1);
  assert.deepEqual(mill?.production, { materials: 4 }); assert.equal(mill?.siteRequirement, 'forest');
  assert.equal(WORLD_EXPANSION_RULES.fromHeight, 12); assert.equal(WORLD_EXPANSION_RULES.height, 24);
  assert.equal(WORLD_EXPANSION_RULES.fromWidth, WORLD_EXPANSION_RULES.width);
  assert.deepEqual(RELEASES.find(item => item.id === 'settlement-forest-production-1')?.compatibleFrom, ['settlement-water-land-1']);
  assert.deepEqual(RELEASES.find(item => item.id === 'settlement-world-expansion-1')?.compatibleFrom, ['settlement-forest-production-1']);
});

await test('owned territory retains an explicit price basis and compatible feature gate', async () => {
  const { TERRITORY_RULES } = await import('../core/content.ts');
  assert.deepEqual(validateContent(), []);
  assert.deepEqual(TERRITORY_RULES, { ruleVersion: 1, featureId: 'owned-territory', range: 3, baseCredits: 12, creditsPerDistance: 4, creditsPerPriorPurchase: 2 });
  assert.deepEqual(ACTION_FEATURES['acquire-tile'], ['owned-territory']);
  assert.deepEqual(RELEASES.find(item => item.id === 'settlement-territory-1')?.compatibleFrom, ['settlement-world-expansion-1']);
  for (const [key, value] of [['range', 4], ['baseCredits', -1], ['creditsPerDistance', 0.5], ['featureId', 'missing']] as const) {
    const broken = structuredClone(CONTENT); Reflect.set(broken.territoryRules, key, value);
    assert.ok(validateContent(broken).some(error => error.startsWith('territory:')));
  }
});

await test('culture catalogue declares meaningful exact districts and paid local consumers', () => {
  const theater = required(BUILDINGS.find(item => item.id === 'theater-square'));
  const house = required(BUILDINGS.find(item => item.id === 'printing-house'));
  assert.deepEqual(theater.district?.adjacency, { wonder: true, resource: 'culture', amount: 2, maximum: 4 });
  assert.deepEqual(house.requiresBuildings, ['theater-square']);
  assert.deepEqual(house.operatingInputs, { materials: 1 });
  assert.deepEqual(house.production, { culture: 6 });
  for (const change of [{ wonder: false }, { wonder: 'great-library' }, { wonder: true, terrain: 'mountain' }, { wonder: true, improvement: 'mine' }]) {
    const catalog = structuredClone(CONTENT);
    const target = required(catalog.buildings.find(item => item.id === 'theater-square'));
    assert.ok(target.district?.adjacency);
    Object.assign(target.district.adjacency, change);
    assert.ok(validateContent(catalog).some(error => error.includes('district')));
  }
});

await test('foundry catalogue preserves the connected prerequisite chain and useful mixed recipe', () => {
  assert.deepEqual(validateContent(), []);
  for (const [id, cost, requires] of [
    ['military-engineering', 240, ['construction', 'iron-working']],
    ['gunpowder', 390, ['military-engineering', 'apprenticeship']],
    ['metal-casting', 450, ['gunpowder', 'machinery']],
  ] as const) {
    const technology = required(TECHNOLOGIES.find(item => item.id === id));
    assert.equal(technology.cost, cost);
    assert.deepEqual(technology.requires, requires);
  }
  const foundry = required(BUILDINGS.find(item => item.id === 'foundry'));
  assert.deepEqual(foundry.requiresBuildings, ['industrial-zone']);
  assert.deepEqual(foundry.strategicInputs, { iron: 1 });
  assert.deepEqual(foundry.operatingInputs, { energy: 2 });
  assert.deepEqual(foundry.production, { materials: 8 });
  assert.deepEqual(RELEASES.find(item => item.id === 'settlement-foundry-1')?.compatibleFrom, ['settlement-culture-production-1']);
});

await test('foundry catalogue refuses empty unknown fractional or ungated strategic inputs', () => {
  for (const inputs of [{}, { iron: -1 }, { iron: 0.5 }, { horses: 1 }]) {
    const catalog = structuredClone(CONTENT);
    Reflect.set(required(catalog.buildings.find(item => item.id === 'foundry')), 'strategicInputs', inputs);
    assert.ok(validateContent(catalog).some(error => error.includes('strategic operating inputs')));
  }
  for (const gate of ['foundry-production', 'finite-metals', 'building-operations', 'resident-capacity']) {
    const catalog = structuredClone(CONTENT);
    const foundry = required(catalog.buildings.find(item => item.id === 'foundry'));
    foundry.requiredFeatures = foundry.requiredFeatures.filter(feature => feature !== gate);
    assert.ok(validateContent(catalog).some(error => error.includes('strategic operating inputs')));
  }
});

await test('observatory catalogue connects paid local learning to the retained Campus high ground', () => {
  for (const [id, cost, requires] of [
    ['sailing', 72, ['water-management']],
    ['celestial-navigation', 132, ['sailing', 'writing']],
    ['astronomy', 360, ['mathematics', 'celestial-navigation']],
  ] as const) {
    const technology = required(TECHNOLOGIES.find(item => item.id === id));
    assert.equal(technology.cost, cost);
    assert.deepEqual(technology.requires, requires);
  }
  const observatory = required(BUILDINGS.find(item => item.id === 'observatory'));
  assert.deepEqual(observatory.requiresBuildings, ['campus']);
  assert.equal(observatory.siteRequirement, 'campus-high-ground');
  assert.deepEqual(observatory.operatingInputs, { credits: 2 });
  assert.deepEqual(observatory.production, { science: 7 });
  assert.deepEqual(RELEASES.find(item => item.id === 'settlement-observatory-1')?.compatibleFrom, ['settlement-foundry-1']);
  assert.deepEqual(validateContent(), []);
});

