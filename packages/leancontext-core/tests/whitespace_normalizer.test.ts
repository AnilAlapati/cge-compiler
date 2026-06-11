import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { WhitespaceNormalizer } from '../src/whitespace_normalizer.js';

describe('WhitespaceNormalizer', () => {
  const normalizer = new WhitespaceNormalizer();

  test('collapses 3+ consecutive newlines into 2', () => {
    const input = `line1\n\n\n\nline2`;
    const result = normalizer.normalize(input);
    assert.ok(!result.includes('\n\n\n'), `Got 3+ newlines: ${JSON.stringify(result)}`);
    assert.ok(result.includes('line1'));
    assert.ok(result.includes('line2'));
  });

  test('strips trailing whitespace from lines', () => {
    const input = `line1   \nline2  \nline3`;
    const result = normalizer.normalize(input);
    const lines = result.split('\n');
    for (const line of lines) {
      assert.ok(!/[ \t]+$/.test(line), `Trailing whitespace found on: "${line}"`);
    }
  });

  test('output always ends with a newline', () => {
    const input = `hello world`;
    const result = normalizer.normalize(input);
    assert.ok(result.endsWith('\n'));
  });

  test('does not collapse 2 consecutive newlines (1 blank line is preserved)', () => {
    const input = `line1\n\nline2`;
    const result = normalizer.normalize(input);
    assert.ok(result.includes('line1\n\nline2'));
  });

  test('handles empty string', () => {
    const result = normalizer.normalize('');
    assert.equal(result, '\n');
  });
});
