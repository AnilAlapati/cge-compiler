import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DeadCodeDetector } from '../src/dead_code_detector.js';

describe('DeadCodeDetector', () => {
  const detector = new DeadCodeDetector();

  test('removes commented-out variable assignments', () => {
    const input = `const x = 1;\n// const oldValue = "deprecated";\nconst z = 3;`;
    const result = detector.process(input);
    assert.ok(!result.includes('oldValue'));
    assert.ok(result.includes('const x = 1;'));
    assert.ok(result.includes('const z = 3;'));
  });

  test('removes commented-out if statements', () => {
    const input = `doSomething();\n// if (condition) { doOther(); }\ndoNext();`;
    const result = detector.process(input);
    assert.ok(!result.includes('if (condition)'));
    assert.ok(result.includes('doSomething()'));
    assert.ok(result.includes('doNext()'));
  });

  test('REGRESSION: does NOT delete prose comments starting with return', () => {
    // Bug from Claude_review_v1.md §2.3 — fixed
    const input = `// return the user to the login page on failure\nfunction login() {}`;
    const result = detector.process(input);
    assert.ok(result.includes('return the user to the login page on failure'), `Prose comment was deleted. Got: ${result}`);
  });

  test('REGRESSION: does NOT delete prose comments starting with if', () => {
    // Bug from Claude_review_v1.md §2.3 — fixed
    const input = `// if the cache is cold we warm it lazily\nfunction warm() {}`;
    const result = detector.process(input);
    assert.ok(result.includes('if the cache is cold we warm it lazily'), `Prose comment was deleted. Got: ${result}`);
  });

  test('preserves normal explanatory comments', () => {
    const input = `// This function handles authentication\nfunction auth() {}`;
    const result = detector.process(input);
    assert.ok(result.includes('This function handles authentication'));
  });

  test('does nothing when stripDeadCode=false', () => {
    const detector2 = new DeadCodeDetector({ stripDeadCode: false });
    const input = `// const x = 1;\nconst y = 2;`;
    const result = detector2.process(input);
    assert.ok(result.includes('const x = 1;'));
  });

  test('removes commented-out class definitions', () => {
    const input = `// class OldService extends BaseService {\nconst x = 1;`;
    const result = detector.process(input);
    assert.ok(!result.includes('OldService'));
  });

  test('removes commented-out import statements', () => {
    const input = `// import { foo } from 'bar';\nconst x = 1;`;
    const result = detector.process(input);
    assert.ok(!result.includes("import { foo }"));
  });
});
