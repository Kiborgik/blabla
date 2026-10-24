import { HISTORICAL_DIRECTOR_EVENTS, HISTORICAL_EVENT_RULES } from './historical-event-content.ts';
import { historicalEventInstanceId, type HistoricalEventFact, type HistoricalEventReceipt, type HistoricalEventSelection } from './historical-selection.ts';
import { CIV_COUNT } from './types.ts';

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function keys(value: RecordValue, names: readonly string[]): boolean { return Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)); }
function integer(value: unknown, minimum = 0): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum; }
function identifier(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 128; }
function numeric(value: unknown, maximum = Number.MAX_SAFE_INTEGER): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum; }

function instance(value: unknown): [string, number, string, number, number] | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  let tuple: unknown;
  try { tuple = JSON.parse(value); } catch { return null; }
  if (!Array.isArray(tuple) || tuple.length !== 5 || tuple[0] !== 'regional-targets-v1' || !integer(tuple[1]) || tuple[1] > 0xffffffff || !HISTORICAL_DIRECTOR_EVENTS.some(event => event.id === tuple[2]) || !integer(tuple[3]) || tuple[3] >= CIV_COUNT || !integer(tuple[4], 1) || JSON.stringify(tuple) !== value) return null;
  return tuple as [string, number, string, number, number];
}

function route(value: unknown, cityId: string): boolean {
  return record(value) && keys(value, ['routeId', 'agreementOfferId', 'fromCityId', 'toCityId'])
    && identifier(value.routeId) && identifier(value.agreementOfferId) && identifier(value.fromCityId) && identifier(value.toCityId)
    && value.fromCityId !== value.toCityId && (value.fromCityId === cityId || value.toCityId === cityId);
}

export function isHistoricalEventSelection(value: unknown): value is HistoricalEventSelection {
  if (!record(value) || !keys(value, ['ruleVersion', 'instanceId', 'occurrence', 'local']) || value.ruleVersion !== 1 || !integer(value.occurrence, 1) || !record(value.local)) return false;
  const identity = instance(value.instanceId); const local = value.local;
  if (!identity || identity[4] !== value.occurrence || identity[2] !== local.kind || !identifier(local.cityId) || !integer(local.tileId)) return false;
  const common = ['kind', 'cityId', 'tileId'];
  switch (local.kind) {
    case 'cultivated-harvest': return keys(local, common);
    case 'forest-fire': return keys(local, [...common, 'forestTileId']) && integer(local.forestTileId) && local.forestTileId !== local.tileId;
    case 'coastal-storm': return keys(local, [...common, 'route']) && (local.route === null || route(local.route, local.cityId));
    case 'trade-fair': return keys(local, [...common, 'route']) && route(local.route, local.cityId);
    case 'industrial-accident': return keys(local, [...common, 'buildingId']) && HISTORICAL_EVENT_RULES.industries.some(id => id === local.buildingId);
    case 'internal-migration': return keys(local, [...common, 'destinationCityId', 'destinationTileId']) && identifier(local.destinationCityId) && local.destinationCityId !== local.cityId && integer(local.destinationTileId) && local.destinationTileId !== local.tileId;
    default: return false;
  }
}

export function assertHistoricalEventSelection(value: unknown): asserts value is HistoricalEventSelection {
  if (!isHistoricalEventSelection(value)) throw new TypeError('Invalid historical event selection');
}

function fact(value: unknown): value is HistoricalEventFact {
  if (!record(value) || !keys(value, ['scope', 'id', 'field', 'before', 'after'])) return false;
  if (value.scope === 'civilization') return integer(value.id) && value.id < CIV_COUNT && typeof value.field === 'string' && numeric(value.before) && numeric(value.after);
  if (!identifier(value.id)) return false;
  if (value.scope === 'city') {
    if (value.field === 'population') return integer(value.before, 1) && integer(value.after, 1);
    return (value.field === 'damage' || value.field === 'wellbeing') && numeric(value.before, 100) && numeric(value.after, 100);
  }
  return value.scope === 'route' && (value.field === 'damage' ? numeric(value.before, 100) && numeric(value.after, 100) : value.field === 'damageDisableAt' ? numeric(value.before, 100) && value.before > 0 && value.after === value.before : value.field === 'active' && typeof value.before === 'boolean' && typeof value.after === 'boolean');
}

function factKey(value: Pick<HistoricalEventFact, 'scope' | 'id' | 'field'>): string { return JSON.stringify([value.scope, value.id, value.field]); }

export function isHistoricalEventReceipt(value: unknown): value is HistoricalEventReceipt {
  if (!record(value) || !keys(value, ['ruleVersion', 'instanceId', 'occurrence', 'selection', 'eventKind', 'civId', 'eventId', 'revision', 'round', 'paid', 'facts']) || value.ruleVersion !== 1 || !isHistoricalEventSelection(value.selection) || !integer(value.civId) || value.civId >= CIV_COUNT || !integer(value.revision) || !integer(value.round) || !identifier(value.eventId) || !/^(0|[1-9]\d*):(0|[1-9]\d*)$/.test(value.eventId) || !value.eventId.split(':').every(part => integer(Number(part))) || Number(value.eventId.split(':')[0]) !== value.revision || !record(value.paid) || !Array.isArray(value.facts) || !value.facts.every(fact)) return false;
  const selection = value.selection; const local = selection.local;
  const identity = instance(selection.instanceId);
  if (!identity || value.instanceId !== selection.instanceId || value.occurrence !== selection.occurrence || value.eventKind !== local.kind || value.instanceId !== historicalEventInstanceId(identity[1], local.kind, value.civId, selection.occurrence)) return false;
  const cost = local.kind === 'cultivated-harvest' ? HISTORICAL_EVENT_RULES.harvestCost : local.kind === 'trade-fair' ? HISTORICAL_EVENT_RULES.fairCost : local.kind === 'internal-migration' ? HISTORICAL_EVENT_RULES.migrationCost : {};
  const paid = value.paid;
  if (!keys(paid, Object.keys(cost)) || !Object.entries(cost).every(([key, amount]) => Reflect.get(paid, key) === amount)) return false;
  const facts = value.facts as HistoricalEventFact[];
  const actual = new Map(facts.map(item => [factKey(item), item]));
  if (actual.size !== facts.length) return false;
  const expected = new Set<string>();
  const delta = (scope: HistoricalEventFact['scope'], id: string | number, field: string, amount: number, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): boolean => {
    const key = factKey({ scope, id, field }); expected.add(key);
    const result = actual.get(key);
    return !!result && typeof result.before === 'number' && result.after === Math.max(minimum, Math.min(maximum, result.before + amount));
  };
  const definition = HISTORICAL_DIRECTOR_EVENTS.find(event => event.id === local.kind);
  if (!definition) return false;
  for (const effect of definition.effects) {
    if (effect.kind === 'resource' && !delta('civilization', value.civId, effect.resource, effect.amount)) return false;
    if (effect.kind === 'city' && !delta('city', local.cityId, effect.field, effect.amount, effect.field === 'population' ? 1 : 0, effect.field === 'wellbeing' || effect.field === 'damage' ? 100 : Number.MAX_SAFE_INTEGER)) return false;
  }
  for (const [resource, amount] of Object.entries(cost)) {
    const paid = actual.get(factKey({ scope: 'civilization', id: value.civId, field: resource }));
    if (typeof amount !== 'number' || !paid || typeof paid.before !== 'number' || paid.before < amount || paid.after !== paid.before - amount) return false;
  }
  if (local.kind === 'internal-migration' && (!delta('city', local.cityId, 'population', -2, 1) || !delta('city', local.destinationCityId, 'population', 2, 1))) return false;
  if (local.kind === 'internal-migration') {
    const source = actual.get(factKey({ scope: 'city', id: local.cityId, field: 'population' }));
    if (!source || typeof source.before !== 'number' || source.before < 3) return false;
  }
  if (local.kind === 'coastal-storm' && local.route) {
    if (!delta('route', local.route.routeId, 'damage', HISTORICAL_EVENT_RULES.stormRouteDamage, 0, 100)) return false;
    const key = factKey({ scope: 'route', id: local.route.routeId, field: 'active' }); expected.add(key);
    const active = actual.get(key);
    const thresholdKey = factKey({ scope: 'route', id: local.route.routeId, field: 'damageDisableAt' }); expected.add(thresholdKey);
    const threshold = actual.get(thresholdKey);
    const damage = actual.get(factKey({ scope: 'route', id: local.route.routeId, field: 'damage' }));
    if (!threshold || !damage || typeof threshold.before !== 'number' || typeof damage.before !== 'number' || typeof damage.after !== 'number' || damage.before >= threshold.before
      || !active || active.before !== true || active.after !== (damage.after < threshold.before)) return false;
  }
  return expected.size === actual.size && [...expected].every(key => actual.has(key));
}

export function assertHistoricalEventReceipt(value: unknown): asserts value is HistoricalEventReceipt {
  if (!isHistoricalEventReceipt(value)) throw new TypeError('Invalid historical event receipt');
}
