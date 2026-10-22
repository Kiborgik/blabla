import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { cameraShiftForAnchor, unobscuredInspectionAnchor } from '../web/inspection-camera.ts';
import type { ScreenBox } from '../visuals/map-hierarchy.ts';

const desktop = { width: 1180, height: 756 };
const overlays: ScreenBox[] = [
  { left: 0, top: 0, width: 1180, height: 52 },
  { left: 0, top: 732, width: 1180, height: 24 },
  { left: 180, top: 64, width: 820, height: 62 },
  { left: 18, top: 441, width: 332, height: 255 },
  { left: 842, top: 144, width: 320, height: 546 },
];

void test('inspection keeps an already unobscured city instead of dragging land to the largest empty rectangle', () => {
  const current = { x: 337 / desktop.width, y: 250 / desktop.height };
  const before = structuredClone(overlays);
  assert.strictEqual(unobscuredInspectionAnchor(current, { x: 594 / 1180, y: 420 / 756 }, desktop, overlays), current);
  assert.deepEqual(overlays, before);
});

void test('inspection pans an obscured desktop city only to the nearest clear edge with label room', () => {
  const target = unobscuredInspectionAnchor({ x: 1020 / 1180, y: 420 / 756 }, { x: .5, y: .5 }, desktop, overlays);
  assert.equal(target.x * desktop.width, 792);
  assert.equal(target.y * desktop.height, 420);
  assert.strictEqual(unobscuredInspectionAnchor(target, { x: .5, y: .5 }, desktop, overlays), target);
});

void test('narrow inspection clears the real bottom sheet, heading, controls and civilization dock', () => {
  const viewport = { width: 390, height: 844 };
  const blocked = [
    { left: 0, top: 0, width: 390, height: 44 },
    { left: 10, top: 55, width: 180, height: 81 },
    { left: 238, top: 55, width: 142, height: 44 },
    { left: 10, top: 350, width: 370, height: 376 },
    { left: 0, top: 736, width: 390, height: 108 },
  ];
  const target = unobscuredInspectionAnchor({ x: .5, y: 600 / 844 }, { x: .4, y: .25 }, viewport, blocked);
  assert.equal(target.x, .5);
  assert.equal(target.y * viewport.height, 300);
  for (const box of blocked) assert.ok(target.x * viewport.width + 48 <= box.left || target.x * viewport.width - 48 >= box.left + box.width
    || target.y * viewport.height + 48 <= box.top || target.y * viewport.height - 48 >= box.top + box.height);
});

void test('offscreen cities move inside the viewport without hidden or outside overlays causing a false pan', () => {
  const current = { x: -.5, y: 1.2 };
  const target = unobscuredInspectionAnchor(current, { x: .5, y: .5 }, desktop, [
    { left: 0, top: 0, width: 0, height: 1000 },
    { left: -1000, top: 0, width: 100, height: 1000 },
    { left: NaN, top: 0, width: 100, height: 1000 },
  ]);
  assert.deepEqual(target, { x: 48 / 1180, y: 708 / 756 });
});

void test('an unavailable viewport or fully blocked map does not invent a safe framing location', () => {
  const current = { x: .7, y: .6 };
  assert.strictEqual(unobscuredInspectionAnchor(current, { x: .5, y: .5 }, { width: 0, height: 700 }, []), current);
  assert.strictEqual(unobscuredInspectionAnchor(current, { x: .5, y: .5 }, desktop, [{ left: 0, top: 0, ...desktop }]), current);
});

void test('minimal framing retains exact oblique SVG and tilted Three projection at multiple zoom levels', () => {
  for (const viewport of [desktop, { width: 390, height: 844 }]) for (const zoom of [.65, 1, 2.2]) {
    const blocked = [{ left: viewport.width / 2, top: 0, width: viewport.width / 2, height: viewport.height }];
    const current = { x: .8, y: .6 };
    const target = unobscuredInspectionAnchor(current, { x: .25, y: .5 }, viewport, blocked);
    const worldHeight = 32 / zoom;
    const worldWidth = worldHeight * viewport.width / viewport.height;
    const flat = cameraShiftForAnchor(current, target, { x: 1 / worldWidth, y: 0 }, { x: 0, y: .72 / worldHeight });
    assert.ok(Math.abs(current.x - flat.x / worldWidth - target.x) < 1e-9);
    assert.ok(Math.abs(current.y - flat.z * .72 / worldHeight - target.y) < 1e-9);
    const aspect = viewport.width / viewport.height;
    const camera = new THREE.OrthographicCamera(-24 * aspect, 24 * aspect, 24, -24, .1, 160);
    camera.position.set(19, 29, 31); camera.zoom = zoom; camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    const point = new THREE.Vector3(8, 2, 6);
    const screen = (value: THREE.Vector3): { x: number; y: number } => { const projected = value.clone().project(camera); return { x: (projected.x + 1) / 2, y: (1 - projected.y) / 2 }; };
    const start = screen(point);
    const safe = unobscuredInspectionAnchor(start, { x: .25, y: .5 }, viewport, blocked);
    const unitX = screen(point.clone().add(new THREE.Vector3(1, 0, 0)));
    const unitZ = screen(point.clone().add(new THREE.Vector3(0, 0, 1)));
    const shift = cameraShiftForAnchor(start, safe, { x: unitX.x - start.x, y: unitX.y - start.y }, { x: unitZ.x - start.x, y: unitZ.y - start.y });
    camera.position.add(new THREE.Vector3(shift.x, 0, shift.z)); camera.updateMatrixWorld();
    assert.ok(Math.abs(screen(point).x - safe.x) < 1e-9);
    assert.ok(Math.abs(screen(point).y - safe.y) < 1e-9);
    assert.equal(camera.zoom, zoom);
  }
});
