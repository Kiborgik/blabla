import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BEHAVIOR_PROFILES } from '../core/behavior-profiles.ts';
import { STRATEGIC_ARCHETYPES, STRATEGIC_TEMPERAMENT_VERSION } from '../core/strategic-temperaments.ts';
import { renderRecordedPolicyChoice } from '../web/spectator-hud.ts';

class ElementRecord {
  tag: string;
  textContent = '';
  className = '';
  dataset: Record<string, string> = {};
  children: ElementRecord[] = [];
  constructor(tag: string) { this.tag = tag; }
  set innerHTML(_value: string) { throw new Error('Recorded policy text must remain inert'); }
  append(...children: ElementRecord[]): void { this.children.push(...children); }
}

function rendered(profileId?: string, phase?: string): ElementRecord {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: (tag: string) => new ElementRecord(tag) } });
  try {
    const choice = { action: { type: 'wait' as const }, reason: '<b>Original recorded reason</b>', ...(profileId === undefined ? {} : { profileId }), ...(phase === undefined ? {} : { phase }) };
    const before = structuredClone(choice);
    const result = renderRecordedPolicyChoice(choice) as unknown as ElementRecord;
    assert.deepEqual(choice, before);
    assert.equal(result.tag, 'details');
    assert.equal(result.dataset['townDisclosure'], 'policy-choice');
    assert.equal(result.children[0]?.textContent, 'Last choice: Wait');
    assert.equal(result.children[2]?.textContent, choice.reason);
    return result;
  } finally {
    if (original) Object.defineProperty(globalThis, 'document', original);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}

void test('recorded v4 identities show exact registered archetype posture and historical phase without seed reconstruction', () => {
  for (const archetype of STRATEGIC_ARCHETYPES) for (const posture of ['compact', 'measured', 'outward']) {
    for (const phase of ['survival', 'recovery', 'development', 'expansion', 'trade', 'consolidation']) {
      const result = rendered(`${STRATEGIC_TEMPERAMENT_VERSION}/${archetype}/${posture}`, phase);
      assert.equal(result.children[3]?.textContent, `Recorded strategy: ${archetype[0]!.toUpperCase()}${archetype.slice(1)} · ${posture[0]!.toUpperCase()}${posture.slice(1)}`);
      assert.equal(result.children[4]?.textContent, `Recorded phase: ${phase[0]!.toUpperCase()}${phase.slice(1)}`);
      assert.doesNotMatch(result.children.map(child => child.textContent).join(' '), /currently|will always|guaranteed/);
    }
  }
});

void test('old registered profiles keep their recorded names and metadata-free records keep the original disclosure', () => {
  for (const profile of BEHAVIOR_PROFILES) {
    const result = rendered(profile.id, 'development');
    assert.equal(result.children[3]?.textContent, `Recorded strategy: ${profile.name}`);
    assert.equal(result.children[4]?.textContent, 'Recorded phase: Development');
  }
  assert.equal(rendered().children.length, 3);
});

void test('unknown or malformed recorded metadata is omitted without affecting original action or reason', () => {
  for (const profile of ['future-profile', 'strategic-temperaments-v2/scholars/compact', 'strategic-temperaments-v1/unknown/compact', 'strategic-temperaments-v1/scholars/unknown', 'strategic-temperaments-v1/scholars/compact/extra', '<img src=x>', 'strategic-temperaments-v1/scholars/compact\n']) {
    assert.equal(rendered(profile, 'development').children.length, 3);
  }
  for (const phase of [undefined, 'future-phase', 'development\n', '<b>trade</b>']) {
    const result = rendered('strategic-temperaments-v1/traders/outward', phase);
    assert.equal(result.children.length, 4);
    assert.equal(result.children[3]?.textContent, 'Recorded strategy: Traders · Outward');
  }
});
