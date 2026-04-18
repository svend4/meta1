import { describe, it, expect } from 'vitest';
import { buildDependencyGraph } from '../../src/core/executor.js';
import type { Step } from '../../src/types/execution-plan.js';

function makeStep(id: string, deps?: string[]): Step {
  return {
    step_id: id,
    type: 'create_file',
    description: `Step ${id}`,
    path: `/tmp/${id}.txt`,
    content: id,
    determinism: 'guaranteed',
    depends_on: deps,
  };
}

describe('cycle detection', () => {
  it('accepts a valid DAG', () => {
    const steps: Step[] = [
      makeStep('a'),
      makeStep('b', ['a']),
      makeStep('c', ['a']),
      makeStep('d', ['b', 'c']),
    ];
    const { dependents, inDegree } = buildDependencyGraph(steps);
    expect(inDegree.get('a')).toBe(0);
    expect(inDegree.get('d')).toBe(2);
    expect(dependents.get('a')).toContain('b');
    expect(dependents.get('a')).toContain('c');
  });

  it('detects simple A→B→A cycle with step names in error', () => {
    const steps: Step[] = [
      makeStep('alpha', ['beta']),
      makeStep('beta', ['alpha']),
    ];
    expect(() => buildDependencyGraph(steps)).toThrow(/Dependency cycle detected/);
    expect(() => buildDependencyGraph(steps)).toThrow(/alpha/);
    expect(() => buildDependencyGraph(steps)).toThrow(/beta/);
  });

  it('detects 3-step cycle A→B→C→A with step names', () => {
    const steps: Step[] = [
      makeStep('x', ['z']),
      makeStep('y', ['x']),
      makeStep('z', ['y']),
    ];
    expect(() => buildDependencyGraph(steps)).toThrow(/Dependency cycle detected/);
    expect(() => buildDependencyGraph(steps)).toThrow(/x/);
    expect(() => buildDependencyGraph(steps)).toThrow(/y/);
    expect(() => buildDependencyGraph(steps)).toThrow(/z/);
  });

  it('detects cycle in sub-graph while other steps are valid', () => {
    const steps: Step[] = [
      makeStep('valid-root'),
      makeStep('valid-leaf', ['valid-root']),
      makeStep('cycle-a', ['cycle-b']),
      makeStep('cycle-b', ['cycle-a']),
    ];
    expect(() => buildDependencyGraph(steps)).toThrow(/Dependency cycle detected/);
    expect(() => buildDependencyGraph(steps)).toThrow(/cycle-a/);
    expect(() => buildDependencyGraph(steps)).toThrow(/cycle-b/);
  });

  it('produces arrow chain in error message', () => {
    const steps: Step[] = [
      makeStep('a', ['c']),
      makeStep('b', ['a']),
      makeStep('c', ['b']),
    ];
    try {
      buildDependencyGraph(steps);
      expect.fail('Expected error');
    } catch (err: unknown) {
      const msg = (err as Error).message;
      expect(msg).toContain('→');
      // The cycle trace should form a closed loop
      const arrowPart = msg.split(':')[1].split('.')[0].trim();
      const parts = arrowPart.split(' → ');
      expect(parts[0]).toBe(parts[parts.length - 1]);
    }
  });

  it('rejects self-dependency', () => {
    const steps: Step[] = [makeStep('self', ['self'])];
    expect(() => buildDependencyGraph(steps)).toThrow(/cannot depend on itself/);
  });

  it('rejects unknown dependency', () => {
    const steps: Step[] = [makeStep('a', ['nonexistent'])];
    expect(() => buildDependencyGraph(steps)).toThrow(/unknown step/);
  });
});
