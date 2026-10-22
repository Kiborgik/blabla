import assert from 'node:assert/strict';
import test from 'node:test';
import { historicalEventInstanceId, type HistoricalEventReceipt, type HistoricalEventSelection } from '../core/historical-selection.ts';
import { assertHistoricalEventReceipt, assertHistoricalEventSelection, isHistoricalEventReceipt, isHistoricalEventSelection } from '../core/historical-selection-validation.ts';

function selected(): HistoricalEventSelection {
  return { ruleVersion: 1, instanceId: historicalEventInstanceId(1701, 'cultivated-harvest', 0, 2), occurrence: 2, local: { kind: 'cultivated-harvest', cityId: 'city-0', tileId: 3 } };
}

function receipt(): HistoricalEventReceipt {
  const selection = selected();
  return { ruleVersion: 1, instanceId: selection.instanceId, occurrence: 2, selection, eventKind: 'cultivated-harvest', civId: 0, eventId: '13:0', revision: 13, round: 4, paid: { materials: 3 }, facts: [
    { scope: 'civilization', id: 0, field: 'materials', before: 7, after: 4 },
    { scope: 'civilization', id: 0, field: 'food', before: 6, after: 14 },
  ] };
}

void test('closed selectors accept all exact local variants and JSON round-trip without extra keys', () => {
  const route = { routeId: 'route-1', agreementOfferId: 'offer-1', fromCityId: 'city-0', toCityId: 'city-1' };
  const locals: HistoricalEventSelection['local'][] = [
    { kind: 'cultivated-harvest', cityId: 'city-0', tileId: 3 },
    { kind: 'forest-fire', cityId: 'city-0', tileId: 3, forestTileId: 4 },
    { kind: 'coastal-storm', cityId: 'city-0', tileId: 3, route: null },
    { kind: 'coastal-storm', cityId: 'city-0', tileId: 3, route },
    { kind: 'trade-fair', cityId: 'city-0', tileId: 3, route },
    { kind: 'industrial-accident', cityId: 'city-0', tileId: 3, buildingId: 'factory' },
    { kind: 'internal-migration', cityId: 'city-0', tileId: 3, destinationCityId: 'city-2', destinationTileId: 9 },
  ];
  for (const local of locals) {
    const value = { ...selected(), instanceId: historicalEventInstanceId(1701, local.kind, 0, 2), local };
    assertHistoricalEventSelection(value); assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
  }
  for (const value of [null, {}, [], { ...selected(), extra: true }, { ...selected(), ruleVersion: 2 }, { ...selected(), occurrence: 0 }, { ...selected(), occurrence: Number.MAX_SAFE_INTEGER + 1 }, { ...selected(), local: { ...selected().local, route: null } }, { ...selected(), local: { ...selected().local, tileId: -1 } }, { ...selected(), local: { ...selected().local, tileId: 1.5 } }, { ...selected(), instanceId: '["regional-targets-v2",1701,"cultivated-harvest",0,2]' }, { ...selected(), instanceId: historicalEventInstanceId(1701, 'forest-fire', 0, 2) }]) {
    assert.equal(isHistoricalEventSelection(value), false, JSON.stringify(value)); assert.throws(() => assertHistoricalEventSelection(value));
  }
  const coastal = { ...selected(), instanceId: historicalEventInstanceId(1701, 'coastal-storm', 0, 2), local: { kind: 'coastal-storm', cityId: 'city-0', tileId: 3, route } };
  for (const wrongRoute of [{ ...route, extra: true }, { ...route, agreementOfferId: '' }, { ...route, fromCityId: 'other' }, { ...route, toCityId: route.fromCityId }]) assert.equal(isHistoricalEventSelection({ ...coastal, local: { ...coastal.local, route: wrongRoute } }), false);
});

void test('receipt validation rejects malformed versions fields bindings costs and immediate accounting', () => {
  const good = receipt(); assertHistoricalEventReceipt(good); assert.deepEqual(JSON.parse(JSON.stringify(good)), good);
  const malformed: unknown[] = [null, {}, { ...good, extra: true }, { ...good, ruleVersion: 2 }, { ...good, eventKind: 'forest-fire' }, { ...good, civId: 1 }, { ...good, instanceId: 'other' }, { ...good, occurrence: 3 }, { ...good, revision: 12 }, { ...good, eventId: '13:9007199254740992' }, { ...good, round: -1 }, { ...good, paid: {} }, { ...good, paid: { materials: 3, gold: 0 } }, { ...good, facts: [] }, { ...good, facts: [...good.facts, good.facts[0]] }, { ...good, facts: good.facts.map(fact => ({ ...fact, extra: 1 })) }, { ...good, facts: good.facts.map(fact => ({ ...fact, id: 1 })) }, { ...good, facts: good.facts.map(fact => ({ ...fact, after: 0 })) }];
  for (const value of malformed) { assert.equal(isHistoricalEventReceipt(value), false, JSON.stringify(value)); assert.throws(() => assertHistoricalEventReceipt(value)); }
});

void test('migration receipts require immediate minus-two plus-two and losses never become voluntary costs', () => {
  const selection: HistoricalEventSelection = { ruleVersion: 1, instanceId: historicalEventInstanceId(17, 'internal-migration', 0, 1), occurrence: 1, local: { kind: 'internal-migration', cityId: 'source', tileId: 1, destinationCityId: 'destination', destinationTileId: 2 } };
  const migration: HistoricalEventReceipt = { ...receipt(), selection, instanceId: selection.instanceId, occurrence: 1, eventKind: 'internal-migration', paid: { food: 4, credits: 2 }, facts: [
    { scope: 'civilization', id: 0, field: 'food', before: 4, after: 0 }, { scope: 'civilization', id: 0, field: 'credits', before: 7, after: 5 },
    { scope: 'city', id: 'source', field: 'population', before: 6, after: 4 }, { scope: 'city', id: 'destination', field: 'population', before: 2, after: 4 },
  ] };
  assertHistoricalEventReceipt(migration);
  assert.equal(isHistoricalEventReceipt({ ...migration, facts: migration.facts.map(fact => fact.id === 'destination' ? { ...fact, after: 5 } : fact) }), false);
  const fireSelection: HistoricalEventSelection = { ruleVersion: 1, instanceId: historicalEventInstanceId(17, 'forest-fire', 0, 1), occurrence: 1, local: { kind: 'forest-fire', cityId: 'source', tileId: 1, forestTileId: 2 } };
  const fire: HistoricalEventReceipt = { ...migration, selection: fireSelection, instanceId: fireSelection.instanceId, eventKind: 'forest-fire', paid: {}, facts: [
    { scope: 'city', id: 'source', field: 'damage', before: 90, after: 100 }, { scope: 'city', id: 'source', field: 'wellbeing', before: 2, after: 0 }, { scope: 'civilization', id: 0, field: 'materials', before: 1, after: 0 },
  ] };
  assertHistoricalEventReceipt(fire); assert.equal(isHistoricalEventReceipt({ ...fire, paid: { materials: 1 } }), false);
});

void test('canonical identity includes only version seed family civilization and occurrence', () => {
  assert.equal(historicalEventInstanceId(1701, 'forest-fire', 2, 3), '["regional-targets-v1",1701,"forest-fire",2,3]');
  const good = selected();
  for (const instanceId of [' ["regional-targets-v1",1701,"cultivated-harvest",0,2]', '["regional-targets-v1",1701,"cultivated-harvest",5,2]', '["regional-targets-v1",1.5,"cultivated-harvest",0,2]', '["regional-targets-v1",-1,"cultivated-harvest",0,2]', '["regional-targets-v1",4294967296,"cultivated-harvest",0,2]', '["regional-targets-v1",1701,"cultivated-harvest",0,2,0]']) assert.equal(isHistoricalEventSelection({ ...good, instanceId }), false);
  const migration = { ...good, instanceId: historicalEventInstanceId(1701, 'internal-migration', 0, 2), local: { kind: 'internal-migration', cityId: 'source', tileId: 1, destinationCityId: 'destination', destinationTileId: 2 } };
  assertHistoricalEventSelection(migration);
  assert.equal(isHistoricalEventSelection({ ...migration, local: { ...migration.local, destinationCityId: 'source' } }), false);
  assert.equal(isHistoricalEventSelection({ ...migration, local: { ...migration.local, destinationTileId: 1 } }), false);
});
