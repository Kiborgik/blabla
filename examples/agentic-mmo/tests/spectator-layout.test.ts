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

import type { AtlasWorld } from '../web/atlas.ts';
import { mapHierarchyAnchors } from '../web/map-labels.ts';
import { allocateMapHierarchy } from '../visuals/map-hierarchy.ts';
import { DEFAULT_PREFERENCES, parsePreferences } from '../web/viewer-state.ts';
import { flatMapPoint, transformedVertices } from '../web/settlement-parts.ts';
import { settlementVisual, settlementDetail, SETTLEMENT_RENDER_SCALE } from '../visuals/world-visuals.ts';

const town = { id: 0, cityId: 'town-a', name: 'Aster', shortName: 'Aster', capital: 'Hearth', color: '#ad914b', symbol: 'A', character: '', ambition: '', q: 0, r: 0, population: 9,
  settlement: { id: 'town-a', worldSeed: 1701, civId: 0, tileId: 1, name: 'Hearth', population: 9, wellbeing: 70, damage: 0, buildings: ['farm', 'granary'] } };
const world: AtlasWorld = { cities: [town], tiles: [{ id: 1, q: 0, r: 0, height: .4, terrain: 'grassland', owner: 0 }], routes: [] };
const overlaps = (a: { left: number; top: number; width: number; height: number }, b: typeof a): boolean => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;

void test('town crests protect complete installed roof and field geometry without requiring active construction', () => {
  const before = structuredClone(world);
  for (const scale of [16, 42, 65]) {
    const project = (q: number, r: number, height: number) => { const p = flatMapPoint(Math.sqrt(3) * (q + r / 2), 1.5 * r, height); return { x: 350 + p.x * scale, y: 300 + p.z * scale }; };
    const anchor = mapHierarchyAnchors(world, 'town-a', null, project)[0];
    assert.ok(anchor?.protectedBounds);
    const box = anchor.protectedBounds;
    const visual = settlementVisual(town.settlement, settlementDetail(scale * 2));
    for (const part of visual.parts) for (const [x, y, z] of transformedVertices(part)) {
      const p = project((x / Math.sqrt(3) - z / 3) * SETTLEMENT_RENDER_SCALE, z / 1.5 * SETTLEMENT_RENDER_SCALE, .4 + y * SETTLEMENT_RENDER_SCALE);
      assert.ok(p.x >= box.left && p.x <= box.left + box.width && p.y >= box.top && p.y <= box.top + box.height, part.id);
    }
    const placed = allocateMapHierarchy([anchor], { width: 1182, height: 758, tileDiameter: scale * 2 }).items[0];
    assert.ok(placed?.mark);
    assert.equal(placed.placementMode, 'exterior');
    assert.equal(overlaps(placed.mark, box), false);
    assert.ok(placed.mark.width >= 44 && placed.mark.height >= 44);
    assert.ok(placed.symbolSize <= 22);
  }
  assert.deepEqual(world, before);
});

void test('new viewers use a dark shell while explicit saved theme choices remain unchanged', () => {
  assert.equal(DEFAULT_PREFERENCES.theme, 'dark');
  assert.equal(parsePreferences(null).theme, 'dark');
  for (const theme of ['light', 'system', 'dark'] as const) assert.equal(parsePreferences({ schemaVersion: 1, theme }).theme, theme);
});

void test('safe camera anchors use actual desktop and narrow obstacle bounds', async () => {
  const { spectatorSafeAnchor } = await import('../web/spectator-layout.ts');
  for (const [width, height, obstacles] of [
    [1182, 758, [{ left: 0, top: 0, width: 1182, height: 130 }, { left: 810, top: 144, width: 352, height: 550 }, { left: 0, top: 710, width: 1182, height: 48 }]],
    [390, 844, [{ left: 0, top: 0, width: 390, height: 140 }, { left: 10, top: 430, width: 370, height: 300 }, { left: 0, top: 744, width: 390, height: 100 }]],
  ] as const) {
    const anchor = spectatorSafeAnchor(width, height, obstacles);
    const x = anchor.x * width; const y = anchor.y * height;
    assert.ok(x > 0 && x < width && y > 0 && y < height);
    for (const box of obstacles) assert.ok(x < box.left || x > box.left + box.width || y < box.top || y > box.top + box.height);
  }
});
