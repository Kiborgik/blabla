import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capabilityGraphLayout, capabilityTreeNodes } from '../web/capability-tree.ts';
import { capabilityCatalogue, projectCapabilities } from '../core/capabilities.ts';
import { createWorld } from '../core/engine.ts';
import { eventLogEntries, eventLogPage } from '../web/event-log.ts';
import type { GameEvent } from '../core/types.ts';

void test('connected compact graph retains every node and every multi-parent edge without collisions', () => {
  const state = createWorld(1701, '2026-10-16T00:00:00Z');
  const catalogue = capabilityCatalogue();
  const nodes = capabilityTreeNodes({ runId: 'local', civilizationName: 'Aster', towns: [], catalogue, projection: projectCapabilities(state, 0, 'city-0', '2026-10-16T00:00:00Z') });
  const before = structuredClone(nodes);
  const graph = capabilityGraphLayout(nodes);
  assert.equal(graph.nodes.length, catalogue.technologies.length + catalogue.buildings.length + catalogue.improvements.length + catalogue.wonders.length);
  const displayed = new Set(nodes.map(node => node.id));
  const expectedEdges = catalogue.edges.filter(edge => displayed.has(edge.from) && displayed.has(edge.to));
  const edgeKey = (edge: { from: string; to: string }): string => `${edge.from}→${edge.to}`;
  assert.deepEqual(graph.edges.map(edgeKey).toSorted(), expectedEdges.map(edgeKey).toSorted());
  assert.ok(nodes.some(node => node.requires.length > 1));
  for (const node of nodes.filter(node => node.requires.length > 1)) assert.deepEqual(graph.edges.filter(edge => edge.to === node.id).map(edge => edge.from).toSorted(), node.requires.filter(parent => displayed.has(parent)).toSorted());
  assert.equal(new Set(graph.nodes.map(node => `${node.x},${node.y}`)).size, nodes.length);
  assert.ok(graph.nodes.every(node => node.width >= 140 && node.height >= 64));
  assert.deepEqual(nodes, before);
});
void test('event pages bound visible cards to six while preserving every selected record across pages', () => {
  const events: GameEvent[] = Array.from({ length: 20 }, (_, index) => ({ id: `${index}:0`, round: index, type: 'research-started', title: 'Aster begins a discovery', detail: 'agriculture', actor: index % 2, target: null, cause: 'recorded', effects: [], importance: 2, tileId: null }));
  const rows = eventLogEntries(events, { civilizations: [{ id: 0, name: 'Aster', color: '#ffffff' }, { id: 1, name: 'Verdant', color: '#000000' }] });
  const first = eventLogPage(rows, { actor: '', family: 'important', page: 0 });
  assert.equal(first.rows.length, 6); assert.equal(first.pages, 4);
  assert.deepEqual(Array.from({ length: first.pages }, (_, page) => eventLogPage(rows, { actor: '', family: 'important', page }).rows).flat().map(row => row.id), rows.map(row => row.id));
  const filtered = eventLogPage(rows, { actor: 'Aster', family: 'research', page: 999 });
  assert.equal(filtered.total, 10); assert.equal(filtered.page, 1);
  assert.ok(filtered.rows.every(row => row.participants.some(person => person.name === 'Aster')));
  assert.equal(eventLogPage(rows, { actor: 'Missing', family: 'all', page: 0 }).rows.length, 0);
});
