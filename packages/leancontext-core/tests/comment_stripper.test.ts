import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CommentStripper } from '../src/comment_stripper.js';

describe('CommentStripper — TypeScript/JavaScript', () => {
  const stripper = new CommentStripper();

  test('strips single-line comments', () => {
    const input = `const x = 1; // this is a comment\nconst y = 2;`;
    const result = stripper.strip(input, 'typescript');
    assert.ok(!result.includes('// this is a comment'));
    assert.ok(result.includes('const x = 1;'));
    assert.ok(result.includes('const y = 2;'));
  });

  test('strips block comments', () => {
    const input = `/* block comment */\nconst x = 1;`;
    const result = stripper.strip(input, 'typescript');
    assert.ok(!result.includes('block comment'));
    assert.ok(result.includes('const x = 1;'));
  });

  test('preserves TODO comments by default', () => {
    const input = `// TODO: fix this later\nconst x = 1;`;
    const result = stripper.strip(input, 'typescript');
    assert.ok(result.includes('TODO'));
  });

  test('preserves JSDoc comments (stripDocComments=false by default)', () => {
    const input = `/** @param x the value */\nfunction foo(x) {}`;
    const result = stripper.strip(input, 'typescript');
    assert.ok(result.includes('@param'));
  });

  test('does NOT truncate URLs inside strings', () => {
    const input = `const url = "https://example.com/path";`;
    const result = stripper.strip(input, 'typescript');
    assert.ok(result.includes('https://example.com/path'));
  });

  test('does NOT truncate URLs inside template literals', () => {
    const input = 'const url = `Visit https://example.com/path for more`;';
    const result = stripper.strip(input, 'typescript');
    assert.ok(result.includes('https://example.com/path'));
  });

  test('handles inline comment after code on same line', () => {
    const input = `return value; // return the result`;
    const result = stripper.strip(input, 'javascript');
    assert.ok(result.includes('return value;'));
    assert.ok(!result.includes('return the result'));
  });
});

describe('CommentStripper — Python', () => {
  const stripper = new CommentStripper();

  test('strips # line comments', () => {
    const input = `x = 1 # this is a comment\ny = 2`;
    const result = stripper.strip(input, 'python');
    assert.ok(!result.includes('this is a comment'));
    assert.ok(result.includes('x = 1'));
  });

  test('preserves docstrings when stripDocComments=false (default)', () => {
    const input = `def foo():\n    """This is a docstring"""\n    return 42`;
    const result = stripper.strip(input, 'python');
    assert.ok(result.includes('"""This is a docstring"""'));
  });

  test('REGRESSION: python docstring must not produce 6-quote corruption', () => {
    // Bug from Claude_review_v1.md §2.1 — fixed
    const input = `def f():\n    """This is a docstring."""\n    return 42`;
    const result = stripper.strip(input, 'python');
    // Should NOT contain 6 consecutive quotes
    assert.ok(!result.includes('""""""'), 'Got 6-quote corruption');
    assert.ok(result.includes('"""This is a docstring."""'));
  });

  test('strips docstrings when stripDocComments=true', () => {
    const stripper2 = new CommentStripper({ stripDocComments: true });
    const input = `def foo():\n    """This gets removed"""\n    return 42`;
    const result = stripper2.strip(input, 'python');
    assert.ok(!result.includes('This gets removed'));
    assert.ok(result.includes('return 42'));
  });

  test('preserves string content that looks like a comment', () => {
    const input = `url = "http://example.com/api"`;
    const result = stripper.strip(input, 'python');
    assert.ok(result.includes('http://example.com/api'));
  });
});

describe('CommentStripper — CSS', () => {
  const stripper = new CommentStripper();

  test('strips CSS block comments', () => {
    const input = `/* base styles */\nbody { margin: 0; }`;
    const result = stripper.strip(input, 'css');
    assert.ok(!result.includes('base styles'));
    assert.ok(result.includes('body { margin: 0; }'));
  });

  test('REGRESSION: does NOT truncate url() at //', () => {
    // Bug from Claude_review_v1.md §2.2 — fixed
    const input = `a { background: url(http://cdn.example.com/img.png); }`;
    const result = stripper.strip(input, 'css');
    assert.ok(result.includes('http://cdn.example.com/img.png'), `URL was truncated. Got: ${result}`);
  });
});

describe('CommentStripper — Markdown/HTML/JSON pass-through', () => {
  const stripper = new CommentStripper();

  test('REGRESSION: Markdown URLs are NOT truncated at //', () => {
    // Bug from Claude_review_v1.md §2.2 — fixed
    const input = `See https://example.com/docs for info`;
    const result = stripper.strip(input, 'markdown');
    assert.ok(result.includes('https://example.com/docs'), `URL was truncated. Got: ${result}`);
  });

  test('HTML passes through unchanged', () => {
    const input = `<div><!-- comment --><p>Hello https://x.com</p></div>`;
    const result = stripper.strip(input, 'html');
    assert.equal(result, input);
  });

  test('JSON passes through unchanged', () => {
    const input = `{"key": "https://api.example.com/v1"}`;
    const result = stripper.strip(input, 'json');
    assert.equal(result, input);
  });
});
