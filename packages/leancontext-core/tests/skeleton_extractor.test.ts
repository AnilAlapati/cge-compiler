import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SkeletonExtractor } from '../src/skeleton_extractor.js';

const extractor = new SkeletonExtractor();

describe('SkeletonExtractor — basic function body stripping', () => {

  test('strips a simple function body', () => {
    const input = [
      'function greet(name: string): string {',
      '  const msg = `Hello, ${name}!`;',
      '  return msg;',
      '}',
    ].join('\n');
    const result = extractor.extract(input, 'typescript');
    assert.ok(result.includes('function greet(name: string): string'), 'signature missing');
    assert.ok(!result.includes('const msg'), 'body was not stripped');
    assert.ok(!result.includes('return msg'), 'body was not stripped');
  });

  test('strips an async method body in a class', () => {
    const input = [
      'export class UserService {',
      '  async createUser(dto: CreateUserDto): Promise<User> {',
      '    const existing = await this.db.find(dto.email);',
      '    if (existing) throw new Error();',
      '    return this.db.save(dto);',
      '  }',
      '}',
    ].join('\n');
    const result = extractor.extract(input, 'typescript');
    assert.ok(result.includes('class UserService'), 'class declaration missing');
    assert.ok(result.includes('async createUser(dto: CreateUserDto): Promise<User>'), 'signature missing');
    assert.ok(!result.includes('const existing'), 'body was not stripped');
    assert.ok(!result.includes('throw new Error'), 'body was not stripped');
  });

  test('preserves multiple method signatures in a class', () => {
    const input = [
      'export class AuthService {',
      '  login(credentials: LoginDto): Promise<Token> {',
      '    return this.auth.signIn(credentials);',
      '  }',
      '  logout(userId: string): void {',
      '    this.sessions.delete(userId);',
      '  }',
      '}',
    ].join('\n');
    const result = extractor.extract(input, 'typescript');
    assert.ok(result.includes('login(credentials: LoginDto): Promise<Token>'), 'login signature missing');
    assert.ok(result.includes('logout(userId: string): void'), 'logout signature missing');
    assert.ok(!result.includes('this.auth.signIn'), 'login body not stripped');
    assert.ok(!result.includes('this.sessions.delete'), 'logout body not stripped');
  });

  test('preserves all import statements verbatim', () => {
    const input = [
      "import { Injectable } from '@nestjs/common';",
      "import type { User } from './types';",
      'function foo() { return 1; }',
    ].join('\n');
    const result = extractor.extract(input, 'typescript');
    assert.ok(result.includes("import { Injectable } from '@nestjs/common'"), 'import missing');
    assert.ok(result.includes("import type { User } from './types'"), 'type import missing');
  });

  test('preserves interface declarations fully (no body to strip)', () => {
    const input = [
      'export interface UserDto {',
      '  id: string;',
      '  email: string;',
      '  createdAt: Date;',
      '}',
    ].join('\n');
    const result = extractor.extract(input, 'typescript');
    // Interface body should be preserved — it's not a function body
    assert.ok(result.includes('id: string'), 'interface field missing');
    assert.ok(result.includes('email: string'), 'interface field missing');
    assert.ok(result.includes('createdAt: Date'), 'interface field missing');
  });

  test('preserves type aliases', () => {
    const input = `export type UserId = string;\nexport type Status = 'active' | 'inactive';`;
    const result = extractor.extract(input, 'typescript');
    assert.ok(result.includes('export type UserId = string'), 'type alias missing');
    assert.ok(result.includes("export type Status = 'active' | 'inactive'"), 'union type missing');
  });

  test('preserves decorators', () => {
    const input = [
      '@Injectable()',
      'export class FooService {',
      '  @Get("/path")',
      '  getPath(): string {',
      '    return "/path";',
      '  }',
      '}',
    ].join('\n');
    const result = extractor.extract(input, 'typescript');
    assert.ok(result.includes('@Injectable()'), 'class decorator missing');
    assert.ok(result.includes('@Get("/path")'), 'method decorator missing');
    assert.ok(!result.includes('return "/path"'), 'body was not stripped');
  });

  test('strips nested function bodies correctly', () => {
    const input = [
      'class Foo {',
      '  outer(): void {',
      '    function inner() {',
      '      return 42;',
      '    }',
      '    inner();',
      '  }',
      '}',
    ].join('\n');
    const result = extractor.extract(input, 'typescript');
    assert.ok(result.includes('outer(): void'), 'outer signature missing');
    assert.ok(!result.includes('return 42'), 'inner body not stripped');
    assert.ok(!result.includes('inner()'), 'outer body content not stripped');
  });
});

describe('SkeletonExtractor — token reduction', () => {
  test('skeleton output has fewer tokens than original', () => {
    const { LeanContextEngine } = require('../src/leancontext_engine.js');
    const minifyEngine = new LeanContextEngine({ mode: 'minify' });
    const skeletonEngine = new LeanContextEngine({ mode: 'skeleton' });

    const input = [
      "import { Injectable } from '@nestjs/common';",
      'export class UserService {',
      '  async findAll(): Promise<User[]> {',
      '    const users = await this.db.query("SELECT * FROM users");',
      '    return users.map(u => new User(u));',
      '  }',
      '  async findById(id: string): Promise<User | null> {',
      '    const row = await this.db.queryOne("SELECT * FROM users WHERE id = ?", [id]);',
      '    if (!row) return null;',
      '    return new User(row);',
      '  }',
      '  async delete(id: string): Promise<void> {',
      '    await this.db.execute("DELETE FROM users WHERE id = ?", [id]);',
      '  }',
      '}',
    ].join('\n');

    const minifyResult = minifyEngine.optimize(input, 'typescript');
    const skeletonResult = skeletonEngine.optimize(input, 'typescript');

    assert.ok(skeletonResult.optimizedTokens < minifyResult.originalTokens,
      `Skeleton should use fewer tokens than raw. Skeleton: ${skeletonResult.optimizedTokens}, Raw: ${minifyResult.originalTokens}`);
    assert.ok(skeletonResult.optimizedTokens < minifyResult.optimizedTokens,
      `Skeleton should use fewer tokens than minify. Skeleton: ${skeletonResult.optimizedTokens}, Minify: ${minifyResult.optimizedTokens}`);
    assert.ok(skeletonResult.savings.percentSaved > 20,
      `Expected >20% savings from skeleton. Got: ${skeletonResult.savings.percentSaved}%`);
  });
});

describe('SkeletonExtractor — language support', () => {
  test('returns input unchanged for unsupported languages (python)', () => {
    const input = `def foo():\n    return 42`;
    const result = extractor.extract(input, 'python');
    assert.equal(result, input, 'Python input should be returned unchanged');
  });

  test('processes javascript the same as typescript', () => {
    const input = `function add(a, b) {\n  return a + b;\n}`;
    const result = extractor.extract(input, 'javascript');
    assert.ok(result.includes('function add(a, b)'), 'JS signature missing');
    assert.ok(!result.includes('return a + b'), 'JS body not stripped');
  });
});
