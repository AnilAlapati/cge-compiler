import * as fs from 'fs';
import * as path from 'path';
import { Anthropic } from '@anthropic-ai/sdk';

const REASONING_DIR = path.join(__dirname, '../benchmarks_reasoning');

// Initialize Anthropic client using the API key
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Please export ANTHROPIC_API_KEY");
  process.exit(1);
}

const anthropic = new Anthropic({ apiKey });

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
  correctness: number;     // 1-5
  fileIdentification: number; // 1-5
  reasoningQuality: number;   // 1-5
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

async function gradeWithLLM(question: string, answer: string): Promise<Score> {
  const prompt = `You are a strict, objective technical evaluator scoring LLM responses to codebase analysis questions.
You must grade the following Answer to the Question on three criteria, giving each a score from 1 to 5:

Criteria:
1. Correctness (1-5): Is the answer factually accurate, correct, and matching standard code structure/logic?
   - 1: Completely wrong
   - 3: Partially correct/missing key details
   - 5: Perfectly accurate
2. File Identification (1-5): Does it correctly identify or imply the right files/classes?
   - 1: Refers to completely wrong files or none at all when necessary
   - 3: Refers to some correct files but misses main ones
   - 5: Names exactly the correct files
3. Reasoning Quality (1-5): Is the explanation clear, logical, and technically sound?
   - 1: Completely unclear or nonsensical
   - 3: Decent explanation but has gaps
   - 5: Extremely clear, comprehensive, and professional explanation

Question:
"${question}"

Answer to evaluate:
"${answer}"

You must respond ONLY with a raw JSON object matching this schema, no other text or explanation:
{
  "correctness": <number 1-5>,
  "fileIdentification": <number 1-5>,
  "reasoningQuality": <number 1-5>
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 150,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text;
    const jsonStr = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const result = JSON.parse(jsonStr);
    return {
      correctness: Number(result.correctness) || 3,
      fileIdentification: Number(result.fileIdentification) || 3,
      reasoningQuality: Number(result.reasoningQuality) || 3
    };
  } catch (error) {
    console.error(`Failed to grade: ${error}`);
    return { correctness: 3, fileIdentification: 3, reasoningQuality: 3 };
  }
}

async function main() {
  const repoDirs = fs.readdirSync(REASONING_DIR).filter(name => {
    const p = path.join(REASONING_DIR, name);
    return fs.statSync(p).isDirectory() && name !== 'results';
  });

  for (const repoName of repoDirs) {
    const resultsDir = path.join(REASONING_DIR, 'results', repoName);
    if (!fs.existsSync(resultsDir)) continue;

    console.log(`Auto-grading results for repository: ${repoName}...`);

    // Load results
    const fullResults: RunResult[] = fs.existsSync(path.join(resultsDir, 'full.json'))
      ? JSON.parse(fs.readFileSync(path.join(resultsDir, 'full.json'), 'utf8'))
      : [];
    const minifyResults: RunResult[] = fs.existsSync(path.join(resultsDir, 'minify.json'))
      ? JSON.parse(fs.readFileSync(path.join(resultsDir, 'minify.json'), 'utf8'))
      : [];
    const skeletonResults: RunResult[] = fs.existsSync(path.join(resultsDir, 'skeleton.json'))
      ? JSON.parse(fs.readFileSync(path.join(resultsDir, 'skeleton.json'), 'utf8'))
      : [];

    const scores: ScoredResult[] = [];

    const allResults = [...fullResults, ...minifyResults, ...skeletonResults];
    for (let i = 0; i < allResults.length; i++) {
      const r = allResults[i];
      console.log(` Grading item ${i + 1}/${allResults.length}: [${r.mode.toUpperCase()}] ${r.questionId}...`);
      const score = await gradeWithLLM(r.question, r.answer);
      scores.push({
        questionId: r.questionId,
        question: r.question,
        mode: r.mode,
        answer: r.answer,
        score,
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costUSD: r.costUSD
      });
    }

    const scoresPath = path.join(resultsDir, 'scores.json');
    fs.writeFileSync(scoresPath, JSON.stringify(scores, null, 2), 'utf8');
    console.log(`Scores saved to ${scoresPath}`);
  }

  console.log("\nAuto-grading complete. Generating summary report...");
  // Re-run summary generator logic from blind_score.ts
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
    console.log('No scores found.');
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
