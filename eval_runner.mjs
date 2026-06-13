/**
 * eval_runner.mjs
 * Builds the LeanContext /workspace output for Ghostfolio and
 * writes two files used in the 10-task evaluation:
 *   - eval_workspace_raw.txt      (file paths + raw token counts)
 *   - eval_workspace_optimized.txt (full optimized XML context)
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, relative } from 'path';

const GHOSTFOLIO_DIR = '/Users/anilalapati/Development/ghostfolio';
const OUT_DIR = '/Users/anilalapati/Development/cge-compiler';

// ── Token estimator (same heuristic as leancontext-core) ──────────────────────
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

// ── Language map ──────────────────────────────────────────────────────────────
const extToLang = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
};

// ── Comment stripper (port of core logic) ─────────────────────────────────────
function stripComments(code, lang) {
  // Remove block comments /* ... */
  code = code.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove line comments // ...
  code = code.replace(/\/\/[^\n]*/g, '');
  // Remove JSDoc-style /** ... */  (already covered above)
  return code;
}

function stripDeadCode(code) {
  // Remove commented-out code blocks (lines starting with //)
  // Already handled by stripComments
  return code;
}

function normalizeWhitespace(code) {
  // Collapse 3+ blank lines into 2
  code = code.replace(/\n{3,}/g, '\n\n');
  // Remove trailing whitespace
  code = code.replace(/[ \t]+$/gm, '');
  return code.trim();
}

function optimize(content, lang) {
  let out = stripDeadCode(content);
  out = stripComments(out, lang);
  out = normalizeWhitespace(out);
  return out;
}

// ── File walker ───────────────────────────────────────────────────────────────
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage', '.nx', 'tmp']);
const SKIP_FILES = new Set(['.spec.ts', '.test.ts', '.e2e.ts', '.mock.ts', '.fixture.ts']);

function walk(dir, files = []) {
  for (const item of readdirSync(dir)) {
    if (SKIP_DIRS.has(item)) continue;
    const full = join(dir, item);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
    } else {
      const ext = extname(item).toLowerCase();
      if (!extToLang[ext]) continue;
      // Skip test/spec files — they add noise without architectural signal
      if (SKIP_FILES.has(item.slice(item.lastIndexOf('.')))) continue;
      if (SKIP_FILES.has(item.slice(-8)) || item.includes('.spec.') || item.includes('.test.') || item.includes('.e2e.')) continue;
      files.push(full);
    }
  }
  return files;
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log('Walking Ghostfolio...');
const allFiles = walk(GHOSTFOLIO_DIR);
console.log(`Found ${allFiles.length} source files (excluding tests/specs)`);

let totalRawTokens = 0;
let totalOptTokens = 0;
let rawIndex = '';
let optimizedContext = '';

for (const filePath of allFiles) {
  const rel = relative(GHOSTFOLIO_DIR, filePath);
  const ext = extname(filePath).toLowerCase();
  const lang = extToLang[ext];
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    continue;
  }

  const rawTokens = estimateTokens(content);
  const optimized = optimize(content, lang);
  const optTokens = estimateTokens(optimized);

  totalRawTokens += rawTokens;
  totalOptTokens += optTokens;

  rawIndex += `${rel} | raw=${rawTokens} | opt=${optTokens} | saved=${rawTokens - optTokens}\n`;
  optimizedContext += `<file path="${rel}">\n${optimized}\n</file>\n\n`;
}

const savedTokens = totalRawTokens - totalOptTokens;
const pct = ((savedTokens / totalRawTokens) * 100).toFixed(1);

const summary = `
=== LeanContext /workspace — Ghostfolio ===
Files processed : ${allFiles.length}
Raw tokens      : ${totalRawTokens.toLocaleString()}
Optimized tokens: ${totalOptTokens.toLocaleString()}
Tokens saved    : ${savedTokens.toLocaleString()}
Savings         : ${pct}%
`.trim();

console.log('\n' + summary + '\n');

writeFileSync(join(OUT_DIR, 'eval_workspace_index.txt'), summary + '\n\n' + rawIndex);
writeFileSync(join(OUT_DIR, 'eval_workspace_optimized.txt'), optimizedContext);

console.log('Written:');
console.log('  eval_workspace_index.txt  — per-file token counts');
console.log('  eval_workspace_optimized.txt — full optimized context');
