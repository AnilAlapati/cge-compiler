#!/usr/bin/env npx tsx
/**
 * LeanContext Blind Scoring Tool
 *
 * Loads evaluation results, shuffles mode labels (A/B/C), presents them for
 * human scoring without revealing which mode produced each answer, then
 * reveals the truth and saves final scores.
 *
 * Usage:
 *   npm run blind-score
 *   npm run blind-score -- --repo nestjs-real
 *   npm run blind-score -- --reveal     (show mode labels — for review only, not blind)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';

const REASONING_DIR = path.join(__dirname, '../benchmarks_reasoning');
const args = process.argv.slice(2);
const filterRepo = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : null;
const revealMode = args.includes('--reveal');

interface RunResult {
  questionId: string;
  mode: 'full' | 'minify' | 'skeleton';
  question: string;
  answer: string;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
}

interface Score {
  correctness: number;     // 1-5: Is the answer factually accurate?
  fileIdentification: number; // 1-5: Did it name the right files?
  reasoningQuality: number;   // 1-5: Is the explanation clear and useful?
}

interface ScoredResult {
  questionId: string;
  question: string;
  mode: 'full' | 'minify' | 'skeleton';
  answer: string;
  score: Score;
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
function ask(prompt: string): Promise<string> {
  return new Promise(resolve => rl.question(prompt, resolve));
}
async function askScore(label: string): Promise<number> {
  while (true) {
    const raw = await ask(`  ${label} (1-5): `);
    const n = parseInt(raw.trim());
    if (n >= 1 && n <= 5) return n;
    console.log('  Please enter a number between 1 and 5.');
  }
}

async function main() {
  const repoDirs = fs.readdirSync(REASONING_DIR).filter(name => {
    const p = path.join(REASONING_DIR, name);
    return fs.statSync(p).isDirectory() && name !== 'results' && (!filterRepo || name === filterRepo);
  });

  for (const repoName of repoDirs) {
    const resultsDir = path.join(REASONING_DIR, 'results', repoName);
    if (!fs.existsSync(resultsDir)) {
      console.log(`No results yet for ${repoName} — run npm run eval first.`);
      continue;
    }

    const scoresPath = path.join(resultsDir, 'scores.json');
    const existingScores: ScoredResult[] = fs.existsSync(scoresPath)
      ? JSON.parse(fs.readFileSync(scoresPath, 'utf8'))
      : [];
    const scoredIds = new Set(existingScores.map(s => s.questionId + '::' + s.mode));

    // Load all mode results
    const fullResults: RunResult[] = fs.existsSync(path.join(resultsDir, 'full.json'))
      ? JSON.parse(fs.readFileSync(path.join(resultsDir, 'full.json'), 'utf8'))
      : [];
    const minifyResults: RunResult[] = fs.existsSync(path.join(resultsDir, 'minify.json'))
      ? JSON.parse(fs.readFileSync(path.join(resultsDir, 'minify.json'), 'utf8'))
      : [];
    const skeletonResults: RunResult[] = fs.existsSync(path.join(resultsDir, 'skeleton.json'))
      ? JSON.parse(fs.readFileSync(path.join(resultsDir, 'skeleton.json'), 'utf8'))
      : [];

    // Group by questionId
    const byQuestion = new Map<string, RunResult[]>();
    for (const r of [...fullResults, ...minifyResults, ...skeletonResults]) {
      if (!byQuestion.has(r.questionId)) byQuestion.set(r.questionId, []);
      byQuestion.get(r.questionId)!.push(r);
    }

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`BLIND SCORING: ${repoName} (${byQuestion.size} questions)`);
    console.log('═'.repeat(70));
    console.log('Rate each answer 1-5:');
    console.log('  Correctness:      1=wrong  5=perfect');
    console.log('  File ID:          1=wrong files  5=exact files named');
    console.log('  Reasoning:        1=unclear  5=excellent explanation');
    console.log('');

    const scores: ScoredResult[] = [...existingScores];

    for (const [questionId, results] of byQuestion) {
      const pending = results.filter(r => !scoredIds.has(r.questionId + '::' + r.mode));
      if (pending.length === 0) continue;

      const shuffled = revealMode ? pending : shuffle(pending);
      const labels = ['A', 'B', 'C'];

      console.log(`\n${'─'.repeat(70)}`);
      console.log(`Question: ${results[0].question}`);
      console.log('─'.repeat(70));

      // Show all answers first (for context)
      for (let i = 0; i < shuffled.length; i++) {
        const label = labels[i];
        const modeLabel = revealMode ? ` [${shuffled[i].mode.toUpperCase()}]` : '';
        console.log(`\n--- Answer ${label}${modeLabel} (${shuffled[i].inputTokens.toLocaleString()} input tokens) ---`);
        console.log(shuffled[i].answer.substring(0, 1200) + (shuffled[i].answer.length > 1200 ? '\n[...truncated]' : ''));
      }

      // Score each answer
      for (let i = 0; i < shuffled.length; i++) {
        const r = shuffled[i];
        const label = labels[i];
        const modeLabel = revealMode ? ` [${r.mode.toUpperCase()}]` : '';
        console.log(`\nScore Answer ${label}${modeLabel}:`);
        const correctness = await askScore('Correctness');
        const fileIdentification = await askScore('File identification');
        const reasoningQuality = await askScore('Reasoning quality');

        scores.push({
          questionId: r.questionId,
          question: r.question,
          mode: r.mode,
          answer: r.answer,
          score: { correctness, fileIdentification, reasoningQuality },
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          costUSD: r.costUSD,
        });

        if (!revealMode) {
          console.log(`  → Reveal: Answer ${label} was ${r.mode.toUpperCase()}`);
        }
      }

      // Save after each question
      fs.writeFileSync(scoresPath, JSON.stringify(scores, null, 2), 'utf8');
    }
  }

  rl.close();

  // Generate summary
  console.log('\n\n' + '═'.repeat(70));
  console.log('RESULTS SUMMARY');
  console.log('═'.repeat(70));
  generateSummary();
}

function generateSummary() {
  const allScores: ScoredResult[] = [];
  const repoDirs = fs.readdirSync(path.join(REASONING_DIR, 'results')).filter(name => {
    return fs.statSync(path.join(REASONING_DIR, 'results', name)).isDirectory();
  });

  for (const repoName of repoDirs) {
    const scoresPath = path.join(REASONING_DIR, 'results', repoName, 'scores.json');
    if (fs.existsSync(scoresPath)) {
      allScores.push(...JSON.parse(fs.readFileSync(scoresPath, 'utf8')));
    }
  }

  if (allScores.length === 0) {
    console.log('No scores yet.');
    return;
  }

  const modes: ('full' | 'minify' | 'skeleton')[] = ['full', 'minify', 'skeleton'];
  const table: Record<string, { correctness: number[]; fileId: number[]; reasoning: number[]; tokens: number[]; cost: number[] }> = {};
  for (const mode of modes) table[mode] = { correctness: [], fileId: [], reasoning: [], tokens: [], cost: [] };

  for (const r of allScores) {
    if (!table[r.mode]) continue;
    table[r.mode].correctness.push(r.score.correctness);
    table[r.mode].fileId.push(r.score.fileIdentification);
    table[r.mode].reasoning.push(r.score.reasoningQuality);
    table[r.mode].tokens.push(r.inputTokens);
    table[r.mode].cost.push(r.costUSD);
  }

  const avg = (arr: number[]) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2) : 'N/A';
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

  console.log(`\n${'Mode'.padEnd(10)} ${'Questions'.padStart(10)} ${'Correct'.padStart(9)} ${'FileID'.padStart(9)} ${'Reasoning'.padStart(10)} ${'AvgTokens'.padStart(12)} ${'TotalCost'.padStart(12)}`);
  console.log('─'.repeat(80));

  for (const mode of modes) {
    const t = table[mode];
    if (t.correctness.length === 0) continue;
    const avgTokens = t.tokens.length ? Math.round(sum(t.tokens) / t.tokens.length) : 0;
    console.log(`${mode.padEnd(10)} ${String(t.correctness.length).padStart(10)} ${avg(t.correctness).padStart(9)} ${avg(t.fileId).padStart(9)} ${avg(t.reasoning).padStart(10)} ${avgTokens.toLocaleString().padStart(12)} ${'$' + sum(t.cost).toFixed(4).padStart(11)}`);
  }

  // Write final report
  const reportPath = path.join(REASONING_DIR, 'eval_report.md');
  let md = `# LeanContext Reasoning Quality Report\n\n**Date:** ${new Date().toISOString().slice(0, 10)}\n**Questions scored:** ${allScores.length}\n\n`;
  md += `| Mode | Questions | Correctness | File ID | Reasoning | Avg Tokens | Total Cost |\n`;
  md += `|---|---|---|---|---|---|---|\n`;
  for (const mode of modes) {
    const t = table[mode];
    if (t.correctness.length === 0) continue;
    const avgTokens = t.tokens.length ? Math.round(sum(t.tokens) / t.tokens.length) : 0;
    md += `| **${mode}** | ${t.correctness.length} | ${avg(t.correctness)}/5 | ${avg(t.fileId)}/5 | ${avg(t.reasoning)}/5 | ${avgTokens.toLocaleString()} | $${sum(t.cost).toFixed(4)} |\n`;
  }
  fs.writeFileSync(reportPath, md, 'utf8');
  console.log(`\nReport saved to: ${reportPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
