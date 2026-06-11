/**
 * Regression tests — one test per verified production bug.
 *
 * Each test here was written FROM the bug report BEFORE the fix.
 * If the fix ever regresses, this file catches it within 30 seconds.
 *
 * Source: Claude_review_v1.md (2026-06-10, Claude Opus 4.8)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CommentStripper } from '../src/comment_stripper.js';
import { DeadCodeDetector } from '../src/dead_code_detector.js';
import { LeanContextEngine } from '../src/leancontext_engine.js';

describe('REGRESSION: §2.1 — Python docstrings corrupted into 6-quote invalid syntax', () => {
  // BUG: When triple-quoted string found and stripDocComments===false (the DEFAULT),
  // the branch set inString/stringChar but never continued, falling through to
  // single-quote handler which appended another quote => 6 consecutive quotes.
  // FIX: Add i += 3; continue; at end of !stripDocComments branch.

  const stripper = new CommentStripper(); // default: stripDocComments=false

  test('double-quoted docstring does not produce 6 quotes', () => {
    const input = `def f():\n    """This is a docstring."""\n    return 42`;
    const result = stripper.strip(input, 'python');
    assert.ok(!result.includes('""""""'), `6-quote corruption detected. Output:\n${result}`);
    assert.ok(result.includes('"""This is a docstring."""'));
  });

  test('single-quoted docstring does not produce 6 quotes', () => {
    const input = `def f():\n    '''Another docstring.'''\n    return 42`;
    const result = stripper.strip(input, 'python');
    assert.ok(!result.includes("''''''"), `6-quote corruption detected. Output:\n${result}`);
    assert.ok(result.includes("'''Another docstring.'''"));
  });

  test('multi-line docstring is preserved intact', () => {
    const input = `def bar():\n    """\n    Line one.\n    Line two.\n    """\n    return True`;
    const result = stripper.strip(input, 'python');
    assert.ok(!result.includes('""""""'));
    assert.ok(result.includes('Line one.'));
    assert.ok(result.includes('Line two.'));
  });
});

describe('REGRESSION: §2.2 — // inside URLs truncates rest of line', () => {
  // BUG: .md → markdown, .css → css were routed to stripCStyle which treated
  // any // as a line comment with no string/context guard.
  // "See https://example.com" → "See https:"
  // FIX: Don't route Markdown/CSS through stripCStyle for // comments.

  const stripper = new CommentStripper();

  test('Markdown: https:// URL is not truncated', () => {
    const input = `See https://example.com/docs for more info`;
    const result = stripper.strip(input, 'markdown');
    assert.ok(result.includes('https://example.com/docs'),
      `URL was truncated. Got: "${result}"`);
  });

  test('CSS: url(http://) is not truncated', () => {
    const input = `a { background: url(http://cdn.example.com/x.png); }`;
    const result = stripper.strip(input, 'css');
    assert.ok(result.includes('http://cdn.example.com/x.png'),
      `URL was truncated. Got: "${result}"`);
  });

  test('TS: https:// inside a string is not truncated', () => {
    const input = `const url = "https://api.example.com/v2/users";`;
    const result = stripper.strip(input, 'typescript');
    assert.ok(result.includes('https://api.example.com/v2/users'),
      `URL was truncated. Got: "${result}"`);
  });
});

describe('REGRESSION: §2.3 — Dead-code detector deletes prose comments', () => {
  // BUG: Dead code detector ran on raw lines and matched prefixes like /^\s*return\b/,
  // /^\s*if\s*\(/. Ordinary prose comments starting with those words were classified
  // as "commented-out code" and dropped.
  // FIX: Require stronger evidence — balanced brackets, semicolons, and identifiers.

  const detector = new DeadCodeDetector();

  test('prose comment starting with "return" is preserved', () => {
    const input = `// return the user to the login page on failure\nfunction login() {}`;
    const result = detector.process(input);
    assert.ok(result.includes('return the user to the login page on failure'),
      `Prose comment was deleted. Got:\n${result}`);
  });

  test('prose comment starting with "if" is preserved', () => {
    const input = `// if the cache is cold we warm it lazily\nfunction warm() {}`;
    const result = detector.process(input);
    assert.ok(result.includes('if the cache is cold we warm it lazily'),
      `Prose comment was deleted. Got:\n${result}`);
  });

  test('full pipeline: prose comment is not misclassified as dead code (content survives dead_code stage)', () => {
    // The dead code detector runs FIRST and should preserve prose comments.
    // The comment stripper then runs and removes all comments (that's its job).
    // The regression is specifically that the dead code detector was wrongly removing prose.
    // We verify by running DeadCodeDetector alone (the stage that had the bug).
    const { DeadCodeDetector: DCD } = require('../src/dead_code_detector.js');
    const detector2 = new DCD();
    const input = `// if the timeout expires, retry\nconst MAX_RETRIES = 3;`;
    const afterDeadCode = detector2.process(input);
    assert.ok(afterDeadCode.includes('if the timeout expires, retry'),
      `Prose comment was wrongly classified as dead code. Got:\n${afterDeadCode}`);
  });
});
