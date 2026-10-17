import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isGameAction } from '../core/planning.ts';
import { createWorker } from '../server/worker.ts';

function object(value: unknown): Record<string, unknown> {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value));
  return Object.fromEntries(Object.entries(value));
}

async function discovery(): Promise<Map<string, Record<string, unknown>>> {
  const response = await createWorker().fetch(new Request('https://world.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }), {});
  assert.equal(response.status, 200);
  const wire: unknown = await response.json();
  const listed = object(object(wire).result).tools;
  assert.ok(Array.isArray(listed));
  return new Map(listed.map(value => { const entry = object(value); assert.equal(typeof entry.name, 'string'); return [String(entry.name), entry]; }));
}

await test('observation discovery explains overdue admission and the explicit atomic option without requiring a database', async () => {
  const tool = (await discovery()).get('observe_world');
  assert.ok(tool && typeof tool.description === 'string');
  assert.equal(object(tool.annotations).readOnlyHint, true);
  for (const token of ['legalActions', 'admission', 'strategy-action', 'structural']) assert.ok(tool.description.includes(token), token);
  const schema = object(tool.inputSchema);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(object(schema.properties)).toSorted(), ['choiceCursor', 'observationFormat', 'seat']);
});

await test('action discovery has strict composite revision guidance and a canonical exact-town build example', async () => {
  const tool = (await discovery()).get('play_action');
  assert.ok(tool && typeof tool.description === 'string');
  assert.match(tool.description, /catchup_strategy/);
  const schema = object(tool.inputSchema);
  const properties = object(schema.properties);
  const revision = object(properties.expectedRevision);
  assert.ok(typeof revision.description === 'string');
  for (const token of ['strategy-action', 'strict', 'original', 'expectedRevision']) assert.ok(revision.description.includes(token), token);
  const examples = object(properties.action).examples;
  assert.ok(Array.isArray(examples));
  const combined = examples.map(object).find(example => example.type === 'strategy-action');
  assert.ok(combined && isGameAction(combined.action));
  assert.deepEqual(combined.action, { type: 'build', project: 'kiln', cityId: 'city-0' });
  assert.deepEqual(Object.keys(combined).toSorted(), ['action', 'type']);
  assert.ok(examples.map(object).some(example => example.type === 'strategy-catchup' && typeof example.timestamp === 'string'));
  assert.deepEqual(schema.required, ['seat', 'expectedRevision', 'model', 'commandId']);
  assert.equal(schema.additionalProperties, false);
  assert.equal(object(properties.action).type, 'object');
  assert.equal(object(properties.plan).maxItems, 2);
});

await test('metadata discovery does not enroll a caller or weaken protected action authorization', async () => {
  const worker = createWorker();
  const response = await worker.fetch(new Request('https://world.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'play_action', arguments: { seat: 0, expectedRevision: 0, model: 'metadata-fixture', commandId: 'metadata-only', action: { type: 'strategy-action', action: { type: 'build', project: 'kiln', cityId: 'city-0' } } } } }) }), {});
  assert.equal(response.status, 401);
});
