import {
  BUILDINGS,
  CIVICS,
  CIVIC_RULES,
  GOVERNMENTS,
  POLICIES,
  POLICY_SLOT_TYPES,
  IMPROVEMENTS,
  IMPROVEMENT_RULES,
  ERAS,
  DIRECTOR_EVENTS,
  FEATURES,
  FOCUS_IDS,
  HISTORICAL_MILESTONES,
  RESOURCE_IDS,
  PUBLIC_PROJECT_RULES,
  DISTRICT_RULES,
  TECHNOLOGIES,
  TRADE_RULES,
  TURN_RULES,
  WONDERS,
} from './content.ts';
import { parseUtcTimestamp } from './simulation/clock.ts';
import { isLandTransportQuote, landTransportTopologyBlock } from './simulation/transport.ts';
import { coastalTopologyBlock, isCoastalFoundingQuote } from './simulation/coastal.ts';
import { hexDistance } from './simulation/geography.ts';
import { isPersistedActionPlan } from './planning.ts';
import { RELEASES } from './release.ts';
import {
  CIV_COUNT,
  DIRECTOR_SEAT,
  GAME_VERSION,
  SCHEMA_VERSION,
  type City,
  type CivicState,
  type GovernmentState,
  type ConstructionCompletion,
  type ImprovementConstructionCompletion,
  type CoastalFoundingReceipt,
  type Civilization,
  type GameEvent,
  type EventKind,
  type HexTile,
  type Outcome,
  type Route,
  type Resources,
  type StrategicResources,
  type StrategicDepositLayer,
  type StrategicExtractionResult,
  type StrategicShipmentResult,
  type Treaty,
  type TradeAgreement,
  type TradeOffer,
  type TradeTerms,
  type WonderCompletion,
  type WonderLossReceipt,
  type ResearchBoostReceipt,
  type PopulationGrowthReceipt,
  type PastoralSiteLayer,
  type TileAcquisitionReceipt,
  type WorldState,
} from './types.ts';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= maximum
  );
}

function finite(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
  );
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

function unique(values: readonly unknown[]): boolean {
  return new Set(values).size === values.length;
}

function knownStrings(value: unknown, allowed: readonly string[]): value is string[] {
  return strings(value) && unique(value) && value.every((id) => allowed.includes(id));
}

export function isDirectorEvent(value: unknown): value is EventKind {
  return DIRECTOR_EVENTS.some((definition) => definition.id === value);
}

function historyAdvances(value: unknown, revision: number, year: number, features: string[]): boolean {
  if (!record(value)) return false;
  const revisions: number[] = [];
  for (const [key, receipt] of Object.entries(value)) {
    if (!record(receipt) || !record(receipt.cause)) return false;
    const cause = receipt.cause;
    if ((cause.kind !== 'feature' && cause.kind !== 'event') || !text(cause.id)
      || cause.id.trim().length === 0 || cause.id.length > 128 || key !== `${cause.kind}:${cause.id}`
      || (cause.kind === 'feature' && !features.includes(cause.id))
      || !text(receipt.reason) || receipt.reason.trim().length === 0 || receipt.reason.length > 1000
      || !integer(receipt.deltaYears) || !integer(receipt.revision, 1, revision)
      || !integer(receipt.yearBefore, -Number.MAX_SAFE_INTEGER)
      || !integer(receipt.yearAfter, -Number.MAX_SAFE_INTEGER, year)
      || !Number.isSafeInteger(receipt.yearBefore + receipt.deltaYears)
      || receipt.yearAfter !== receipt.yearBefore + receipt.deltaYears
      || typeof receipt.timestamp !== 'string' || parseUtcTimestamp(receipt.timestamp) === null
      || !strings(receipt.evidence) || receipt.evidence.length === 0
      || !receipt.evidence.every((item) => item.trim().length > 0)) return false;
    revisions.push(receipt.revision);
  }
  return unique(revisions);
}

function civilization(value: unknown): value is Civilization {
  if (!record(value) || !record(value.resources)) return false;
  const resources = value.resources;
  const technologies = TECHNOLOGIES.map((item) => item.id);
  return (
    integer(value.id, 0, CIV_COUNT - 1) &&
    ['name', 'color', 'adjective', 'objective'].every((field) => text(value[field])) &&
    integer(value.era, 0, ERAS.length - 1) &&
    RESOURCE_IDS.every((resource) => finite(resources[resource])) &&
    knownStrings(value.technologies, technologies) &&
    typeof value.researchTarget === 'string' &&
    (value.researchTarget === '' || technologies.includes(value.researchTarget)) &&
    ['researchProgress', 'influence', 'marsProgress', 'score'].every((field) =>
      finite(value[field]),
    ) &&
    ['marsPopulation', 'marsSupplyStreak', 'federationStreak'].every((field) =>
      integer(value[field]),
    ) &&
    finite(value.legitimacy, 0, 100)
  );
}

function civicDefinitionAvailable(definition: { requiredFeatures: readonly string[]; requires: string[] }, features: string[], completed: string[]): boolean {
  return definition.requiredFeatures.every(feature => features.includes(feature)) && definition.requires.every(id => completed.includes(id));
}

function retainedCivicCompletion(events: GameEvent[], eventId: string, actor: number, completedRound?: number, civicId?: string): boolean {
  const event = events.find(candidate => candidate.id === eventId);
  return !event || event.type === 'civic-completed' && event.actor === actor && event.target === actor && event.tileId === null
    && (completedRound === undefined || event.round === completedRound)
    && (civicId === undefined || event.effects.includes(`Completed civic ${civicId}`));
}

function civicState(value: unknown, features: string[], round: number, revision: number, actor: number, events: GameEvent[]): value is CivicState {
  if (!record(value) || !exactKeys(value, ['ruleVersion', 'completedCivicIds', 'active', 'lastCompleted', 'reformEntitlement'])
    || value.ruleVersion !== 1 || !knownStrings(value.completedCivicIds, CIVICS.map(definition => definition.id))) return false;
  const completed = value.completedCivicIds;
  if (!completed.every(id => { const definition = CIVICS.find(candidate => candidate.id === id)!; return civicDefinitionAvailable(definition, features, completed); })) return false;
  if (value.active !== null) {
    const active = value.active;
    if (!record(active) || !exactKeys(active, ['civicId', 'startedRound', 'progress', 'requiredCulture'])
      || !text(active.civicId) || completed.includes(active.civicId) || !integer(active.startedRound, 0, round)
      || !finite(active.requiredCulture) || active.requiredCulture <= 0 || !finite(active.progress) || active.progress >= active.requiredCulture) return false;
    const definition = CIVICS.find(candidate => candidate.id === active.civicId);
    if (!definition || !civicDefinitionAvailable(definition, features, completed)) return false;
  }
  const last = value.lastCompleted;
  if (last === null) return completed.length === 0 && value.reformEntitlement === null;
  if (!record(last) || !exactKeys(last, ['civicId', 'completedRound', 'eventId'])
    || last.civicId !== completed.at(-1) || !text(last.civicId) || !integer(last.completedRound, 0, round)
    || completionRevision(last.eventId, revision) === null || !text(last.eventId)
    || !retainedCivicCompletion(events, last.eventId, actor, last.completedRound, last.civicId)) return false;
  if (record(value.active) && integer(value.active.startedRound) && value.active.startedRound < last.completedRound) return false;
  const entitlement = value.reformEntitlement;
  return entitlement === null || record(entitlement) && exactKeys(entitlement, ['civicId', 'completedRound', 'completionEventId'])
    && entitlement.civicId === last.civicId && entitlement.completedRound === last.completedRound && entitlement.completionEventId === last.eventId;
}

function governmentAssignments(value: unknown, governmentId: unknown, features: string[], completed: string[]): boolean {
  const definition = GOVERNMENTS.find(candidate => candidate.id === governmentId);
  if (!definition || !civicDefinitionAvailable(definition, features, completed) || !Array.isArray(value)) return false;
  const occupied = new Set<string>(); const policies = new Set<string>(); let previous = -1;
  for (const assignment of value) {
    if (!record(assignment) || !exactKeys(assignment, ['slotType', 'slotIndex', 'policyId'])) return false;
    const slotType = POLICY_SLOT_TYPES.find(type => type === assignment.slotType);
    if (!slotType || !integer(assignment.slotIndex, 0, definition.slots[slotType] - 1) || !text(assignment.policyId)) return false;
    const key = `${slotType}:${assignment.slotIndex}`;
    const policy = POLICIES.find(candidate => candidate.id === assignment.policyId);
    const position = POLICY_SLOT_TYPES.slice(0, POLICY_SLOT_TYPES.indexOf(slotType)).reduce((sum, type) => sum + definition.slots[type], 0) + assignment.slotIndex;
    if (!policy || !civicDefinitionAvailable(policy, features, completed) || slotType !== 'wildcard' && policy.slotType !== slotType
      || occupied.has(key) || policies.has(policy.id) || position <= previous) return false;
    previous = position; occupied.add(key); policies.add(policy.id);
  }
  return true;
}

function governmentState(value: unknown, civics: CivicState, features: string[], round: number, revision: number, actor: number, events: GameEvent[]): value is GovernmentState {
  if (!record(value) || !exactKeys(value, ['ruleVersion', 'active', 'pending', 'lastSpentReformCompletionEventId']) || value.ruleVersion !== 1) return false;
  const spent = value.lastSpentReformCompletionEventId;
  const last = civics.lastCompleted;
  if (spent !== null && (!text(spent) || completionRevision(spent, revision) === null || !last
    || completionRevision(spent, revision)! > completionRevision(last.eventId, revision)!
    || !retainedCivicCompletion(events, spent, actor))) return false;
  if (last && (civics.reformEntitlement === null) !== (spent === last.eventId)) return false;
  if (!last && spent !== null) return false;
  const active = value.active;
  if (active === null) return value.pending === null && spent === null;
  if (!record(active) || !exactKeys(active, ['governmentId', 'assignments', 'effectiveRound', 'governmentLockUntilRound', 'policyLockUntilRound'])
    || !governmentAssignments(active.assignments, active.governmentId, features, civics.completedCivicIds)
    || !integer(active.effectiveRound, 0, round) || !integer(active.governmentLockUntilRound, CIVIC_RULES.commitmentBeats, active.effectiveRound + CIVIC_RULES.commitmentBeats)
    || !integer(active.policyLockUntilRound) || active.policyLockUntilRound !== active.effectiveRound + CIVIC_RULES.commitmentBeats) return false;
  if (value.pending === null) return true;
  const pending = value.pending;
  if (!record(pending) || !exactKeys(pending, ['targetGovernmentId', 'targetAssignments', 'acceptedRound', 'completionRound', 'paidCredits', 'spentCompletionEventId'])
    || pending.targetGovernmentId === active.governmentId || !governmentAssignments(pending.targetAssignments, pending.targetGovernmentId, features, civics.completedCivicIds)
    || !integer(pending.acceptedRound, Math.max(active.policyLockUntilRound, active.governmentLockUntilRound), round)
    || !integer(pending.completionRound) || pending.completionRound !== pending.acceptedRound + CIVIC_RULES.transitionBeats || pending.completionRound <= round) return false;
  if (pending.spentCompletionEventId === null) return pending.paidCredits === CIVIC_RULES.governmentCredits;
  if (pending.paidCredits !== 0 || pending.spentCompletionEventId !== spent || !last || !text(spent)
    || last.eventId === spent && last.completedRound > pending.acceptedRound) return false;
  const event = events.find(candidate => candidate.id === spent);
  return !event || event.round <= pending.acceptedRound;
}

function civicRecords(civilizations: Civilization[], events: GameEvent[], features: string[], round: number, revision: number): boolean {
  const enabled = features.includes(CIVIC_RULES.featureId);
  if (!enabled && events.some(event => ['civic-started', 'civic-completed', 'arrangement-accepted', 'transition-completed'].includes(event.type))) return false;
  for (const actor of civilizations) {
    if (Object.hasOwn(actor, 'civics') !== enabled || Object.hasOwn(actor, 'government') !== enabled) return false;
    if (!enabled) continue;
    if (!civicState(actor.civics, features, round, revision, actor.id, events)
      || !governmentState(actor.government, actor.civics, features, round, revision, actor.id, events)) return false;
  }
  return true;
}

function city(value: unknown): value is City {
  return (
    record(value) &&
    text(value.id) &&
    text(value.name) &&
    integer(value.civId, 0, CIV_COUNT - 1) &&
    integer(value.tileId) &&
    integer(value.population, 1) &&
    finite(value.wellbeing, 0, 100) &&
    finite(value.infrastructure) &&
    finite(value.damage, 0, 100) &&
    typeof value.focus === 'string' &&
    FOCUS_IDS.some((focus) => focus === value.focus) &&
    knownStrings(
      value.buildings,
      BUILDINGS.map((building) => building.id),
    )
  );
}

function resourceAmounts(value: unknown): value is Partial<Resources> {
  return record(value) && Object.entries(value).every(([resource, amount]) =>
    RESOURCE_IDS.some((known) => known === resource) && finite(amount));
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function strategicResources(value: unknown): value is StrategicResources {
  return record(value) && Object.entries(value).every(([resource, amount]) => resource === 'iron' && integer(amount));
}

function sameStrategicResources(first: StrategicResources, second: StrategicResources): boolean {
  return Object.hasOwn(first, 'iron') === Object.hasOwn(second, 'iron') && first.iron === second.iron;
}

function strategicCargo(value: unknown): value is NonNullable<TradeTerms['strategicCargo']> {
  return record(value) && exactKeys(value, ['proposer', 'recipient'])
    && strategicResources(value.proposer) && strategicResources(value.recipient);
}

const strategicExtractionFields = ['ruleVersion', 'tileId', 'round', 'resource', 'quantity', 'reserveBefore', 'reserveAfter', 'stockBefore', 'stockAfter', 'capacity', 'status'] as const;

function strategicExtraction(value: unknown): value is StrategicExtractionResult {
  if (!record(value) || !exactKeys(value, strategicExtractionFields)
    || value.ruleVersion !== 1 || value.resource !== 'iron'
    || !integer(value.tileId) || !integer(value.round) || !integer(value.quantity)
    || !integer(value.reserveBefore) || !integer(value.reserveAfter) || !integer(value.stockBefore) || !integer(value.stockAfter) || !integer(value.capacity)
    || value.reserveBefore - value.reserveAfter !== value.quantity || value.stockAfter - value.stockBefore !== value.quantity) return false;
  if (value.status === 'extracted') return value.quantity > 0 && value.stockAfter <= value.capacity;
  return value.quantity === 0 && (value.status === 'unrevealed' || value.status === 'exhausted' && value.reserveBefore === 0
    || value.status === 'storage-full' && value.reserveBefore > 0 && value.stockBefore >= value.capacity);
}

function sameExtraction(first: StrategicExtractionResult, second: StrategicExtractionResult): boolean {
  return strategicExtractionFields.every(key => first[key] === second[key]);
}

function strategicShipment(value: unknown): value is StrategicShipmentResult {
  return record(value) && exactKeys(value, ['ruleVersion', 'routeId', 'offerId', 'proposer', 'recipient', 'proposerSent', 'recipientSent'])
    && value.ruleVersion === 1 && boundedText(value.routeId) && boundedText(value.offerId)
    && integer(value.proposer, 0, CIV_COUNT - 1) && integer(value.recipient, 0, CIV_COUNT - 1) && value.proposer !== value.recipient
    && strategicResources(value.proposerSent) && strategicResources(value.recipientSent);
}

function strategicLayer(value: unknown, seed: number, tiles: HexTile[]): value is StrategicDepositLayer {
  if (!record(value) || !exactKeys(value, ['ruleVersion', 'placementId', 'seed', 'tileIds', 'deposits'])
    || value.ruleVersion !== 1 || value.placementId !== 'iron-placement-1' || value.seed !== seed
    || !Array.isArray(value.tileIds) || value.tileIds.length > Math.min(8, tiles.length) || !unique(value.tileIds)
    || !Array.from(value.tileIds).every((id: unknown) => integer(id) && tiles.some(site => site.id === id)) || !record(value.deposits)
    || !exactKeys(value.deposits, value.tileIds.map(String))) return false;
  return Object.entries(value.deposits).every(([key, deposit]) => record(deposit)
    && exactKeys(deposit, ['tileId', 'resource', 'initialReserve', 'remaining']) && integer(deposit.tileId) && key === String(deposit.tileId)
    && deposit.resource === 'iron' && integer(deposit.initialReserve, 1) && integer(deposit.remaining, 0, deposit.initialReserve));
}

function metalRecords(hasLayer: boolean, layer: unknown, civilizations: Civilization[], cities: City[], tiles: HexTile[], events: GameEvent[], routes: Route[], features: string[], seed: number): boolean {
  const enabled = features.includes('finite-metals');
  if (hasLayer !== enabled || civilizations.some(actor => Object.hasOwn(actor, 'strategicResources') !== enabled)) return false;
  if (!enabled) return !events.some(event => Object.hasOwn(event, 'strategicExtraction') || Object.hasOwn(event, 'strategicShipment'));
  if (!strategicLayer(layer, seed, tiles) || !civilizations.every(actor => strategicResources(actor.strategicResources))) return false;
  const retainedExtraction = (value: StrategicExtractionResult): boolean => {
    const deposit = layer.deposits[String(value.tileId)];
    return deposit !== undefined && deposit.resource === value.resource && value.reserveBefore <= deposit.initialReserve;
  };
  for (const settlement of cities) for (const improvement of Object.values(settlement.improvements ?? {})) {
    const result = improvement.operation.lastResult;
    if (!result?.extraction) continue;
    if (result.extraction.tileId !== improvement.tileId || result.extraction.round !== result.round || !retainedExtraction(result.extraction)) return false;
    const event = events.find(candidate => candidate.type === 'improvement-operation' && candidate.actor === settlement.civId && candidate.tileId === improvement.tileId && candidate.round === result.round);
    if (event && (!event.strategicExtraction || !sameExtraction(result.extraction, event.strategicExtraction))) return false;
  }
  for (const event of events) {
    if (event.strategicExtraction) {
      if (!retainedExtraction(event.strategicExtraction)) return false;
      const settlement = cities.find(candidate => candidate.improvements?.[String(event.tileId)]?.operation.lastResult?.round === event.round);
      const result = settlement?.improvements?.[String(event.tileId)]?.operation.lastResult;
      if (settlement && (!result?.extraction || event.actor !== settlement.civId || !sameExtraction(result.extraction, event.strategicExtraction))) return false;
    }
    const shipment = event.strategicShipment;
    if (!shipment) continue;
    const connection = routes.find(candidate => candidate.id === shipment.routeId);
    const agreement = connection?.agreement;
    const cargo = agreement?.terms.strategicCargo;
    if (!connection || !agreement || !cargo || agreement.offerId !== shipment.offerId || connection.owner !== shipment.proposer || connection.partner !== shipment.recipient
      || !sameStrategicResources(cargo.proposer, shipment.proposerSent) || !sameStrategicResources(cargo.recipient, shipment.recipientSent)
      || event.round <= agreement.acceptedRound || (event.round - (agreement.terms.transport ? agreement.acceptedRound : 0)) % agreement.terms.cadenceRounds !== 0) return false;
  }
  return true;
}

function pastoralLayer(value: unknown, seed: number, tiles: HexTile[], iron: StrategicDepositLayer | undefined): value is PastoralSiteLayer {
  if (!record(value) || !exactKeys(value, ['ruleVersion', 'placementId', 'seed', 'tileIds', 'sites'])
    || value.ruleVersion !== 1 || value.placementId !== 'pastoral-sites-1' || value.seed !== seed
    || !Array.isArray(value.tileIds) || value.tileIds.length > Math.min(10, tiles.length) || !unique(value.tileIds)
    || !Array.from(value.tileIds).every((id: unknown) => integer(id) && tiles.some(site => site.id === id) && !iron?.tileIds.includes(id))
    || !record(value.sites) || !exactKeys(value.sites, value.tileIds.map(String))) return false;
  return Object.entries(value.sites).every(([key, site]) => record(site) && exactKeys(site, ['tileId', 'resource'])
    && integer(site.tileId) && key === String(site.tileId) && site.resource === 'horses');
}

function waterLandRecords(hasLayer: boolean, layer: unknown, cities: City[], tiles: HexTile[], events: GameEvent[], features: string[], seed: number, iron: unknown): boolean {
  const enabled = features.includes('water-land');
  const deposits = strategicLayer(iron, seed, tiles) ? iron : undefined;
  const pastoral = enabled && pastoralLayer(layer, seed, tiles, deposits) ? layer : null;
  if (hasLayer !== enabled || enabled && !pastoral) return false;
  const sourceValid = (settlement: City, source: unknown): boolean => {
    if (!enabled || !integer(source) || source === settlement.tileId) return false;
    const center = tiles.find(site => site.id === settlement.tileId);
    const catchment = tiles.find(site => site.id === source);
    return center !== undefined && catchment !== undefined && hexDistance(center, catchment) === 1;
  };
  for (const settlement of cities) {
    const installed = settlement.buildings.includes('aqueduct');
    const mapping: unknown = settlement.buildingCatchments;
    if (Object.hasOwn(settlement, 'buildingCatchments')) {
      if (!enabled || !record(mapping) || !exactKeys(mapping, installed ? ['aqueduct'] : [])
        || installed && !sourceValid(settlement, mapping.aqueduct)) return false;
    } else if (installed) return false;
    if (!enabled && settlement.buildings.includes('water-mill')) return false;
    const active = settlement.construction?.active;
    const completed = settlement.construction?.lastCompleted;
    for (const entry of [active, completed]) {
      if (!entry) continue;
      if ('kind' in entry) {
        if (entry.kind === 'improvement' && entry.improvementId === 'pasture'
          && (!pastoral || !Object.hasOwn(pastoral.sites, String(entry.tileId)))) return false;
        continue;
      }
      if (entry.buildingId === 'water-mill' && !enabled) return false;
      const aqueduct = entry.buildingId === 'aqueduct';
      if (aqueduct !== Object.hasOwn(entry, 'catchmentTileId')) return false;
      if (!aqueduct) continue;
      if (!sourceValid(settlement, entry.catchmentTileId)) return false;
      if (entry === completed) {
        if (!record(mapping) || mapping.aqueduct !== entry.catchmentTileId || !completed) return false;
        const event = events.find(candidate => candidate.id === completed.eventId);
        if (event && (event.type !== 'building-completed' || event.round !== completed.completedRound || event.tileId !== settlement.tileId
          || event.actor !== settlement.civId || event.target !== settlement.civId)) return false;
      }
    }
    for (const improvement of Object.values(settlement.improvements ?? {})) {
      if (improvement.improvementId !== 'pasture') continue;
      if (!pastoral || !Object.hasOwn(pastoral.sites, String(improvement.tileId))
        || improvement.operation.lastResult && Object.hasOwn(improvement.operation.lastResult, 'extraction')) return false;
    }
  }
  return true;
}

function observatoryRecords(cities: City[], tiles: HexTile[], events: GameEvent[], features: string[]): boolean {
  const enabled = features.includes('observatory-learning');
  const sourceValid = (settlement: City, value: unknown): boolean => {
    if (!enabled || !record(value) || !exactKeys(value, ['campusTileId', 'sourceTileId'])
      || !integer(value.campusTileId) || !integer(value.sourceTileId) || value.campusTileId === value.sourceTileId
      || !settlement.buildings.includes('campus') || settlement.districtSites?.campus !== value.campusTileId) return false;
    const campus = tiles.find(site => site.id === value.campusTileId);
    const source = tiles.find(site => site.id === value.sourceTileId);
    return campus !== undefined && source !== undefined && hexDistance(campus, source) === 1;
  };
  for (const settlement of cities) {
    const installed = settlement.buildings.includes('observatory');
    const result = settlement.buildingOperations?.observatory?.lastResult;
    if (result && !Object.hasOwn(result, 'residents')) return false;
    const mapping: unknown = settlement.buildingHighGround;
    if (Object.hasOwn(settlement, 'buildingHighGround')) {
      if (!enabled || !record(mapping) || !exactKeys(mapping, installed ? ['observatory'] : [])
        || installed && !sourceValid(settlement, mapping.observatory)) return false;
    } else if (installed) return false;
    const active = settlement.construction?.active;
    const completed = settlement.construction?.lastCompleted;
    for (const entry of [active, completed]) {
      if (!entry || 'kind' in entry) continue;
      const observatory = entry.buildingId === 'observatory';
      if (observatory !== Object.hasOwn(entry, 'highGround')) return false;
      if (!observatory) continue;
      if (!sourceValid(settlement, entry.highGround)) return false;
      if (entry === completed) {
        if (!record(mapping) || !record(mapping.observatory) || !entry.highGround || !completed
          || mapping.observatory.campusTileId !== entry.highGround.campusTileId
          || mapping.observatory.sourceTileId !== entry.highGround.sourceTileId) return false;
        const event = events.find(candidate => candidate.id === completed.eventId);
        if (event && (event.type !== 'building-completed' || event.round !== completed.completedRound || event.tileId !== settlement.tileId
          || event.actor !== settlement.civId || event.target !== settlement.civId)) return false;
      }
    }
  }
  return true;
}

function residentAllocation(value: unknown): value is { available: number; required: number; allocated: number } {
  return record(value) && exactKeys(value, ['ruleVersion', 'openingPopulation', 'communityReserve', 'required', 'available', 'allocated'])
    && value.ruleVersion === 1 && integer(value.openingPopulation, 1) && integer(value.communityReserve)
    && integer(value.required, 1) && integer(value.available) && integer(value.allocated)
    && value.available <= Math.max(0, value.openingPopulation - value.communityReserve);
}

function operationResult(value: unknown, round: number, features: string[], strategicRecipe: boolean): boolean {
  if (!record(value) || !exactKeys(value, ['round', 'status', 'paid', 'produced', 'shortages', ...(strategicRecipe ? ['strategicPaid', 'strategicShortages'] : []), ...(Object.hasOwn(value, 'residents') ? ['residents'] : [])])
    || !integer(value.round, 0, round) || !resourceAmounts(value.paid) || !resourceAmounts(value.produced)
    || !Array.isArray(value.shortages)) return false;
  const strategic: string[] = [];
  if (strategicRecipe) {
    if (!features.includes('foundry-production') || !features.includes('finite-metals')
      || !strategicResources(value.strategicPaid) || !Array.isArray(value.strategicShortages) || !residentAllocation(value.residents)) return false;
    for (const shortage of value.strategicShortages) {
      if (!record(shortage) || !exactKeys(shortage, ['resource', 'required', 'available'])
        || shortage.resource !== 'iron' || !integer(shortage.required, 1) || !integer(shortage.available)
        || shortage.required <= shortage.available) return false;
      strategic.push(shortage.resource);
    }
    if (!unique(strategic)) return false;
  }
  if (Object.hasOwn(value, 'residents') && (!features.includes('resident-capacity') || !residentAllocation(value.residents))) return false;
  const residents = residentAllocation(value.residents) ? value.residents : null;
  const resources: string[] = [];
  for (const shortage of value.shortages) {
    if (!record(shortage) || !exactKeys(shortage, ['resource', 'required', 'available'])
      || typeof shortage.resource !== 'string' || !RESOURCE_IDS.some((resource) => resource === shortage.resource)
      || !finite(shortage.available) || !finite(shortage.required, Number.MIN_VALUE)
      || shortage.required <= shortage.available) return false;
    resources.push(shortage.resource);
  }
  if (!unique(resources)) return false;
  if (value.status === 'operated') return resources.length === 0 && strategic.length === 0
    && (!strategicRecipe || strategicResources(value.strategicPaid) && Object.values(value.strategicPaid).some(amount => amount > 0))
    && (residents === null || residents.allocated === residents.required && residents.available >= residents.required);
  return Object.keys(value.paid).length === 0 && Object.keys(value.produced).length === 0
    && (!strategicRecipe || strategicResources(value.strategicPaid) && Object.keys(value.strategicPaid).length === 0)
    && (residents === null || residents.allocated === 0)
    && (value.status === 'paused' ? resources.length === 0 && strategic.length === 0 : value.status === 'blocked'
      && (resources.length > 0 || strategic.length > 0 || residents !== null && residents.available < residents.required));
}

function buildingOperations(value: City, round: number, features: string[]): boolean {
  const definitions = BUILDINGS.filter((building) => value.buildings.includes(building.id)
    && (RESOURCE_IDS.some((resource) => (building.operatingInputs?.[resource] ?? 0) > 0) || (building.strategicInputs?.iron ?? 0) > 0));
  const paid = definitions.map((building) => building.id);
  if (!Object.hasOwn(value, 'buildingOperations')) return paid.length === 0;
  const operations: unknown = value.buildingOperations;
  if (!features.includes('building-operations') || !record(operations) || !exactKeys(operations, paid)) return false;
  return Object.entries(operations).every(([id, operation]) => record(operation)
    && exactKeys(operation, ['enabled', 'lastResult']) && typeof operation.enabled === 'boolean'
    && (operation.lastResult === null || operationResult(operation.lastResult, round, features,
      (definitions.find(building => building.id === id)?.strategicInputs?.iron ?? 0) > 0)));
}

function orderRevision(value: unknown, revision: number): number | null {
  if (!boundedText(value) || !/^construction-[1-9]\d*$/.test(value)) return null;
  const result = Number(value.slice('construction-'.length));
  return integer(result, 1, revision) ? result : null;
}

function completionRevision(value: unknown, revision: number): number | null {
  if (!boundedText(value) || !/^[1-9]\d*:(0|[1-9]\d*)$/.test(value)) return null;
  const [head, tail] = value.split(':');
  const result = Number(head);
  return integer(result, 1, revision) && integer(Number(tail)) ? result : null;
}

function coastalReceipt(value: unknown, revision = Number.MAX_SAFE_INTEGER, round = Number.MAX_SAFE_INTEGER, maxTiles = Number.MAX_SAFE_INTEGER): value is CoastalFoundingReceipt {
  if (!record(value) || !exactKeys(value, ['ruleVersion', 'sourceCityId', 'sourceTileId', 'destinationTileId', 'pathTileIds', 'population', 'paid', 'foundedRound', 'eventId'])
    || value.ruleVersion !== 1 || !boundedText(value.sourceCityId) || !integer(value.sourceTileId) || !integer(value.destinationTileId)
    || !integer(value.population, 1) || !resourceAmounts(value.paid) || !integer(value.foundedRound, 0, round)
    || completionRevision(value.eventId, revision) === null || !Array.isArray(value.pathTileIds)) return false;
  const quote = { mode: 'coast', ruleVersion: 1, tileIds: value.pathTileIds, edges: value.pathTileIds.length - 1 };
  return isCoastalFoundingQuote(quote, maxTiles) && quote.tileIds[0] === value.sourceTileId && quote.tileIds.at(-1) === value.destinationTileId;
}

function sameCoastalReceipt(left: CoastalFoundingReceipt, right: CoastalFoundingReceipt): boolean {
  return left.ruleVersion === right.ruleVersion && left.sourceCityId === right.sourceCityId && left.sourceTileId === right.sourceTileId
    && left.destinationTileId === right.destinationTileId && left.population === right.population && left.foundedRound === right.foundedRound && left.eventId === right.eventId
    && left.pathTileIds.length === right.pathTileIds.length && left.pathTileIds.every((id, index) => id === right.pathTileIds[index])
    && Object.keys(left.paid).length === Object.keys(right.paid).length && RESOURCE_IDS.every(resource => Object.hasOwn(left.paid, resource) === Object.hasOwn(right.paid, resource) && left.paid[resource] === right.paid[resource]);
}

function coastalRecords(cities: City[], events: GameEvent[], tiles: HexTile[], features: string[], round: number, revision: number): boolean {
  const receipts: CoastalFoundingReceipt[] = [];
  const valid = (value: unknown): value is CoastalFoundingReceipt => features.includes('coastal-founding') && coastalReceipt(value, revision, round, tiles.length)
    && coastalTopologyBlock({ tiles }, { mode: 'coast', ruleVersion: 1, tileIds: value.pathTileIds, edges: value.pathTileIds.length - 1 }, value.sourceTileId, value.destinationTileId) === null;
  for (const settlement of cities) {
    if (!Object.hasOwn(settlement, 'coastalFounding')) continue;
    const receipt = settlement.coastalFounding;
    if (!valid(receipt) || receipt.destinationTileId !== settlement.tileId) return false;
    const event = events.find(item => item.id === receipt.eventId);
    if (event && (!event.coastalFounding || !sameCoastalReceipt(receipt, event.coastalFounding))) return false;
    receipts.push(receipt);
  }
  return unique(receipts.map(receipt => receipt.eventId)) && events.every(event => !Object.hasOwn(event, 'coastalFounding') || valid(event.coastalFounding));
}

function quantized(value: number): number { return Math.round(value * 100) / 100; }

function wonderCompletion(value: unknown, revision = Number.MAX_SAFE_INTEGER, round = Number.MAX_SAFE_INTEGER): value is WonderCompletion {
  if (!record(value) || !exactKeys(value, ['kind', 'ruleVersion', 'wonderId', 'orderId', 'civId', 'cityId', 'tileId', 'startedRound', 'completedRound', 'paid', 'workRequired', 'eventId'])
    || value.kind !== 'wonder' || value.ruleVersion !== 1 || !WONDERS.some(definition => definition.id === value.wonderId)
    || !boundedText(value.cityId) || !integer(value.civId, 0, CIV_COUNT - 1) || !integer(value.tileId)
    || !integer(value.startedRound, 0, round) || !integer(value.completedRound, value.startedRound + 1, round)
    || !resourceAmounts(value.paid) || !finite(value.workRequired, Number.MIN_VALUE)) return false;
  const started = orderRevision(value.orderId, revision); const completed = completionRevision(value.eventId, revision);
  return started !== null && completed !== null && completed > started;
}

function wonderLoss(value: unknown, revision = Number.MAX_SAFE_INTEGER, round = Number.MAX_SAFE_INTEGER): value is WonderLossReceipt {
  if (!record(value) || !exactKeys(value, ['ruleVersion', 'wonderId', 'orderId', 'civId', 'cityId', 'tileId', 'startedRound', 'paid', 'workRequired', 'workDone', 'refund', 'resolvedRound', 'winnerOrderId', 'eventId'])
    || value.ruleVersion !== 1 || !WONDERS.some(definition => definition.id === value.wonderId)
    || !boundedText(value.cityId) || !integer(value.civId, 0, CIV_COUNT - 1) || !integer(value.tileId)
    || !integer(value.startedRound, 0, round) || !integer(value.resolvedRound, value.startedRound + 1, round)
    || !resourceAmounts(value.paid) || !finite(value.workRequired, Number.MIN_VALUE) || !finite(value.workDone, 0, value.workRequired)
    || !record(value.refund) || !exactKeys(value.refund, ['materials']) || value.refund.materials !== quantized((value.paid.materials ?? 0) * 0.5)) return false;
  const started = orderRevision(value.orderId, revision); const winner = orderRevision(value.winnerOrderId, revision); const ended = completionRevision(value.eventId, revision);
  return started !== null && winner !== null && ended !== null && started < ended && winner < ended && value.orderId !== value.winnerOrderId;
}

function researchBoost(value: unknown, revision = Number.MAX_SAFE_INTEGER, round = Number.MAX_SAFE_INTEGER): value is ResearchBoostReceipt {
  if (!record(value) || !exactKeys(value, ['ruleVersion', 'wonderId', 'wonderCompletionEventId', 'civId', 'technologyId', 'basisReleaseId', 'percent', 'costBasis', 'nominalAmount', 'progressBefore', 'amount', 'progressAfter', 'unusedAmount', 'round', 'eventId', 'researchCompletionEventId'])
    || value.ruleVersion !== 1 || !WONDERS.some(definition => definition.id === value.wonderId) || !integer(value.civId, 0, CIV_COUNT - 1)
    || !TECHNOLOGIES.some(technology => technology.id === value.technologyId)
    || !RELEASES.some(release => release.id === value.basisReleaseId && release.featureIds.includes('unique-wonders'))
    || value.percent !== 20 || !finite(value.costBasis, Number.MIN_VALUE) || !finite(value.progressBefore) || value.progressBefore >= value.costBasis
    || !finite(value.nominalAmount, Number.MIN_VALUE) || value.nominalAmount !== quantized(value.costBasis * 0.2)
    || !finite(value.amount, Number.MIN_VALUE) || value.amount !== quantized(Math.min(value.nominalAmount, value.costBasis - value.progressBefore))
    || !finite(value.progressAfter, 0, value.costBasis) || value.progressAfter !== quantized(value.progressBefore + value.amount)
    || !finite(value.unusedAmount) || value.unusedAmount !== quantized(value.nominalAmount - value.amount) || !integer(value.round, 0, round)) return false;
  const won = completionRevision(value.wonderCompletionEventId, revision); const used = completionRevision(value.eventId, revision);
  if (won === null || used === null || used <= won) return false;
  if (value.progressAfter < value.costBasis) return value.researchCompletionEventId === null;
  return completionRevision(value.researchCompletionEventId, revision) === used && typeof value.researchCompletionEventId === 'string'
    && Number(value.researchCompletionEventId.split(':')[1]) > Number(String(value.eventId).split(':')[1]);
}

function sameWonderFact(first: unknown, second: unknown): boolean {
  if (!record(first) || !record(second)) return false;
  return exactKeys(second, Object.keys(first)) && Object.entries(first).every(([key, value]) => record(value)
    ? record(second[key]) && sameWonderFact(value, second[key]) : value === second[key]);
}

function wonderEvent(value: Record<string, unknown>): boolean {
  for (const [type, field] of [['wonder-completed', 'wonderCompletion'], ['wonder-lost', 'wonderLoss'], ['research-boost', 'researchBoost']])
    if (value.type === type && !Object.hasOwn(value, field ?? '')) return false;
  if (Object.hasOwn(value, 'wonderCompletion')) {
    const fact = value.wonderCompletion;
    if (!wonderCompletion(fact) || value.type !== 'wonder-completed' || fact.eventId !== value.id || fact.completedRound !== value.round
      || fact.tileId !== value.tileId || fact.civId !== value.actor || value.target !== value.actor || value.detail !== fact.orderId) return false;
  }
  if (Object.hasOwn(value, 'wonderLoss')) {
    const fact = value.wonderLoss;
    if (!wonderLoss(fact) || value.type !== 'wonder-lost' || fact.eventId !== value.id || fact.resolvedRound !== value.round
      || fact.tileId !== value.tileId || fact.civId !== value.actor || value.detail !== fact.orderId) return false;
  }
  if (Object.hasOwn(value, 'researchBoost')) {
    const fact = value.researchBoost;
    if (!researchBoost(fact) || value.type !== 'research-boost' || fact.eventId !== value.id || fact.round !== value.round
      || fact.civId !== value.actor || value.target !== value.actor || value.detail !== fact.technologyId) return false;
  }
  return true;
}

function wonderRecords(hasRegistry: boolean, registry: unknown, cities: City[], civilizations: Civilization[], tiles: HexTile[], events: GameEvent[], features: string[], revision: number, round: number): boolean {
  if (hasRegistry !== features.includes('unique-wonders')) return false;
  if (!hasRegistry) return !events.some(event => event.wonderCompletion || event.wonderLoss || event.researchBoost);
  if (!record(registry) || Object.keys(registry).some(id => !WONDERS.some(definition => definition.id === id))) return false;
  const occupied = new Set(cities.map(settlement => settlement.tileId)); const orders = new Set<string>(); const identities = new Set<string>();
  const activeContenders: string[] = [];
  for (const settlement of cities) {
    for (const site of Object.values(settlement.districtSites ?? {})) occupied.add(site);
    for (const installed of Object.values(settlement.improvements ?? {})) { occupied.add(installed.tileId); orders.add(installed.completion.orderId); identities.add(installed.completion.eventId); }
    const active = settlement.construction?.active; const last = settlement.construction?.lastCompleted;
    if (active) {
      orders.add(active.id); if (active.tileId !== undefined) occupied.add(active.tileId);
      if ('kind' in active && active.kind === 'wonder') {
        if (Object.hasOwn(registry, active.wonderId)) return false;
        activeContenders.push(`${settlement.civId}:${active.wonderId}`);
      }
    }
    if (last && !('kind' in last && last.kind === 'wonder')) { orders.add(last.orderId); identities.add(last.eventId); }
  }
  if (!unique(activeContenders)) return false;
  const completed = new Map<string, WonderCompletion>();
  const facts = new Map<string, WonderCompletion | WonderLossReceipt | ResearchBoostReceipt>();
  const retain = (fact: WonderCompletion | WonderLossReceipt | ResearchBoostReceipt): boolean => {
    if (identities.has(fact.eventId)) return false; identities.add(fact.eventId); facts.set(fact.eventId, fact);
    if ('orderId' in fact) { if (orders.has(fact.orderId)) return false; orders.add(fact.orderId); }
    return true;
  };
  for (const [id, value] of Object.entries(registry)) {
    if (!record(value) || !exactKeys(value, ['ruleVersion', 'completion', 'losses', 'boostLimit', 'boostPercent', 'boosts'])
      || value.ruleVersion !== 1 || value.boostLimit !== 2 || value.boostPercent !== 20 || !wonderCompletion(value.completion, revision, round)
      || value.completion.wonderId !== id || !Array.isArray(value.losses) || value.losses.length >= CIV_COUNT || !Array.isArray(value.boosts) || value.boosts.length > 2) return false;
    const won = value.completion; const settlement = cities.find(town => town.id === won.cityId && town.civId === won.civId);
    if (!settlement || !tiles.some(site => site.id === won.tileId) || occupied.has(won.tileId) || !retain(won)) return false;
    occupied.add(won.tileId); completed.set(id, won);
    const last = settlement.construction?.lastCompleted;
    if (last?.orderId === won.orderId && !sameWonderFact(last, won)) return false;
    const contenders = new Set([won.civId]); const sites = new Set([won.tileId]);
    for (const loss of value.losses as unknown[]) {
      if (!wonderLoss(loss, revision, round) || loss.wonderId !== id || loss.winnerOrderId !== won.orderId || loss.resolvedRound !== won.completedRound
        || completionRevision(loss.eventId, revision) !== completionRevision(won.eventId, revision) || contenders.has(loss.civId) || sites.has(loss.tileId)
        || !cities.some(town => town.id === loss.cityId && town.civId === loss.civId) || !tiles.some(site => site.id === loss.tileId) || !retain(loss)) return false;
      contenders.add(loss.civId); sites.add(loss.tileId);
    }
    let previous = completionRevision(won.eventId, revision) ?? 0; const technologies = new Set<string>();
    for (const boost of value.boosts as unknown[]) {
      if (!researchBoost(boost, revision, round) || boost.wonderId !== id || boost.wonderCompletionEventId !== won.eventId || boost.civId !== won.civId
        || boost.round < won.completedRound || (completionRevision(boost.eventId, revision) ?? 0) <= previous || technologies.has(boost.technologyId) || !retain(boost)) return false;
      previous = completionRevision(boost.eventId, revision) ?? 0; technologies.add(boost.technologyId);
      if (boost.researchCompletionEventId !== null) {
        if (identities.has(boost.researchCompletionEventId) || !civilizations.find(civ => civ.id === boost.civId)?.technologies.includes(boost.technologyId)) return false;
        identities.add(boost.researchCompletionEventId);
        const latest = civilizations.find(civ => civ.id === boost.civId)?.lastResearchCompletion;
        if (latest?.eventId === boost.researchCompletionEventId && (latest.technologyId !== boost.technologyId || latest.completedRound !== boost.round)) return false;
        const event = events.find(candidate => candidate.id === boost.researchCompletionEventId);
        if (event && (event.type !== 'research-completed' || event.actor !== boost.civId || event.target !== boost.civId || event.round !== boost.round
          || !event.effects.includes(`Technology ${boost.technologyId} unlocked`))) return false;
      }
    }
  }
  for (const settlement of cities) {
    const last = settlement.construction?.lastCompleted;
    if (last && 'kind' in last && last.kind === 'wonder') {
      const value = completed.get(last.wonderId);
      if (!value || !sameWonderFact(value, last)) return false;
    }
  }
  for (const fact of facts.values()) {
    const event = events.find(candidate => candidate.id === fact.eventId);
    if (event) {
      const copy = event.wonderCompletion ?? event.wonderLoss ?? event.researchBoost;
      if (!copy || !sameWonderFact(copy, fact)) return false;
    }
  }
  return events.every(event => {
    const fact = event.wonderCompletion ?? event.wonderLoss ?? event.researchBoost;
    if (!fact) return true;
    const saved = facts.get(event.id); if (!saved || !sameWonderFact(saved, fact)) return false;
    const won = completed.get(fact.wonderId); if (!won) return false;
    return event.wonderLoss ? event.target === won.civId : event.researchBoost ? event.tileId === won.tileId : true;
  });
}

function constructionIdentity(value: Record<string, unknown>, settlement: City, features: string[], completed: boolean): boolean {
  if (value.cityId !== settlement.id) return false;
  if (value.kind === 'wonder') return features.includes('unique-wonders') && integer(value.tileId)
    && WONDERS.some(definition => definition.id === value.wonderId);
  if (value.kind === 'improvement') return features.includes(IMPROVEMENT_RULES.featureId) && integer(value.tileId)
    && IMPROVEMENTS.some(definition => definition.id === value.improvementId)
    && (value.improvementId !== 'pasture' || features.includes('water-land'))
    && (value.improvementId !== 'lumber-mill' || features.includes('forest-production'));
  return !Object.hasOwn(value, 'kind') && typeof value.buildingId === 'string'
    && BUILDINGS.some(building => building.id === value.buildingId)
    && settlement.buildings.includes(value.buildingId) === completed
    && (!Object.hasOwn(value, 'tileId') || integer(value.tileId));
}

function constructionKeys(value: Record<string, unknown>): string[] {
  return value.kind === 'wonder' ? ['kind', 'wonderId', 'tileId'] : value.kind === 'improvement' ? ['kind', 'improvementId', 'tileId'] : ['buildingId', ...(Object.hasOwn(value, 'tileId') ? ['tileId'] : []), ...(Object.hasOwn(value, 'catchmentTileId') ? ['catchmentTileId'] : []), ...(Object.hasOwn(value, 'highGround') ? ['highGround'] : [])];
}

function constructionCompletion(value: unknown, settlement: City, features: string[], round: number, revision: number): value is ConstructionCompletion {
  if (record(value) && value.kind === 'wonder') return features.includes('unique-wonders') && wonderCompletion(value, revision, round)
    && value.cityId === settlement.id && value.civId === settlement.civId;
  if (!record(value) || !exactKeys(value, ['orderId', 'cityId', 'startedRound', 'completedRound', 'paid', 'workRequired', 'eventId', ...constructionKeys(value)])
    || !constructionIdentity(value, settlement, features, true)) return false;
  const started = orderRevision(value.orderId, revision);
  const ended = completionRevision(value.eventId, revision);
  return started !== null && ended !== null && ended > started
    && integer(value.startedRound, 0, round) && integer(value.completedRound, value.startedRound + 1, round)
    && resourceAmounts(value.paid) && finite(value.workRequired, Number.MIN_VALUE);
}

function construction(value: unknown, settlement: City, features: string[], round: number, revision: number, ids: string[]): boolean {
  if (!record(value) || !exactKeys(value, ['active', 'lastCompleted'])) return false;
  const active = value.active;
  if (active !== null) {
    if (!record(active) || !exactKeys(active, ['id', 'cityId', 'ruleVersion', 'startedRound', 'paid', 'workRequired', 'workDone', ...constructionKeys(active)])
      || !constructionIdentity(active, settlement, features, false)
      || orderRevision(active.id, revision) === null || typeof active.id !== 'string'
      || active.ruleVersion !== 1 || !integer(active.startedRound, 0, round)
      || !resourceAmounts(active.paid) || !finite(active.workRequired, Number.MIN_VALUE)
      || !finite(active.workDone) || active.workDone >= active.workRequired) return false;
    ids.push(active.id);
  }
  const completed = value.lastCompleted;
  if (completed !== null) {
    if (!constructionCompletion(completed, settlement, features, round, revision)) return false;
    if (record(active) && (!integer(active.startedRound, completed.completedRound, round)
      || (orderRevision(active.id, revision) ?? 0) <= (completionRevision(completed.eventId, revision) ?? 0))) return false;
    ids.push(completed.orderId);
  }
  return true;
}

function sameImprovementCompletion(left: ImprovementConstructionCompletion, right: ImprovementConstructionCompletion): boolean {
  return left.orderId === right.orderId && left.cityId === right.cityId && left.improvementId === right.improvementId
    && left.tileId === right.tileId && left.startedRound === right.startedRound && left.completedRound === right.completedRound
    && left.workRequired === right.workRequired && left.eventId === right.eventId
    && Object.keys(left.paid).length === Object.keys(right.paid).length
    && RESOURCE_IDS.every(resource => Object.hasOwn(left.paid, resource) === Object.hasOwn(right.paid, resource) && left.paid[resource] === right.paid[resource]);
}

function improvementResult(value: unknown, completedRound: number, round: number, features: string[]): boolean {
  if (!record(value) || !exactKeys(value, ['round', 'status', 'paid', 'produced', 'residents', 'blockedReason', ...(Object.hasOwn(value, 'extraction') ? ['extraction'] : [])])
    || !integer(value.round, completedRound + 1, round) || !resourceAmounts(value.paid) || Object.keys(value.paid).length !== 0
    || !resourceAmounts(value.produced) || !residentAllocation(value.residents)) return false;
  if (Object.hasOwn(value, 'extraction') && (!features.includes('finite-metals') || value.status !== 'operated' || !strategicExtraction(value.extraction))) return false;
  const residents = value.residents;
  if (value.status === 'operated') return value.blockedReason === null && residents.allocated === residents.required && residents.available >= residents.required;
  if (residents.allocated !== 0 || Object.keys(value.produced).length !== 0) return false;
  return value.status === 'paused' ? value.blockedReason === null : value.status === 'blocked'
    && (value.blockedReason === 'site-ineligible' || value.blockedReason === 'resident-shortage' && residents.available < residents.required);
}

function improvementRecords(cities: City[], tiles: HexTile[], events: GameEvent[], features: string[], round: number, revision: number): boolean {
  const occupied = new Set(cities.map(settlement => settlement.tileId));
  for (const settlement of cities) {
    for (const tileId of Object.values(settlement.districtSites ?? {})) occupied.add(tileId);
    const active = settlement.construction?.active;
    if (active && !('kind' in active) && active.tileId !== undefined) occupied.add(active.tileId);
  }
  const reserve = (tileId: number): boolean => {
    if (!tiles.some(site => site.id === tileId) || occupied.has(tileId)) return false;
    occupied.add(tileId); return true;
  };
  const orderIds: string[] = [];
  const eventIds: string[] = [];
  for (const settlement of cities) {
    const active = settlement.construction?.active;
    const last = settlement.construction?.lastCompleted;
    if (active) { orderIds.push(active.id); if ('kind' in active && !reserve(active.tileId)) return false; }
    if (last) { orderIds.push(last.orderId); eventIds.push(last.eventId); }
    const mapping: unknown = settlement.improvements;
    if (Object.hasOwn(settlement, 'improvements')) {
      if (!features.includes(IMPROVEMENT_RULES.featureId) || !record(mapping)) return false;
      for (const [key, value] of Object.entries(mapping)) {
        if (!/^(0|[1-9]\d*)$/.test(key) || !record(value) || !exactKeys(value, ['improvementId', 'tileId', 'completion', 'operation'])
          || !integer(value.tileId) || key !== String(value.tileId) || !reserve(value.tileId)
          || !IMPROVEMENTS.some(definition => definition.id === value.improvementId)
          || !constructionCompletion(value.completion, settlement, features, round, revision)
          || !('kind' in value.completion) || value.completion.kind !== 'improvement' || value.completion.improvementId !== value.improvementId || value.completion.tileId !== value.tileId
          || !record(value.operation) || !exactKeys(value.operation, ['enabled', 'lastResult']) || typeof value.operation.enabled !== 'boolean'
          || value.operation.lastResult !== null && !improvementResult(value.operation.lastResult, value.completion.completedRound, round, features)
          || value.improvementId !== 'mine' && record(value.operation.lastResult) && Object.hasOwn(value.operation.lastResult, 'extraction')) return false;
        const completion = value.completion;
        const event = events.find(item => item.id === completion.eventId);
        if (event && (event.type !== 'improvement-completed' || event.round !== completion.completedRound || event.tileId !== completion.tileId
          || event.actor !== settlement.civId || event.target !== settlement.civId || event.detail !== `${settlement.id}/${completion.tileId}/${completion.improvementId}`)) return false;
        if (last && 'kind' in last && last.kind === 'improvement' && last.orderId === completion.orderId) {
          if (!sameImprovementCompletion(last, completion)) return false;
        } else { orderIds.push(completion.orderId); eventIds.push(completion.eventId); }
      }
    }
    if (last && 'kind' in last && last.kind === 'improvement') {
      const installed = record(mapping) ? mapping[String(last.tileId)] : null;
      if (!record(installed) || !constructionCompletion(installed.completion, settlement, features, round, revision)
        || !('kind' in installed.completion) || installed.completion.kind !== 'improvement' || !sameImprovementCompletion(last, installed.completion)) return false;
    }
  }
  return unique(orderIds) && unique(eventIds);
}

function recurringRecords(cities: City[], civilizations: Civilization[], features: string[], round: number, revision: number): boolean {
  const enabled = features.includes('recurring-decisions');
  const orderIds: string[] = [];
  for (const settlement of cities) {
    if (Object.hasOwn(settlement, 'construction') && (!enabled || !construction(settlement.construction, settlement, features, round, revision, orderIds))) return false;
  }
  for (const actor of civilizations) {
    if (!Object.hasOwn(actor, 'lastResearchCompletion')) continue;
    const completed: unknown = actor.lastResearchCompletion;
    if (!enabled || !record(completed) || !exactKeys(completed, ['technologyId', 'completedRound', 'eventId'])
      || typeof completed.technologyId !== 'string' || !actor.technologies.includes(completed.technologyId)
      || !integer(completed.completedRound, 0, round) || completionRevision(completed.eventId, revision) === null) return false;
  }
  return unique(orderIds);
}

function districtRecords(cities: City[], tiles: HexTile[], events: GameEvent[], features: string[]): boolean {
  const enabled = features.includes(DISTRICT_RULES.featureId);
  const occupied = new Set<number>();
  const sites = new Map(tiles.map(site => [site.id, site]));
  const centers = new Set(cities.map(settlement => settlement.tileId));
  const reserve = (settlement: City, buildingId: string, tileId: unknown): boolean => {
    const district = BUILDINGS.find(building => building.id === buildingId)?.district;
    if (!enabled || !district || !integer(tileId) || occupied.has(tileId) || centers.has(tileId)) return false;
    const site = sites.get(tileId);
    const center = sites.get(settlement.tileId);
    if (!site || !center || site.owner !== settlement.civId || site.terrain === 'ocean' || site.terrain === 'mountain'
      || hexDistance(center, site) > district.range) return false;
    occupied.add(tileId);
    return true;
  };
  for (const settlement of cities) {
    const installed = BUILDINGS.filter(building => building.district && settlement.buildings.includes(building.id));
    const mapping: unknown = settlement.districtSites;
    if (Object.hasOwn(settlement, 'districtSites')) {
      if (!enabled || !record(mapping) || !exactKeys(mapping, installed.map(building => building.id))) return false;
      for (const building of installed) if (!reserve(settlement, building.id, mapping[building.id])) return false;
    } else if (installed.length > 0) return false;
    const active = settlement.construction?.active;
    const completed = settlement.construction?.lastCompleted;
    const commitments = [...settlement.buildings, ...(active && !('kind' in active) ? [active.buildingId] : [])];
    if (commitments.some(id => BUILDINGS.find(building => building.id === id)?.requiresBuildings?.some(required => !settlement.buildings.includes(required)))) return false;
    for (const entry of [active, completed]) {
      if (!entry || 'kind' in entry) continue;
      const district = BUILDINGS.find(building => building.id === entry.buildingId)?.district;
      if (Boolean(district) !== Object.hasOwn(entry, 'tileId')) return false;
      if (!district) continue;
      if (entry === active) {
        if (!reserve(settlement, entry.buildingId, entry.tileId)) return false;
      } else {
        if (!record(mapping) || mapping[entry.buildingId] !== entry.tileId || !completed || 'kind' in completed) return false;
        const event = events.find(value => value.id === completed.eventId);
        if (event && (event.type !== 'building-completed' || event.round !== completed.completedRound || event.tileId !== completed.tileId
          || event.actor !== settlement.civId || event.target !== settlement.civId)) return false;
      }
    }
  }
  return true;
}

function tile(value: unknown): value is HexTile {
  return (
    record(value) &&
    integer(value.id) &&
    integer(value.q) &&
    integer(value.r) &&
    typeof value.terrain === 'string' &&
    ['ocean', 'grassland', 'forest', 'desert', 'mountain', 'tundra'].includes(value.terrain) &&
    finite(value.elevation) &&
    (value.owner === null || integer(value.owner, 0, CIV_COUNT - 1)) &&
    (value.resource === null || RESOURCE_IDS.some((resource) => resource === value.resource))
  );
}

function route(value: unknown): value is Route {
  return (
    record(value) &&
    text(value.id) &&
    text(value.from) &&
    text(value.to) &&
    integer(value.owner, 0, CIV_COUNT - 1) &&
    integer(value.partner, 0, CIV_COUNT - 1) &&
    value.owner !== value.partner &&
    typeof value.active === 'boolean' &&
    finite(value.damage, 0, 100) &&
    finite(value.volume) &&
    (!('agreement' in value) || tradeAgreement(value.agreement))
  );
}

const tradeResourceFields = ['constructionCost', 'proposerCargo', 'recipientCargo', 'proposerUpkeep', 'recipientUpkeep', 'proposerYield', 'recipientYield'] as const;

function tradeTerms(value: unknown): value is TradeTerms {
  return record(value) && text(value.recipeId) && integer(value.recipeVersion, 1)
    && integer(value.cadenceRounds, 1) && finite(value.damageDisableAt, Number.MIN_VALUE, 100)
    && tradeResourceFields.every((field) => resourceAmounts(value[field]))
    && (!Object.hasOwn(value, 'strategicCargo') || strategicCargo(value.strategicCargo));
}

function tradeAgreement(value: unknown): value is TradeAgreement {
  return record(value) && text(value.offerId) && tradeTerms(value.terms)
    && typeof value.enabled === 'boolean' && integer(value.acceptedRound)
    && integer(value.nextDeliveryRound) && integer(value.deliveryCount)
    && (value.lastAttemptRound === null || integer(value.lastAttemptRound))
    && (value.lastDeliveryRound === null || integer(value.lastDeliveryRound))
    && (value.closedRound === null || integer(value.closedRound))
    && (value.blockedBy === null || integer(value.blockedBy, 0, CIV_COUNT - 1))
    && (value.blockedReason === null || text(value.blockedReason));
}

function tradeOffer(value: unknown): value is TradeOffer {
  return record(value) && text(value.id) && integer(value.proposer, 0, CIV_COUNT - 1)
    && integer(value.recipient, 0, CIV_COUNT - 1) && value.proposer !== value.recipient
    && text(value.from) && text(value.to) && tradeTerms(value.terms)
    && integer(value.createdRound) && integer(value.expiresRound)
    && value.expiresRound > value.createdRound
    && typeof value.status === 'string' && ['pending', 'accepted', 'declined', 'withdrawn', 'expired'].includes(value.status)
    && (value.routeId === null || text(value.routeId));
}

function sameTradeTerms(first: TradeTerms, second: TradeTerms): boolean {
  return first.recipeId === second.recipeId && first.recipeVersion === second.recipeVersion
    && first.cadenceRounds === second.cadenceRounds && first.damageDisableAt === second.damageDisableAt
    && (first.transport === undefined ? second.transport === undefined : second.transport !== undefined
      && first.transport.mode === second.transport.mode && first.transport.ruleVersion === second.transport.ruleVersion
      && first.transport.edges === second.transport.edges && first.transport.tileIds.length === second.transport.tileIds.length
      && first.transport.tileIds.every((id, index) => id === second.transport?.tileIds[index]))
    && (first.strategicCargo === undefined ? second.strategicCargo === undefined : second.strategicCargo !== undefined
      && sameStrategicResources(first.strategicCargo.proposer, second.strategicCargo.proposer) && sameStrategicResources(first.strategicCargo.recipient, second.strategicCargo.recipient))
    && tradeResourceFields.every((field) => RESOURCE_IDS.every((resource) => first[field][resource] === second[field][resource]));
}

function tradeTransport(terms: TradeTerms, from: string, to: string, cities: City[], tiles: HexTile[], features: string[]): boolean {
  if (Object.hasOwn(terms, 'strategicCargo') && !features.includes('finite-metals')) return false;
  if (!Object.hasOwn(terms, 'transport')) return true;
  if (!features.includes('land-transport') || !isLandTransportQuote(terms.transport, tiles.length)) return false;
  const origin = cities.find(settlement => settlement.id === from);
  const destination = cities.find(settlement => settlement.id === to);
  return origin !== undefined && destination !== undefined
    && landTransportTopologyBlock({ tiles }, terms.transport, origin.tileId, destination.tileId) === null;
}

function tradePair(first: number, second: number): string {
  return `${Math.min(first, second)}:${Math.max(first, second)}`;
}

function tradeState(value: unknown, routes: Route[], cities: City[], tiles: HexTile[], round: number, features: string[]): boolean {
  if (!Array.isArray(value) || !value.every(tradeOffer) || !unique(value.map((offer) => offer.id))) return false;
  const pendingPairs = new Map<string, number>();
  const enabledPairs = new Map<string, number>();
  for (const offer of value) {
    if (offer.createdRound > round || !cities.some((settlement) => settlement.id === offer.from && settlement.civId === offer.proposer)
      || !cities.some((settlement) => settlement.id === offer.to && settlement.civId === offer.recipient)
      || !tradeTransport(offer.terms, offer.from, offer.to, cities, tiles, features)) return false;
    if (offer.status === 'accepted') {
      const accepted = routes.find((connection) => connection.id === offer.routeId);
      if (!accepted?.agreement || accepted.agreement.offerId !== offer.id) return false;
    } else if (offer.routeId !== null) return false;
    if (offer.status === 'pending' && round < offer.expiresRound) {
      const key = tradePair(offer.proposer, offer.recipient);
      const count = (pendingPairs.get(key) ?? 0) + 1;
      if (count > TRADE_RULES.maxPendingPerPair) return false;
      pendingPairs.set(key, count);
    }
  }
  for (const connection of routes) {
    const agreement = connection.agreement;
    if (!agreement) continue;
    if (!tradeTransport(agreement.terms, connection.from, connection.to, cities, tiles, features)) return false;
    const cadenceOrigin = agreement.terms.transport === undefined ? 0 : agreement.acceptedRound;
    const offer = value.find((candidate) => candidate.id === agreement.offerId);
    if (!offer || offer.status !== 'accepted' || offer.routeId !== connection.id
      || offer.proposer !== connection.owner || offer.recipient !== connection.partner
      || offer.from !== connection.from || offer.to !== connection.to || !sameTradeTerms(offer.terms, agreement.terms)
      || agreement.acceptedRound < offer.createdRound || agreement.acceptedRound >= offer.expiresRound
      || agreement.acceptedRound > round || agreement.nextDeliveryRound <= agreement.acceptedRound
      || (agreement.nextDeliveryRound - cadenceOrigin) % agreement.terms.cadenceRounds !== 0
      || (agreement.enabled && agreement.nextDeliveryRound <= round)
      || (agreement.lastAttemptRound !== null && (agreement.lastAttemptRound <= agreement.acceptedRound || agreement.lastAttemptRound > round || (agreement.lastAttemptRound - cadenceOrigin) % agreement.terms.cadenceRounds !== 0))
      || (agreement.lastDeliveryRound !== null && (agreement.lastAttemptRound === null || agreement.lastDeliveryRound > agreement.lastAttemptRound || agreement.lastDeliveryRound <= agreement.acceptedRound || (agreement.lastDeliveryRound - cadenceOrigin) % agreement.terms.cadenceRounds !== 0))
      || ((agreement.deliveryCount === 0) !== (agreement.lastDeliveryRound === null))
      || (agreement.blockedBy !== null && (agreement.blockedBy !== connection.owner && agreement.blockedBy !== connection.partner || agreement.blockedReason === null))
      || (agreement.enabled ? agreement.closedRound !== null : agreement.closedRound === null || agreement.closedRound < agreement.acceptedRound || agreement.closedRound > round || agreement.blockedBy !== null || agreement.blockedReason !== null || connection.active || connection.volume !== 0)) return false;
    if (agreement.enabled) {
      const key = tradePair(connection.owner, connection.partner);
      const count = (enabledPairs.get(key) ?? 0) + 1;
      if (count > TRADE_RULES.maxActivePerPair) return false;
      enabledPairs.set(key, count);
    }
  }
  return true;
}

function boundedText(value: unknown, maximum = 128): value is string {
  return text(value) && value.trim().length > 0 && value.length <= maximum;
}

function projectVector(value: unknown): value is Partial<Resources> {
  return resourceAmounts(value) && Object.keys(value).length > 0
    && Object.values(value).every((amount) => finite(amount, Number.MIN_VALUE));
}

function publicProjectTerms(value: unknown): boolean {
  return record(value) && exactKeys(value, ['recipeId', 'recipeVersion', 'proposerContribution', 'recipientContribution', 'damageReduction', 'pendingLifetimeRounds', 'completionDelayRounds'])
    && boundedText(value.recipeId) && integer(value.recipeVersion, 1)
    && projectVector(value.proposerContribution) && projectVector(value.recipientContribution)
    && finite(value.damageReduction, Number.MIN_VALUE, 100)
    && integer(value.pendingLifetimeRounds, 1) && integer(value.completionDelayRounds, 1);
}

function publicProjects(value: unknown, round: number, routes: Route[]): boolean {
  if (!Array.isArray(value) || value.length > PUBLIC_PROJECT_RULES.maxActiveTotal) return false;
  const ids: string[] = [];
  const pairs: string[] = [];
  for (const project of value) {
    if (!record(project) || !boundedText(project.id) || !boundedText(project.routeId) || !boundedText(project.agreementOfferId)
      || !integer(project.proposer, 0, CIV_COUNT - 1) || !integer(project.recipient, 0, CIV_COUNT - 1) || project.proposer === project.recipient
      || !integer(project.proposedRound, 0, round) || !publicProjectTerms(project.terms) || !record(project.terms)) return false;
    const base = ['id', 'routeId', 'agreementOfferId', 'proposer', 'recipient', 'terms', 'proposedRound', 'status'];
    if (project.status === 'pending') {
      if (!exactKeys(project, [...base, 'expiresRound']) || !integer(project.expiresRound, round + 1)
        || project.expiresRound !== project.proposedRound + Number(project.terms.pendingLifetimeRounds)) return false;
    } else if (project.status === 'committed') {
      if (!exactKeys(project, [...base, 'acceptedRound', 'dueRound']) || !integer(project.acceptedRound, project.proposedRound, round)
        || project.acceptedRound >= project.proposedRound + Number(project.terms.pendingLifetimeRounds)
        || !integer(project.dueRound, round + 1) || project.dueRound !== project.acceptedRound + Number(project.terms.completionDelayRounds)) return false;
    } else return false;
    const connection = routes.find((candidate) => candidate.id === project.routeId);
    if (connection && tradePair(connection.owner, connection.partner) !== tradePair(project.proposer, project.recipient)) return false;
    ids.push(project.id);
    pairs.push(tradePair(project.proposer, project.recipient));
  }
  return unique(ids) && pairs.every((key) => pairs.filter((other) => other === key).length <= PUBLIC_PROJECT_RULES.maxActivePerPair);
}

function publicProjectResult(value: unknown): boolean {
  if (!record(value) || !exactKeys(value, ['projectId', 'routeId', 'agreementOfferId', 'outcome', 'reason', 'proposer', 'recipient', 'proposerPaid', 'recipientPaid', 'damageBefore', 'damageAfter'])
    || !boundedText(value.projectId) || !boundedText(value.routeId) || !boundedText(value.agreementOfferId) || !boundedText(value.reason, 1000)
    || !integer(value.proposer, 0, CIV_COUNT - 1) || !integer(value.recipient, 0, CIV_COUNT - 1) || value.proposer === value.recipient
    || !resourceAmounts(value.proposerPaid) || !resourceAmounts(value.recipientPaid)) return false;
  const damage = (value.damageBefore === null && value.damageAfter === null)
    || (finite(value.damageBefore, 0, 100) && finite(value.damageAfter, 0, 100) && value.damageAfter <= value.damageBefore);
  if (!damage) return false;
  if (value.outcome === 'completed') return projectVector(value.proposerPaid) && projectVector(value.recipientPaid)
    && finite(value.damageBefore, Number.MIN_VALUE, 100) && finite(value.damageAfter, 0, 100) && value.damageAfter < value.damageBefore;
  return typeof value.outcome === 'string' && ['declined', 'cancelled', 'expired', 'failed', 'no-work-needed'].includes(value.outcome)
    && Object.keys(value.proposerPaid).length === 0 && Object.keys(value.recipientPaid).length === 0 && value.damageBefore === value.damageAfter
    && (value.outcome !== 'no-work-needed' || value.damageBefore === 0);
}

function treaty(value: unknown): value is Treaty {
  return (
    record(value) &&
    text(value.id) &&
    integer(value.a, 0, CIV_COUNT - 1) &&
    integer(value.b, 0, CIV_COUNT - 1) &&
    value.a !== value.b &&
    (value.kind === 'trade' || value.kind === 'federation' || value.kind === 'peace') &&
    integer(value.since)
  );
}

function populationGrowth(value: unknown): value is PopulationGrowthReceipt {
  return record(value) && exactKeys(value, ['ruleVersion', 'cityId', 'civId', 'round', 'eventId', 'populationBefore', 'populationAfter', 'capacity', 'foodPaid'])
    && value.ruleVersion === 1 && text(value.cityId) && integer(value.civId, 0, CIV_COUNT - 1) && integer(value.round)
    && completionRevision(value.eventId, Number.MAX_SAFE_INTEGER) !== null
    && integer(value.populationBefore, 1) && integer(value.populationAfter, 1) && value.populationAfter === value.populationBefore + 1
    && integer(value.capacity, value.populationAfter) && value.foodPaid === 6 + Math.floor(value.populationBefore / 4);
}

function growthRecords(cities: City[], events: GameEvent[], features: string[], round: number, revision: number): boolean {
  const enabled = features.includes('local-growth');
  for (const settlement of cities) {
    if (Object.hasOwn(settlement, 'housing') !== enabled) return false;
    if (!enabled) continue;
    const housing: unknown = settlement.housing;
    if (!record(housing) || !exactKeys(housing, ['ruleVersion', 'baseCapacity', 'establishedRound', 'origin'])
      || housing.ruleVersion !== 1 || !integer(housing.establishedRound, 0, round)
      || !(housing.origin === 'founded' && housing.baseCapacity === 8 || housing.origin === 'legacy-adoption' && integer(housing.baseCapacity, 20))) return false;
  }
  for (const event of events) {
    if (!Object.hasOwn(event, 'populationGrowth')) continue;
    const receipt = event.populationGrowth;
    if (!enabled || !populationGrowth(receipt) || completionRevision(receipt.eventId, revision) === null) return false;
    const settlement = cities.find(candidate => candidate.id === receipt.cityId);
    if (!settlement || settlement.civId !== receipt.civId || settlement.tileId !== event.tileId
      || !settlement.housing || receipt.round < settlement.housing.establishedRound) return false;
  }
  return true;
}

function territoryReceipt(value: unknown, revision = Number.MAX_SAFE_INTEGER, round = Number.MAX_SAFE_INTEGER, maxTiles = Number.MAX_SAFE_INTEGER): value is TileAcquisitionReceipt {
  if (!record(value) || !exactKeys(value, ['ruleVersion', 'id', 'cityId', 'civId', 'cityTileId', 'tileId', 'pathTileIds', 'distance', 'priorCivilizationPurchases', 'paid', 'acquiredRound', 'eventId'])
    || value.ruleVersion !== 1 || !boundedText(value.id) || !/^territory-[1-9]\d*$/.test(value.id)
    || !boundedText(value.cityId) || !integer(value.civId, 0, CIV_COUNT - 1) || !integer(value.cityTileId, 0, maxTiles - 1) || !integer(value.tileId, 0, maxTiles - 1)
    || !integer(value.distance, 1, 3) || !integer(value.priorCivilizationPurchases, 0, maxTiles - 1)
    || !record(value.paid) || !exactKeys(value.paid, ['credits']) || !finite(value.paid.credits)
    || !integer(value.acquiredRound, 0, round) || !Array.isArray(value.pathTileIds)
    || value.pathTileIds.length < 2 || value.pathTileIds.length > Math.min(37, maxTiles)
    || Object.keys(value.pathTileIds).length !== value.pathTileIds.length || !value.pathTileIds.every((id: unknown) => integer(id, 0, maxTiles - 1))
    || !unique(value.pathTileIds) || value.pathTileIds[0] !== value.cityTileId || value.pathTileIds.at(-1) !== value.tileId) return false;
  const accepted = Number(value.id.slice('territory-'.length));
  return integer(accepted, 1, revision) && completionRevision(value.eventId, revision) === accepted;
}

function sameTerritoryReceipt(left: TileAcquisitionReceipt, right: TileAcquisitionReceipt): boolean {
  return left.ruleVersion === right.ruleVersion && left.id === right.id && left.cityId === right.cityId && left.civId === right.civId
    && left.cityTileId === right.cityTileId && left.tileId === right.tileId && left.distance === right.distance
    && left.priorCivilizationPurchases === right.priorCivilizationPurchases && left.paid.credits === right.paid.credits
    && left.acquiredRound === right.acquiredRound && left.eventId === right.eventId
    && left.pathTileIds.length === right.pathTileIds.length && left.pathTileIds.every((id, index) => id === right.pathTileIds[index]);
}

function territoryRecords(present: boolean, value: unknown, cities: City[], tiles: HexTile[], events: GameEvent[], features: string[], round: number, revision: number, wonders: unknown): boolean {
  const enabled = features.includes('owned-territory');
  if (!enabled) return !present && events.every(event => !Object.hasOwn(event, 'territoryAcquisition'));
  if (!present || !record(value) || Object.keys(value).length > tiles.length) return false;
  const tileIndex = new Map(tiles.map(site => [site.id, site]));
  const cityIndex = new Map(cities.map(settlement => [settlement.id, settlement]));
  const centers = new Set(cities.map(settlement => settlement.tileId));
  const receipts = new Map<number, TileAcquisitionReceipt>();
  for (const [key, raw] of Object.entries(value)) {
    if (!territoryReceipt(raw, revision, round, tiles.length) || key !== String(raw.tileId)) return false;
    const center = tileIndex.get(raw.cityTileId); const target = tileIndex.get(raw.tileId); const settlement = cityIndex.get(raw.cityId);
    if (!center || !target || target.owner !== raw.civId || centers.has(raw.tileId) || hexDistance(center, target) !== raw.distance
      || settlement && (settlement.civId !== raw.civId || settlement.tileId !== raw.cityTileId)) return false;
    for (const [index, tileId] of raw.pathTileIds.entries()) {
      const site = tileIndex.get(tileId); const previous = tileIndex.get(raw.pathTileIds[index - 1] ?? -1);
      if (!site || hexDistance(center, site) > 3 || index > 0 && (!previous || hexDistance(previous, site) !== 1)) return false;
    }
    const event = events.find(candidate => candidate.id === raw.eventId);
    if (event && (!event.territoryAcquisition || !sameTerritoryReceipt(raw, event.territoryAcquisition))) return false;
    receipts.set(raw.tileId, raw);
  }
  const all = [...receipts.values()];
  if (!unique(all.map(receipt => receipt.id)) || !unique(all.map(receipt => receipt.eventId))) return false;
  const counts = new Map<number, number>();
  for (const receipt of all.toSorted((left, right) => Number(left.id.slice(10)) - Number(right.id.slice(10)))) {
    const count = counts.get(receipt.civId) ?? 0;
    if (receipt.priorCivilizationPurchases !== count) return false;
    counts.set(receipt.civId, count + 1);
  }
  const bound = (cityId: string, tileId: number): boolean => !receipts.has(tileId) || receipts.get(tileId)?.cityId === cityId;
  for (const settlement of cities) {
    if (!Object.values(settlement.districtSites ?? {}).every(tileId => bound(settlement.id, tileId))
      || !Object.values(settlement.improvements ?? {}).every(improvement => bound(settlement.id, improvement.tileId))) return false;
    for (const order of [settlement.construction?.active, settlement.construction?.lastCompleted])
      if (order && 'tileId' in order && order.tileId !== undefined && !bound(settlement.id, order.tileId)) return false;
  }
  if (record(wonders)) for (const entry of Object.values(wonders)) {
    if (!record(entry) || !wonderCompletion(entry.completion, revision, round) || !bound(entry.completion.cityId, entry.completion.tileId)) return false;
  }
  return events.every(event => {
    if (!event.territoryAcquisition) return true;
    const retained = receipts.get(event.territoryAcquisition.tileId);
    return !!retained && sameTerritoryReceipt(retained, event.territoryAcquisition);
  });
}

export function isGameEvent(value: unknown): value is GameEvent {
  return (
    record(value) &&
    ['id', 'type', 'title', 'cause'].every((field) => text(value[field])) &&
    typeof value.detail === 'string' &&
    integer(value.round) &&
    (value.actor === null || integer(value.actor, 0, DIRECTOR_SEAT)) &&
    (value.target === null || integer(value.target, 0, CIV_COUNT - 1)) &&
    (value.tileId === null || integer(value.tileId)) &&
    strings(value.effects) &&
    value.effects.length > 0 &&
    finite(value.importance) && wonderEvent(value) &&
    (!Object.hasOwn(value, 'populationGrowth') || (populationGrowth(value.populationGrowth) && value.type === 'population-growth'
      && value.populationGrowth.eventId === value.id && value.populationGrowth.round === value.round
      && value.populationGrowth.civId === value.actor && value.actor === value.target && integer(value.tileId))) &&
    (value.type !== 'territory-acquired' || Object.hasOwn(value, 'territoryAcquisition')) &&
    (!Object.hasOwn(value, 'territoryAcquisition') || (territoryReceipt(value.territoryAcquisition) && value.type === 'territory-acquired'
      && value.territoryAcquisition.eventId === value.id && value.territoryAcquisition.acquiredRound === value.round
      && value.territoryAcquisition.tileId === value.tileId && value.territoryAcquisition.civId === value.actor && value.actor === value.target)) &&
    (value.type !== 'coastal-founded' || Object.hasOwn(value, 'coastalFounding')) &&
    (!Object.hasOwn(value, 'coastalFounding') || (coastalReceipt(value.coastalFounding) && value.type === 'coastal-founded'
      && value.coastalFounding.eventId === value.id && value.coastalFounding.foundedRound === value.round && value.coastalFounding.destinationTileId === value.tileId
      && integer(value.actor, 0, CIV_COUNT - 1) && value.target === value.actor)) &&
    (!Object.hasOwn(value, 'strategicExtraction') || (strategicExtraction(value.strategicExtraction) && value.type === 'improvement-operation'
      && value.strategicExtraction.round === value.round && value.strategicExtraction.tileId === value.tileId
      && integer(value.actor, 0, CIV_COUNT - 1) && value.target === value.actor)) &&
    (!Object.hasOwn(value, 'strategicShipment') || (strategicShipment(value.strategicShipment) && value.type === 'trade-delivered'
      && value.strategicShipment.routeId === value.detail && value.strategicShipment.proposer === value.actor && value.strategicShipment.recipient === value.target)) &&
    (!Object.hasOwn(value, 'publicProjectResult') || (publicProjectResult(value.publicProjectResult) && record(value.publicProjectResult) && value.type === `public-project-${String(value.publicProjectResult.outcome)}`))
  );
}

function outcome(value: unknown): value is Outcome | null {
  return (
    value === null ||
    (record(value) &&
      typeof value.kind === 'string' &&
      ['mars', 'federation', 'cultural', 'economic', 'military'].includes(value.kind) &&
      Array.isArray(value.winners) &&
      value.winners.length > 0 &&
      value.winners.every((winner: unknown) => integer(winner, 0, CIV_COUNT - 1)) &&
      unique(value.winners) &&
      integer(value.round) &&
      text(value.reason))
  );
}

function independentTurns(value: unknown, round: number): boolean {
  if (!record(value) || typeof value.epoch !== 'string') return false;
  const epoch = parseUtcTimestamp(value.epoch);
  if (epoch === null || !integer(value.strategyTicks, 0, round)
    || !Number.isFinite(new Date(epoch + (value.strategyTicks + 1) * TURN_RULES.strategyIntervalMs).getTime())
    || !Array.isArray(value.lastActionWindow) || value.lastActionWindow.length !== DIRECTOR_SEAT + 1
    || !Array.isArray(value.actionsInWindow) || value.actionsInWindow.length !== DIRECTOR_SEAT + 1) return false;
  const counts = value.actionsInWindow;
  const nextBoundary = epoch + (value.strategyTicks + 1) * TURN_RULES.strategyIntervalMs;
  return value.lastActionWindow.every((window: unknown, seat: number) => integer(window, -1)
    && Number.isFinite(new Date(epoch + (window + 1) * TURN_RULES.tacticalWindowMs).getTime())
    && epoch + window * TURN_RULES.tacticalWindowMs < nextBoundary
    && integer(counts[seat], 0, TURN_RULES.actionsPerWindow)
    && (window === -1 ? counts[seat] === 0 : counts[seat] > 0));
}

function actionPlans(value: unknown, revision: number): boolean {
  return Array.isArray(value) && value.length === DIRECTOR_SEAT + 1
    && Array.from(value).every((plan: unknown) => plan === null || isPersistedActionPlan(plan, revision));
}

export function isWorldState(
  value: unknown,
  options: { allowLegacyClock?: boolean } = {},
): value is WorldState {
  if (
    !record(value) ||
    value.schemaVersion !== SCHEMA_VERSION ||
    value.gameVersion !== GAME_VERSION ||
    !text(value.releaseId) ||
    !knownStrings(
      value.unlockedFeatures,
      FEATURES.map((feature) => feature.id),
    ) ||
    !knownStrings(
      value.calendarMilestones,
      HISTORICAL_MILESTONES.map((milestone) => milestone.id),
    ) ||
    !integer(value.seed, 0, 0xffffffff) ||
    !integer(value.rng, 0, 0xffffffff) ||
    !integer(value.revision) ||
    !integer(value.round) ||
    !integer(value.phase, 0, DIRECTOR_SEAT) ||
    !integer(value.year, -Number.MAX_SAFE_INTEGER) ||
    !integer(value.width, 1) ||
    !integer(value.height, 1) ||
    !finite(value.climate, -Number.MAX_SAFE_INTEGER) ||
    !integer(value.directorCooldown) ||
    !record(value.eventCounts) ||
    !Object.values(value.eventCounts).every((count) => integer(count)) ||
    !record(value.directorIntervals) ||
    !Object.entries(value.directorIntervals).every(
      ([key, timestamp]) =>
        /^(clock|event|review):.+/.test(key) &&
        typeof timestamp === 'string' &&
        parseUtcTimestamp(timestamp) !== null,
    ) ||
    ('historyAdvances' in value && !historyAdvances(value.historyAdvances, value.revision, value.year, value.unlockedFeatures)) ||
    (value.unlockedFeatures.includes('independent-actions') !== ('independentTurns' in value)) ||
    ('independentTurns' in value && !independentTurns(value.independentTurns, value.round)) ||
    (value.unlockedFeatures.includes('bounded-plans') !== ('actionPlans' in value)) ||
    ('actionPlans' in value && !actionPlans(value.actionPlans, value.revision)) ||
    !outcome(value.outcome)
  )
    return false;
  const legacyClock =
    options.allowLegacyClock === true &&
    value.clockEpoch === undefined &&
    value.clockTicks === undefined &&
    Object.keys(value.directorIntervals).length === 0;
  if (
    !legacyClock &&
    (!integer(value.clockTicks) ||
      (value.clockEpoch !== null &&
        (typeof value.clockEpoch !== 'string' || parseUtcTimestamp(value.clockEpoch) === null)) ||
      (value.clockEpoch === null && value.clockTicks !== 0))
  )
    return false;
  if (
    !Array.isArray(value.civilizations) ||
    !value.civilizations.every(civilization) ||
    value.civilizations.length !== CIV_COUNT ||
    !unique(value.civilizations.map((item) => item.id)) ||
    !Array.isArray(value.cities) ||
    !value.cities.every(city) ||
    !unique(value.cities.map((item) => item.id)) ||
    !Array.isArray(value.tiles) ||
    !value.tiles.every(tile) ||
    !unique(value.tiles.map((item) => item.id)) ||
    !Array.isArray(value.routes) ||
    !value.routes.every(route) ||
    !unique(value.routes.map((item) => item.id)) ||
    !Array.isArray(value.treaties) ||
    !value.treaties.every(treaty) ||
    !unique(value.treaties.map((item) => item.id)) ||
    !Array.isArray(value.events) ||
    !value.events.every(isGameEvent) ||
    !unique(value.events.map((item) => item.id))
  )
    return false;
  const width = value.width;
  const height = value.height;
  const tiles = value.tiles;
  const cities = value.cities;
  const round = value.round;
  const features = value.unlockedFeatures;
  const counts = value.eventCounts;
  if (features.includes('world-expansion') && (width !== 18 || height !== 24)) return false;
  if (
    tiles.length !== width * height ||
    !tiles.every(
      (item) => item.q < width && item.r < height && item.id === item.r * width + item.q,
    ) ||
    !cities.every((item) =>
      tiles.some((site) => site.id === item.tileId && site.owner === item.civId),
    ) ||
    !unique(cities.map((item) => item.tileId)) ||
    !cities.every((item) => buildingOperations(item, round, features)) ||
    !growthRecords(cities, value.events, features, round, value.revision) ||
    !recurringRecords(cities, value.civilizations, features, round, value.revision) ||
    !civicRecords(value.civilizations, value.events, features, round, value.revision) ||
    !districtRecords(cities, tiles, value.events, features) ||
    !observatoryRecords(cities, tiles, value.events, features) ||
    !improvementRecords(cities, tiles, value.events, features, round, value.revision) ||
    !metalRecords(Object.hasOwn(value, 'strategicDeposits'), value.strategicDeposits, value.civilizations, cities, tiles, value.events, value.routes, features, value.seed) ||
    !waterLandRecords(Object.hasOwn(value, 'pastoralSites'), value.pastoralSites, cities, tiles, value.events, features, value.seed, value.strategicDeposits) ||
    !coastalRecords(cities, value.events, tiles, features, round, value.revision) ||
    !wonderRecords(Object.hasOwn(value, 'wonders'), value.wonders, cities, value.civilizations, tiles, value.events, features, value.revision, round) ||
    !territoryRecords(Object.hasOwn(value, 'tileAcquisitions'), value.tileAcquisitions, cities, tiles, value.events, features, round, value.revision, value.wonders) ||
    !value.civilizations.every((item) =>
      cities.some((settlement) => settlement.civId === item.id),
    ) ||
    !value.routes.every(
      (item) =>
        cities.some((endpoint) => endpoint.id === item.from && endpoint.civId === item.owner) &&
        cities.some((endpoint) => endpoint.id === item.to && endpoint.civId === item.partner),
    ) ||
    !tradeState('tradeOffers' in value ? value.tradeOffers : [], value.routes, cities, tiles, round, features) ||
    (features.includes('public-projects') !== Object.hasOwn(value, 'publicProjects')) ||
    ('publicProjects' in value && !publicProjects(value.publicProjects, round, value.routes)) ||
    (!features.includes('public-projects') && value.events.some((item) => Object.hasOwn(item, 'publicProjectResult'))) ||
    !value.treaties.every((item) => item.since <= round) ||
    !value.events.every(
      (item) =>
        item.round <= round &&
        (item.tileId === null || tiles.some((site) => site.id === item.tileId)) &&
        integer(counts[item.type], 1),
    ) ||
    (value.outcome !== null && value.outcome.round > round)
  )
    return false;
  return true;
}
