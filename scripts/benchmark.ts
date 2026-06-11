#!/usr/bin/env npx tsx
/**
 * LeanContext Benchmark Script
 *
 * Runs Minify and Skeleton mode on all repos in benchmarks_real/
 * and prints a comparison table.
 *
 * Usage:
 *   npm run benchmark
 *   npm run benchmark -- --repo nestjs-boilerplate
 *   npm run benchmark -- --save   (also writes benchmarks_real/benchmark_report.md)
 */

import * as fs from 'fs';
import * as path from 'path';
import { LeanContextEngine } from '../packages/leancontext-core/src/leancontext_engine.js';

const BENCHMARKS_DIR = path.join(__dirname, '../benchmarks_real');
const MAX_FILES = 500;
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java', '.cs', '.cpp', '.c']);

// --- CLI args ---
const args = process.argv.slice(2);
const filterRepo = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : null;
const saveReport = args.includes('--save');

// --- File discovery ---
function discoverFiles(dir: string, files: string[] = []): string[] {
  if (files.length >= MAX_FILES) return files;
  if (!fs.existsSync(dir)) return files;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (files.length >= MAX_FILES) break;
    if (['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      discoverFiles(full, files);
    } else if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

// --- Lang detection ---
function detectLang(file: string): string {
  const ext = path.extname(file);
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript',
    '.py': 'python',
    '.go': 'go', '.rs': 'rust',
    '.java': 'java', '.cs': 'csharp',
    '.cpp': 'cpp', '.c': 'c',
  };
  return map[ext] ?? 'typescript';
}

// --- Formatting helpers ---
function commas(n: number): string {
  return n.toLocaleString('en-US');
}
function pct(saved: number, total: number): string {
  if (total === 0) return '  0.0%';
  return `${((saved / total) * 100).toFixed(1).padStart(5)}%`;
}
function bar(reduction: number, width = 20): string {
  const filled = Math.round((reduction / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// --- Benchmark one repo ---
interface RepoResult {
  name: string;
  fileCount: number;
  rawTokens: number;
  minifyTokens: number;
  skeletonTokens: number;
  minifyMs: number;
  skeletonMs: number;
  capped: boolean;
}

function benchmarkRepo(repoDir: string, repoName: string): RepoResult {
  const files = discoverFiles(repoDir);
  const capped = files.length >= MAX_FILES;

  const minifyEngine = new LeanContextEngine();
  const skeletonEngine = new LeanContextEngine({ mode: 'skeleton' } as any);

  let rawTokens = 0;
  let minifyTokens = 0;
  let skeletonTokens = 0;

  const minifyStart = Date.now();
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      const lang = detectLang(file);
      const result = minifyEngine.optimize(content, lang);
      rawTokens += result.originalTokens;
      minifyTokens += result.optimizedTokens;
    } catch { /* skip unreadable files */ }
  }
  const minifyMs = Date.now() - minifyStart;

  const skeletonStart = Date.now();
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      const lang = detectLang(file);
      const result = skeletonEngine.optimize(content, lang);
      skeletonTokens += result.optimizedTokens;
    } catch { /* skip unreadable files */ }
  }
  const skeletonMs = Date.now() - skeletonStart;

  return { name: repoName, fileCount: files.length, rawTokens, minifyTokens, skeletonTokens, minifyMs, skeletonMs, capped };
}

// --- Table rendering ---
const COL = { name: 22, files: 7, tokens: 12, reduction: 10, time: 8 };
const SEP = '─'.repeat(Object.values(COL).reduce((a, b) => a + b + 3, 0) - 1);

function header(): string {
  return [
    SEP,
    `${'Repository'.padEnd(COL.name)} ${'Files'.padStart(COL.files)} ${'Raw Tokens'.padStart(COL.tokens)} ${'Minify'.padStart(COL.tokens)} ${'Min%'.padStart(COL.reduction)} ${'Skeleton'.padStart(COL.tokens)} ${'Skel%'.padStart(COL.reduction)} ${'Time'.padStart(COL.time)}`,
    SEP,
  ].join('\n');
}

function row(r: RepoResult): string {
  const minifyReduction = r.rawTokens > 0 ? ((r.rawTokens - r.minifyTokens) / r.rawTokens) * 100 : 0;
  const skelReduction = r.rawTokens > 0 ? ((r.rawTokens - r.skeletonTokens) / r.rawTokens) * 100 : 0;
  const cappedMark = r.capped ? '*' : ' ';
  return `${(r.name + cappedMark).padEnd(COL.name)} ${String(r.fileCount).padStart(COL.files)} ${commas(r.rawTokens).padStart(COL.tokens)} ${commas(r.minifyTokens).padStart(COL.tokens)} ${pct(r.rawTokens - r.minifyTokens, r.rawTokens).padStart(COL.reduction)} ${commas(r.skeletonTokens).padStart(COL.tokens)} ${pct(r.rawTokens - r.skeletonTokens, r.rawTokens).padStart(COL.reduction)} ${`${r.minifyMs + r.skeletonMs}ms`.padStart(COL.time)}`;
}

// --- Main ---
const repos = fs.readdirSync(BENCHMARKS_DIR)
  .filter(name => {
    const full = path.join(BENCHMARKS_DIR, name);
    return fs.statSync(full).isDirectory() && (!filterRepo || name === filterRepo);
  });

if (repos.length === 0) {
  console.error(`No repos found${filterRepo ? ` matching "${filterRepo}"` : ''}`);
  process.exit(1);
}

console.log(`\nLeanContext Benchmark — ${new Date().toISOString().slice(0, 10)}`);
console.log(header());

const results: RepoResult[] = [];
for (const name of repos) {
  process.stdout.write(`  ${name.padEnd(COL.name - 2)} ...`);
  const r = benchmarkRepo(path.join(BENCHMARKS_DIR, name), name);
  results.push(r);
  process.stdout.write(`\r${row(r)}\n`);
}

// Grand totals
const totals: RepoResult = {
  name: 'TOTAL',
  fileCount: results.reduce((a, r) => a + r.fileCount, 0),
  rawTokens: results.reduce((a, r) => a + r.rawTokens, 0),
  minifyTokens: results.reduce((a, r) => a + r.minifyTokens, 0),
  skeletonTokens: results.reduce((a, r) => a + r.skeletonTokens, 0),
  minifyMs: results.reduce((a, r) => a + r.minifyMs, 0),
  skeletonMs: results.reduce((a, r) => a + r.skeletonMs, 0),
  capped: false,
};

console.log(SEP);
console.log(row(totals));
console.log(SEP);
console.log('* file cap hit (500 files max)');

// --- Markdown report ---
if (saveReport) {
  const minifyPct = ((totals.rawTokens - totals.minifyTokens) / totals.rawTokens * 100).toFixed(1);
  const skelPct = ((totals.rawTokens - totals.skeletonTokens) / totals.rawTokens * 100).toFixed(1);

  let md = `# LeanContext Benchmark Report\n\n**Date:** ${new Date().toISOString().slice(0, 10)}\n\n`;
  md += `| Repository | Files | Raw Tokens | Minify | Min% | Skeleton | Skel% |\n`;
  md += `|---|---|---|---|---|---|---|\n`;
  for (const r of results) {
    const mPct = ((r.rawTokens - r.minifyTokens) / r.rawTokens * 100).toFixed(1);
    const sPct = ((r.rawTokens - r.skeletonTokens) / r.rawTokens * 100).toFixed(1);
    md += `| ${r.name}${r.capped ? '*' : ''} | ${r.fileCount} | ${commas(r.rawTokens)} | ${commas(r.minifyTokens)} | ${mPct}% | ${commas(r.skeletonTokens)} | ${sPct}% |\n`;
  }
  md += `| **TOTAL** | **${totals.fileCount}** | **${commas(totals.rawTokens)}** | **${commas(totals.minifyTokens)}** | **${minifyPct}%** | **${commas(totals.skeletonTokens)}** | **${skelPct}%** |\n\n`;
  md += `> \\* = file cap hit (500 files max)\n\n`;
  md += `## Visual Comparison\n\n\`\`\`\n`;
  md += `Raw      ${bar(0)}   0%\n`;
  md += `Minify   ${bar(parseFloat(minifyPct))}  ${minifyPct}%\n`;
  md += `Skeleton ${bar(parseFloat(skelPct))}  ${skelPct}%\n`;
  md += `\`\`\`\n`;

  const reportPath = path.join(BENCHMARKS_DIR, 'benchmark_report.md');
  fs.writeFileSync(reportPath, md, 'utf8');
  console.log(`\nReport saved to: ${reportPath}`);
}
