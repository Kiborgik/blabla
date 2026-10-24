import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateMapHierarchy, hierarchyScale, retainedCoordinateShift, mapContentWindow, fitMapOverview, type HierarchyAnchor, type ScreenBox } from '../visuals/map-hierarchy.ts';

const frame = { width: 360, height: 507, tileDiameter: 20 };
const town = (id: string, x: number, y: number, selected = false): HierarchyAnchor => ({ id, kind: 'town', label: id, x, y, selected, importance: 10 });
const overlaps = (a: ScreenBox, b: ScreenBox): boolean => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;

void test('overview towns and a completed landmark outrank passive resource badges in one bounded allocation', () => {
  const anchors: HierarchyAnchor[] = [town('Dawnwell', 75, 140, true), town('Tidehaven', 275, 180),
    { id: 'library', kind: 'wonder', label: 'Great library', x: 170, y: 260, completed: true },
    ...Array.from({ length: 10 }, (_, index): HierarchyAnchor => ({ id: `horse-${index}`, kind: 'resource', label: 'Horses', x: 35 + index % 5 * 68, y: 330 + Math.floor(index / 5) * 75, revealed: true }))];
  const result = allocateMapHierarchy(anchors, frame);
  assert.ok(result.items.find(item => item.id === 'Dawnwell')?.label);
  assert.ok(result.items.find(item => item.id === 'Tidehaven')?.label);
  assert.ok(result.items.find(item => item.id === 'library')?.mark);
  assert.ok(result.items.filter(item => item.kind === 'resource' && item.mark).length <= 2);
  assert.ok(result.items.filter(item => item.label).length <= result.budgets.labels);
  assert.ok(result.items.filter(item => item.mark).length <= result.budgets.marks);
});

void test('selected exact town and related work win deterministic collisions without moving canonical anchors', () => {
  const anchors: HierarchyAnchor[] = [town('capital', 160, 180), town('frontier', 160, 180, true),
    { id: 'mine', kind: 'site', label: 'Mine', x: 210, y: 230, related: true },
    { id: 'horse', kind: 'resource', label: 'Horses', x: 210, y: 230, revealed: true }];
  const before = structuredClone(anchors);
  const result = allocateMapHierarchy(anchors, frame);
  assert.ok(result.items.find(item => item.id === 'frontier')?.label);
  assert.ok(result.items.find(item => item.id === 'mine')?.mark);
  assert.deepEqual(anchors, before);
  for (const item of result.items) assert.deepEqual(item.anchor, { x: anchors.find(anchor => anchor.id === item.id)?.x, y: anchors.find(anchor => anchor.id === item.id)?.y });
  assert.deepEqual(allocateMapHierarchy(anchors.toReversed(), frame), result);
});

void test('every placed mark and caption avoids UI overlays, other identities and viewport clipping', () => {
  const blocked: ScreenBox[] = [{ left: 0, top: 0, width: 360, height: 100 }, { left: 0, top: 370, width: 360, height: 137 }];
  const result = allocateMapHierarchy([town('selected', 30, 125, true), town('nearby', 58, 135),
    { id: 'site', kind: 'site', label: 'Industrial zone', x: 140, y: 220, related: true },
    { id: 'edge', kind: 'resource', label: 'Iron', x: 358, y: 300, revealed: true }], { ...frame, blocked });
  const boxes = result.items.flatMap(item => [item.mark, item.label].filter((box): box is ScreenBox => box !== null));
  for (const [index, box] of boxes.entries()) {
    assert.ok(box.left >= 8 && box.top >= 8);
    assert.ok(box.left + box.width <= frame.width - 8 && box.top + box.height <= frame.height - 8);
    assert.ok(blocked.every(other => !overlaps(box, other)));
    assert.ok(boxes.slice(index + 1).every(other => !overlaps(box, other)));
  }
  assert.ok(result.items.find(item => item.id === 'selected')?.label);
});

void test('resources require canonical reveal and do not duplicate installed sites on the same tile', () => {
  const anchors: HierarchyAnchor[] = [{ id: 'mine', kind: 'site', label: 'Mine', x: 100, y: 150, tileId: 4, related: true },
    { id: 'iron', kind: 'resource', label: 'Iron', x: 100, y: 150, tileId: 4, revealed: true },
    { id: 'hidden', kind: 'resource', label: 'Horses', x: 250, y: 150, revealed: false },
    { id: 'known', kind: 'resource', label: 'Horses', x: 250, y: 300, revealed: true }];
  const result = allocateMapHierarchy(anchors, frame);
  assert.equal(result.items.find(item => item.id === 'hidden')?.mark, null);
  assert.equal(result.items.find(item => item.id === 'iron')?.mark, null);
  assert.ok(result.items.find(item => item.id === 'known')?.mark);
});

void test('zoom adds bounded detail with hysteresis while active targets remain at least44 CSS pixels', () => {
  const far = hierarchyScale(20, 360);
  const mid = hierarchyScale(36, 360, 'far');
  const close = hierarchyScale(60, 360, 'mid');
  assert.equal(hierarchyScale(25, 360, 'far').detail, 'far');
  assert.equal(hierarchyScale(45, 360, 'close').detail, 'close');
  assert.ok(far.resources < mid.resources && mid.resources < close.resources);
  assert.ok(far.labels <= mid.labels && mid.labels <= close.labels);
  const result = allocateMapHierarchy([town('town', 80, 150, true), { id: 'work', kind: 'site', label: 'Pasture', x: 220, y: 220, related: true }], frame);
  for (const item of result.items) if (item.mark) assert.ok(item.mark.width >= 44 && item.mark.height >= 44);
});

void test('selected long names are readable and bounded, while suppressed names remain available to native inspection', () => {
  const original = 'A very long frontier town with an exact retained identity';
  const result = allocateMapHierarchy([{ ...town('long', 180, 220, true), label: original }], frame);
  const item = result.items[0];
  assert.ok(item?.label);
  assert.equal(item.fullLabel, original);
  assert.ok(item.caption.endsWith('…'));
  assert.ok(item.fontSize >= 12);
  assert.ok(item.label.width <= frame.width - 16);
});

void test('invalid/offscreen anchors and impossible overlay space stay suppressed without fabricated relocation', () => {
  const result = allocateMapHierarchy([town('offscreen', -200, 120, true), town('invalid', Number.NaN, 120), town('covered', 180, 220)], { ...frame, blocked: [{ left: 0, top: 0, width: 360, height: 507 }] });
  assert.ok(result.items.every(item => item.mark === null && item.label === null));
  assert.ok(result.items.every(item => item.leader === null));
});

void test('an unfinished wonder remains a contender label even at full supplied work progress', () => {
  const result = allocateMapHierarchy([{ id: 'race', kind: 'wonder', label: 'Great library · Building', x: 120, y: 200, completed: false }], frame);
  assert.equal(result.items[0]?.fullLabel, 'Great library · Building');
  assert.equal(result.items[0]?.emphasis, 'normal');
});

void test('an explicit completed wonder keeps a name among many towns at overview scale', () => {
  const anchors: HierarchyAnchor[] = Array.from({ length: 8 }, (_, index) => town(`town-${index}`, 70 + index % 4 * 170, 130 + Math.floor(index / 4) * 210, index === 0));
  anchors.push({ id: 'winner', kind: 'wonder', label: 'Great library', x: 830, y: 180, completed: true });
  const result = allocateMapHierarchy(anchors, { width: 1188, height: 761, tileDiameter: 20 });
  assert.ok(result.items.find(item => item.id === 'winner')?.label);
  assert.ok(result.items.find(item => item.id === 'town-0')?.label);
});

void test('shortened names retain whole graphemes and the exact accessible name', () => {
  const label = '👨‍👩‍👧‍👦'.repeat(30);
  const item = allocateMapHierarchy([{ ...town('family', 180, 220, true), label }], frame).items[0];
  assert.equal(item?.caption, '👨‍👩‍👧‍👦'.repeat(24) + '…');
  assert.equal(item?.fullLabel, label);
});

void test('append-only projection recentering preserves an exact retained camera anchor without changing tile identities', () => {
  const before = [{ id: 4, x: 10, z: 4 }, { id: 9, x: 18, z: 10 }];
  const after = before.map(point => ({ ...point, x: point.x - Math.sqrt(3) * 3, z: point.z - 9 }));
  after.push({ id: 218, x: 30, z: 40 });
  const shift = retainedCoordinateShift(before, after);
  assert.ok(shift);
  const camera = { x: 5, z: 2 };
  const oldAnchor = before[0]; const newAnchor = after[0];
  assert.ok(oldAnchor && newAnchor);
  assert.equal(newAnchor.x - (camera.x + shift.x), oldAnchor.x - camera.x);
  assert.equal(newAnchor.z - (camera.z + shift.z), oldAnchor.z - camera.z);
  assert.deepEqual(before.map(point => point.id), [4, 9]);
  assert.equal(retainedCoordinateShift(before, [{ id: 4, x: 2, z: 3 }, { id: 9, x: 1, z: 5 }]), null);
  assert.equal(retainedCoordinateShift(before, [{ id: 99, x: 2, z: 3 }]), null);
});

void test('overview fitting uses the unobscured map window and actual extent rather than inventing land', () => {
  const viewport = { width: 400, height: 609 };
  const blocked = [{ left: 0, top: 0, width: 400, height: 80 }, { left: 0, top: 450, width: 400, height: 159 }];
  const window = mapContentWindow(viewport.width, viewport.height, blocked);
  assert.ok(window);
  assert.ok(blocked.every(box => !overlaps(window, box)));
  const points = [{ x: -15, z: -9 }, { x: 15, z: 9 }];
  const old = structuredClone(points);
  const camera = fitMapOverview(points, viewport, window);
  assert.ok(camera);
  const scale = viewport.height / (camera.halfHeight * 2);
  for (const point of points) {
    const x = (point.x - camera.x) * scale + viewport.width / 2;
    const y = (point.z - camera.z) * scale + viewport.height / 2;
    assert.ok(x >= window.left && x <= window.left + window.width);
    assert.ok(y >= window.top && y <= window.top + window.height);
  }
  assert.deepEqual(points, old);
  assert.equal(mapContentWindow(400, 609, [{ left: 0, top: 0, width: 400, height: 609 }]), null);
  assert.equal(fitMapOverview([], viewport, window), null);
});

void test('six nearby inhabited towns retain individual targets through bounded diagonal placements', () => {
  const points = [[99, 156], [81, 186], [231, 171], [143, 262], [301, 262], [187, 217]];
  const anchors = points.map(([x, y], index) => town(String(index), x ?? 0, y ?? 0, index === 0));
  const result = allocateMapHierarchy(anchors, { width: 400, height: 517, tileDiameter: 20 });
  assert.equal(result.items.filter(item => item.mark).length, 6);
  assert.ok(result.items.find(item => item.emphasis === 'selected')?.label);
});

void test('the actual360 Home-fit cluster retains all town targets and the selected name', () => {
  const points = [[73.53, 139.71], [207.60, 126.04], [128.74, 208.06], [270.69, 208.06], [168.17, 167.05], [89.31, 112.37]];
  const anchors = points.map(([x, y], index) => ({ ...town(String(index), x ?? 0, y ?? 0, index === 5), label: index === 5 ? 'Aster 2' : ['Dawnwell', 'Willowmere', 'Cinderhold', 'Tidehaven', 'Lumen'][index] ?? '' }));
  const result = allocateMapHierarchy(anchors, { width: 360, height: 415.33, tileDiameter: 18.23, blocked: [
    { left: 8, top: 5, width: 204, height: 53.08 }, { left: 218.67, top: 5, width: 133.34, height: 45.34 },
    { left: 10, top: 289.42, width: 340, height: 69.92 }, { left: 0, top: 363.33, width: 360, height: 52 },
  ] });
  assert.equal(result.items.filter(item => item.mark).length, 6);
  assert.ok(result.items.find(item => item.emphasis === 'selected')?.label);
});

void test('all targets are allocated before optional captions and attachment names do not displace another identity', () => {
  const anchors: HierarchyAnchor[] = [town('selected', 180, 180, true),
    { id: 'mine', kind: 'site', label: 'Mine', x: 180, y: 245, related: true },
    { id: 'campus', kind: 'site', label: 'Campus + Library + University + Observatory', shortLabel: 'Campus', x: 270, y: 210, related: true }];
  const current = { width: 440, height: 600, tileDiameter: 84 };
  const result = allocateMapHierarchy(anchors, current);
  const altered = allocateMapHierarchy(anchors.map(item => ({ ...item, label: item.label.repeat(8) })), current);
  assert.deepEqual(result.items.map(item => [item.id, item.mark]), altered.items.map(item => [item.id, item.mark]));
  assert.ok(result.items.every(item => item.mark));
  const campus = result.items.find(item => item.id === 'campus');
  assert.equal(campus?.caption, 'Campus'); assert.equal(campus.fullLabel, anchors[2]?.label);
});

void test('focused sites retain far-detail priority without changing immutable site anchors or IDs', () => {
  const anchors: HierarchyAnchor[] = [town('selected', 180, 200, true),
    { id: 'focused-site', kind: 'site', label: 'Mine', x: 180, y: 200, focused: true },
    { id: 'unrelated-site', kind: 'site', label: 'Pasture', x: 280, y: 300 }];
  const before = structuredClone(anchors);
  const result = allocateMapHierarchy(anchors, frame);
  assert.equal(result.items[0]?.id, 'focused-site'); assert.ok(result.items[0]?.mark);
  assert.equal(result.items.find(item => item.id === 'unrelated-site')?.fallbackReason, 'far-detail');
  assert.deepEqual(anchors, before);
});

void test('compact own-architecture overlap is explicit, bounded and never reported as exterior success', () => {
  const bounds = { left: 8, top: 8, width: 344, height: 491 };
  const result = allocateMapHierarchy([{ id: 'huge', kind: 'site', label: 'Huge', x: 180, y: 220, related: true, protectedBounds: bounds }],
    { ...frame, tileDiameter: 84 });
  const item = result.items[0]; assert.ok(item?.mark);
  assert.equal(item.placementMode, 'compact'); assert.equal(item.fallbackReason, 'exterior-blocked');
  assert.ok(overlaps(item.mark, bounds)); assert.equal(item.label, null);
  const hidden = allocateMapHierarchy([{ id: 'covered', kind: 'site', label: 'Covered', x: 180, y: 220, protectedBounds: bounds }],
    { ...frame, tileDiameter: 84, blocked: [{ left: 0, top: 0, width: 360, height: 507 }] }).items[0];
  assert.equal(hidden?.placementMode, 'omitted'); assert.equal(hidden.fallbackReason, 'no-safe-placement');
  assert.equal(hidden.mark, null); assert.equal(hidden.symbol, null); assert.equal(hidden.leader, null);
});

void test('every caption and unrelated target protects a site whose own mark is suppressed', () => {
  const site = { id: 'unrelated', kind: 'site' as const, label: 'Industrial zone', x: 180, y: 220,
    protectedBounds: { left: 145, top: 125, width: 70, height: 110 } };
  const result = allocateMapHierarchy([town('selected', 180, 260, true), site,
    { id: 'route', kind: 'route', label: 'Trade route', x: 260, y: 220, related: true }], frame);
  assert.equal(result.items.find(item => item.id === site.id)?.fallbackReason, 'far-detail');
  assert.ok(result.items.find(item => item.id === 'selected')?.mark);
  for (const box of result.occupied) assert.ok(!overlaps(box, site.protectedBounds));
});

void test('focus paint, measured caption padding and malformed bounds never leak past allocated rectangles', () => {
  const result = allocateMapHierarchy([{ id: 'site', kind: 'site', label: 'Mine', shortLabel: 'Mine', captionWidth: 103,
    focused: true, x: 180, y: 220, protectedBounds: { left: NaN, top: 1, width: 1, height: 1 } }], { ...frame, tileDiameter: 84 });
  const item = result.items[0]; assert.ok(item?.mark && item.symbol && item.label);
  assert.equal(item.fallbackReason, 'invalid-protected-bounds'); assert.equal(item.label.width, 115);
  assert.deepEqual(result.occupied[0], { left: item.mark.left - 3, top: item.mark.top - 3, width: 50, height: 50 });
  assert.ok(result.occupied.every(box => Object.values(box).every(Number.isFinite)));
  assert.equal(item.symbol.width, 20); assert.equal(item.mark.width, 44);
});

void test('site leaders stop at the badge edge and do not cross another architecture envelope or target', () => {
  const anchors: HierarchyAnchor[] = [
    { id: 'one', kind: 'site', label: 'Mine', x: 180, y: 230, protectedBounds: { left: 155, top: 195, width: 50, height: 50 } },
    { id: 'two', kind: 'site', label: 'Pasture', x: 265, y: 220, protectedBounds: { left: 240, top: 185, width: 50, height: 50 } },
  ];
  const result = allocateMapHierarchy(anchors, { width: 440, height: 600, tileDiameter: 84 });
  assert.ok(result.items.every(item => item.mark && item.leader));
  for (const item of result.items) {
    assert.ok(item.mark && item.leader);
    const to = item.leader.to;
    assert.ok(Math.abs(to.x - item.mark.left) < 1e-8 || Math.abs(to.x - item.mark.left - item.mark.width) < 1e-8
      || Math.abs(to.y - item.mark.top) < 1e-8 || Math.abs(to.y - item.mark.top - item.mark.height) < 1e-8);
    for (let t = 0; t <= 1; t += .02) {
      const point = { left: item.leader.from.x + (to.x - item.leader.from.x) * t, top: item.leader.from.y + (to.y - item.leader.from.y) * t, width: .01, height: .01 };
      for (const other of anchors) if (other.id !== item.id && other.protectedBounds) assert.ok(!overlaps(point, other.protectedBounds));
      for (const other of result.items) if (other.id !== item.id && other.mark) assert.ok(!overlaps(point, other.mark));
    }
  }
});
