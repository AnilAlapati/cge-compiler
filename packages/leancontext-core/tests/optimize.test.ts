import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LeanContextEngine } from '../src/leancontext_engine.js';

describe('LeanContextEngine.optimize() — end-to-end', () => {
  const engine = new LeanContextEngine();

  test('reduces token count for TypeScript file with heavy comments', () => {
    const input = [
      '// This module handles all user authentication flows',
      '// It was written in Q2 2023',
      '// TODO: refactor to use new auth library',
      'export class AuthService {',
      '  // checks if user is valid',
      '  // the old version was removed in commit abc123',
      '  isValid(user: User): boolean {',
      '    /* old implementation:',
      '       return user.active && user.verified;',
      '    */',
      '    return user.active;',
      '  }',
      '}',
    ].join('\n');

    const result = engine.optimize(input, 'typescript');

    // Metrics assertion — core value proposition
    assert.ok(result.optimizedTokens < result.originalTokens,
      `Expected fewer tokens after optimization. Before: ${result.originalTokens}, After: ${result.optimizedTokens}`);
    assert.ok(result.savings.percentSaved > 0,
      `Expected positive savings. Got: ${result.savings.percentSaved}%`);

    // Content assertions
    assert.ok(result.output.includes('AuthService'));
    assert.ok(result.output.includes('return user.active;'));
    assert.ok(result.output.includes('TODO')); // TODOs preserved
  });

  test('Python optimization preserves structure and reduces tokens', () => {
    const input = [
      '# Module: user management',
      '# Author: dev team',
      'def get_user(user_id):',
      '    """Fetches user from database."""',
      '    # query the db',
      '    return db.find(user_id)',
      '',
      'def delete_user(user_id):',
      '    """Deletes a user permanently."""',
      '    # permanent delete, no recovery',
      '    db.delete(user_id)',
    ].join('\n');

    const result = engine.optimize(input, 'python');

    assert.ok(result.optimizedTokens < result.originalTokens,
      `Expected fewer tokens. Before: ${result.originalTokens}, After: ${result.optimizedTokens}`);
    assert.ok(result.output.includes('def get_user'));
    assert.ok(result.output.includes('def delete_user'));
    // Docstrings should be preserved (stripDocComments=false is default)
    assert.ok(result.output.includes('Fetches user from database'));
  });

  test('result object has all required fields', () => {
    const result = engine.optimize('const x = 1;', 'typescript');
    assert.ok(typeof result.output === 'string');
    assert.ok(typeof result.originalTokens === 'number');
    assert.ok(typeof result.optimizedTokens === 'number');
    assert.ok(typeof result.savings.totalTokensSaved === 'number');
    assert.ok(typeof result.savings.percentSaved === 'number');
  });

  test('token savings are mathematically consistent', () => {
    const input = `// lots of comments\n// more comments\nconst x = 1;`;
    const result = engine.optimize(input, 'typescript');
    assert.equal(
      result.savings.totalTokensSaved,
      result.originalTokens - result.optimizedTokens,
      'Token savings calculation is inconsistent'
    );
  });

  test('handles empty input gracefully', () => {
    const result = engine.optimize('', 'typescript');
    assert.ok(typeof result.output === 'string');
    assert.equal(result.originalTokens, 0);
  });
});
