#!/usr/bin/env npx tsx
/**
 * LeanContext Reasoning Quality Evaluation Runner
 *
 * Sends every question in benchmarks_reasoning questions.json files to Claude API
 * in three modes: full (raw), minify, skeleton.
 *
 * Usage:
 *   npm run eval
 *   npm run eval -- --repo nestjs-real
 *   npm run eval -- --mode skeleton        (run only one mode)
 *   npm run eval -- --limit 5              (first 5 questions per repo)
 *   npm run eval -- --model claude-haiku-4-5-20251001  (default, cheapest)
 */

import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { LeanContextEngine } from '../packages/leancontext-core/src/leancontext_engine.js';

// ─── Config ───────────────────────────────────────────────────────────────────
const REASONING_DIR = path.join(__dirname, '../benchmarks_reasoning');
const BENCHMARKS_DIR = path.join(__dirname, '../benchmarks_real');
const MAX_FILES = 500;
const MAX_FILE_BYTES = 100_000; // skip huge files
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs']);

const args = process.argv.slice(2);
const filterRepo = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : null;
const filterMode = args.includes('--mode') ? args[args.indexOf('--mode') + 1] : null;
const limitQuestions = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : Number.MAX_SAFE_INTEGER;
const MODEL = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You are a software architect reviewing a codebase. 
Answer the question based ONLY on the provided code context. 
Be specific and precise — name exact file paths and function names where possible.
If the context does not contain enough information to answer confidently, say so explicitly.`;

// ─── Types ────────────────────────────────────────────────────────────────────
interface Question {
  id: string;
  category: string;
  question: string;
  expected_files: string[];
  expected_concepts: string[];
  difficulty: string;
}

interface QuestionFile {
  repo: string;
  source_dir: string;
  questions: Question[];
}

interface RunResult {
  questionId: string;
  mode: 'full' | 'minify' | 'skeleton';
  question: string;
  answer: string;
  inputTokens: number;
  outputTokens: number;
  contextTokens: number;
  latencyMs: number;
  costUSD: number;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function detectLang(file: string): string {
  const ext = path.extname(file);
  const map: Record<string, string> = {
    '.ts': 'typescript', '.tsx': 'typescript',
    '.js': 'javascript', '.jsx': 'javascript',
    '.py': 'python', '.go': 'go', '.rs': 'rust',
  };
  return map[ext] ?? 'typescript';
}

function discoverFiles(dir: string, files: string[] = []): string[] {
  if (files.length >= MAX_FILES || !fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (files.length >= MAX_FILES) break;
    if (['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__', 'cge', 'ast', 'summary'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) discoverFiles(full, files);
    else if (CODE_EXTENSIONS.has(path.extname(entry.name))) files.push(full);
  }
  return files;
}

function buildContext(files: string[], mode: 'full' | 'minify' | 'skeleton'): { context: string; tokenCount: number } {
  const minifyEngine = new LeanContextEngine();
  const skeletonEngine = new LeanContextEngine({ mode: 'skeleton' } as any);
  let context = '';
  let tokenCount = 0;

  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      if (content.length > MAX_FILE_BYTES) continue;
      const relPath = path.relative(BENCHMARKS_DIR, file);
      let processed: string;
      const lang = detectLang(file);

      if (mode === 'full') {
        processed = content;
      } else if (mode === 'minify') {
        processed = minifyEngine.optimize(content, lang).output;
      } else {
        processed = skeletonEngine.optimize(content, lang).output;
      }

      context += `<file path="${relPath}">\n${processed}\n</file>\n\n`;
      tokenCount += Math.ceil(processed.length / 3.5);
    } catch { /* skip unreadable */ }
  }

  return { context: context.trim(), tokenCount };
}

// Haiku pricing: $1/$5 per million tokens (input/output)
function estimateCost(inputTokens: number, outputTokens: number, model: string): number {
  if (model.includes('haiku')) return (inputTokens * 1 + outputTokens * 5) / 1_000_000;
  if (model.includes('sonnet')) return (inputTokens * 3 + outputTokens * 15) / 1_000_000;
  if (model.includes('opus')) return (inputTokens * 15 + outputTokens * 75) / 1_000_000;
  return (inputTokens * 1 + outputTokens * 5) / 1_000_000;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const client = new Anthropic();
  const modes: ('full' | 'minify' | 'skeleton')[] = filterMode
    ? [filterMode as 'full' | 'minify' | 'skeleton']
    : ['full', 'minify', 'skeleton'];

  const repoDirs = fs.readdirSync(REASONING_DIR).filter(name => {
    const p = path.join(REASONING_DIR, name);
    return fs.statSync(p).isDirectory() && (!filterRepo || name === filterRepo);
  });

  if (repoDirs.length === 0) {
    console.error(`No repos found in ${REASONING_DIR}${filterRepo ? ` matching "${filterRepo}"` : ''}`);
    process.exit(1);
  }

  let totalCost = 0;
  let totalQuestions = 0;

  for (const repoName of repoDirs) {
    const questionsPath = path.join(REASONING_DIR, repoName, 'questions.json');
    if (!fs.existsSync(questionsPath)) continue;

    const qFile: QuestionFile = JSON.parse(fs.readFileSync(questionsPath, 'utf8'));
    const sourceDir = path.join(__dirname, '..', qFile.source_dir);
    const files = discoverFiles(sourceDir);

    if (files.length === 0) {
      console.log(`⚠️  No files found for ${repoName} at ${sourceDir}`);
      continue;
    }

    console.log(`\n📁 ${repoName} (${files.length} files)`);
    console.log(`   Questions: ${qFile.questions.length} | Modes: ${modes.join(', ')}`);

    const resultsDir = path.join(REASONING_DIR, 'results', repoName);
    fs.mkdirSync(resultsDir, { recursive: true });

    // Pre-build all 3 contexts (expensive - do once)
    console.log('   Building contexts...');
    const contexts: Record<string, { context: string; tokenCount: number }> = {};
    for (const mode of modes) {
      contexts[mode] = buildContext(files, mode);
      console.log(`   ${mode.padEnd(8)} context: ${contexts[mode].tokenCount.toLocaleString()} tokens`);
    }

    const questions = qFile.questions.slice(0, limitQuestions);

    for (const mode of modes) {
      const resultsPath = path.join(resultsDir, `${mode}.json`);
      const existing: RunResult[] = fs.existsSync(resultsPath)
        ? JSON.parse(fs.readFileSync(resultsPath, 'utf8'))
        : [];
      const existingIds = new Set(existing.map(r => r.questionId));

      const results: RunResult[] = [...existing];
      const { context, tokenCount } = contexts[mode];

      for (const q of questions) {
        if (existingIds.has(q.id)) {
          process.stdout.write(`   [${mode}] ${q.id} (skipped — already exists)\n`);
          continue;
        }

        process.stdout.write(`   [${mode}] ${q.id}... `);
        const start = Date.now();

        try {
          const msg = await client.messages.create({
            model: MODEL,
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            messages: [{
              role: 'user',
              content: `<codebase>\n${context}\n</codebase>\n\nQuestion: ${q.question}`,
            }],
          });

          const latencyMs = Date.now() - start;
          const inputTokens = msg.usage.input_tokens;
          const outputTokens = msg.usage.output_tokens;
          const cost = estimateCost(inputTokens, outputTokens, MODEL);
          totalCost += cost;

          const answer = msg.content[0].type === 'text' ? msg.content[0].text : '';

          results.push({
            questionId: q.id,
            mode,
            question: q.question,
            answer,
            inputTokens,
            outputTokens,
            contextTokens: tokenCount,
            latencyMs,
            costUSD: cost,
          });

          process.stdout.write(`✓ (${latencyMs}ms, $${cost.toFixed(4)})\n`);
        } catch (err: any) {
          results.push({
            questionId: q.id, mode, question: q.question, answer: '',
            inputTokens: 0, outputTokens: 0, contextTokens: tokenCount,
            latencyMs: Date.now() - start, costUSD: 0, error: err.message,
          });
          process.stdout.write(`✗ ERROR: ${err.message}\n`);
        }

        // Save after each question (resume-safe)
        fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), 'utf8');
        totalQuestions++;

        // Rate limit: avoid hitting API too fast
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Total questions answered: ${totalQuestions}`);
  console.log(`Estimated total cost: $${totalCost.toFixed(4)}`);
  console.log(`Results saved to: ${path.join(REASONING_DIR, 'results/')}`);
  console.log(`\nNext step: npm run blind-score`);
}

main().catch(err => { console.error(err); process.exit(1); });
