#!/usr/bin/env npx tsx
/**
 * LeanContext Workflow PoC — 2-Step Repository Routing
 *
 * Tests the core hypothesis:
 *   "Can Skeleton Mode act as a MAP that tells an AI agent what code to read next?"
 *
 * Step 1 (Route): Build a compact structural index of the repo and ask the LLM
 *                 which files are relevant to answer a given task.
 * Step 2 (Read):  Load only those selected files in Full mode and answer the task.
 *
 * Compares the 2-step answer against a naive single-step approach to measure
 * whether routing via Skeleton preserves answer quality while reducing token usage.
 *
 * Usage:
 *   npx tsx scripts/workflow_poc.ts
 *   npx tsx scripts/workflow_poc.ts --repo ghostfolio
 *   npx tsx scripts/workflow_poc.ts --subdir apps/api/src/app/auth
 */

import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { LeanContextEngine } from '../packages/leancontext-core/src/leancontext_engine.js';

// ─── Config ───────────────────────────────────────────────────────────────────
const BENCHMARKS_DIR = path.join(__dirname, '../benchmarks_real');
const RESULTS_DIR = path.join(__dirname, '../benchmarks_reasoning/workflow_poc_results');
const MODEL = 'claude-haiku-4-5-20251001';

// Haiku pricing
const INPUT_PRICE_PER_M = 1.0;
const OUTPUT_PRICE_PER_M = 5.0;

const MAX_FILE_BYTES = 80_000;
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs']);

const args = process.argv.slice(2);
const filterRepo = args.includes('--repo') ? args[args.indexOf('--repo') + 1] : 'ghostfolio';
const filterSubdir = args.includes('--subdir') ? args[args.indexOf('--subdir') + 1] : null;

// Max files to include in the manifest (keeps Step 1 prompt small)
const MANIFEST_MAX_FILES = 300;
// Max files allowed to select in Step 1
const MAX_SELECTED_FILES = 8;
// Max tokens for any single full-mode context in Step 2
const STEP2_MAX_TOKENS = 40_000;

// ─── Tasks to evaluate ────────────────────────────────────────────────────────
interface Task {
  id: string;
  question: string;
  // Ground-truth files to check against routing selections
  groundTruthFiles: string[];
  // Key concepts that should appear in a good answer
  groundTruthConcepts: string[];
}

const TASKS: Task[] = [
  {
    id: 'auth-001',
    question: 'How does authentication work in this application? Walk me through the full auth flow from login to request authorization.',
    groundTruthFiles: [
      'apps/api/src/app/auth/auth.service.ts',
      'apps/api/src/app/auth/jwt.strategy.ts',
      'apps/api/src/app/auth/auth.controller.ts',
    ],
    groundTruthConcepts: ['JWT', 'validateAnonymousLogin', 'validateOAuthLogin', 'JwtStrategy', 'passport', 'Bearer token'],
  },
  {
    id: 'auth-002',
    question: 'Where would I add support for a new OAuth provider (e.g., GitHub)? What files do I need to create or modify?',
    groundTruthFiles: [
      'apps/api/src/app/auth/google.strategy.ts',
      'apps/api/src/app/auth/auth.module.ts',
      'apps/api/src/app/auth/auth.controller.ts',
    ],
    groundTruthConcepts: ['PassportStrategy', 'GoogleStrategy', 'auth.module.ts', 'controller callback', 'provider enum'],
  },
  {
    id: 'portfolio-001',
    question: 'Trace what happens when a user deletes a portfolio activity (trade). Which services and database models are involved?',
    groundTruthFiles: [
      'apps/api/src/app/activities/activities.service.ts',
      'apps/api/src/app/portfolio/portfolio.service.ts',
      'apps/api/src/app/activities/activities.controller.ts',
    ],
    groundTruthConcepts: ['ActivitiesService', 'deleteActivity', 'Order model', 'portfolio recalculation', 'Prisma', 'cache invalidation'],
  },
  {
    id: 'data-001',
    question: 'How is market data fetched and kept up to date? What background jobs exist and how are they triggered?',
    groundTruthFiles: [
      'apps/api/src/services/cron/',
      'apps/api/src/services/data-provider/data-provider.module.ts',
      'apps/api/src/app/admin/',
    ],
    groundTruthConcepts: ['CronModule', 'ScheduleModule', 'DataGatheringQueue', 'Bull', 'cron job', 'data providers', 'Yahoo', 'CoinGecko'],
  },
  {
    id: 'sharing-001',
    question: 'How does the portfolio sharing feature work? How can user A grant user B access to view their portfolio?',
    groundTruthFiles: [
      'apps/api/src/app/access/access.service.ts',
      'apps/api/src/app/access/access.controller.ts',
      'apps/api/src/app/portfolio/portfolio.controller.ts',
    ],
    groundTruthConcepts: ['Access model', 'granteeUserId', 'ImpersonationService', 'READ', 'READ_RESTRICTED', 'sharing link', 'impersonation token'],
  },
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface FileEntry {
  relPath: string;
  absPath: string;
  sizeBytes: number;
  topLevelExports: string[];
}

interface WorkflowResult {
  taskId: string;
  question: string;

  // Step 1 (routing)
  step1Prompt: string;
  step1SelectedFiles: string[];
  step1InputTokens: number;
  step1OutputTokens: number;
  step1CostUSD: number;
  step1RoutingAccuracy: number;   // % of ground truth files that were selected

  // Step 2 (answer)
  step2Context: string;
  step2Answer: string;
  step2InputTokens: number;
  step2OutputTokens: number;
  step2CostUSD: number;

  // Grading
  qualityScore: number;         // 1-5 overall quality
  correctnessScore: number;     // 1-5
  fileIdScore: number;          // 1-5

  // Totals
  totalTokens: number;
  totalCostUSD: number;

  // For comparison: estimated cost if naive full-context approach
  naiveFullContextTokens: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function discoverFiles(dir: string, files: FileEntry[] = []): FileEntry[] {
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (['node_modules', '.git', 'dist', 'build', '.next', 'coverage',
         '__pycache__', 'cge', 'ast', 'summary', '.storybook', '.cache'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      discoverFiles(full, files);
    } else if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
      const stat = fs.statSync(full);
      if (stat.size <= MAX_FILE_BYTES) {
        files.push({
          relPath: path.relative(BENCHMARKS_DIR, full),
          absPath: full,
          sizeBytes: stat.size,
          topLevelExports: [],
        });
      }
    }
  }
  return files;
}

/**
 * Extract top-level exported names from a TypeScript/JS file using simple regex.
 * This is intentionally lightweight — we just want class names, function names, interfaces.
 */
function extractTopLevelExports(content: string): string[] {
  const exports: string[] = [];
  const patterns = [
    /^export\s+(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/gm,
    /^export\s+(?:async\s+)?function\s+(\w+)/gm,
    /^export\s+(?:type\s+)?interface\s+(\w+)/gm,
    /^export\s+type\s+(\w+)\s*=/gm,
    /^export\s+enum\s+(\w+)/gm,
    /^export\s+const\s+(\w+)/gm,
    /^\s*@(?:Controller|Injectable|Module|Guard|Interceptor|Decorator)\([^)]*\)\s*\nexport\s+class\s+(\w+)/gm,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      if (match[1]) exports.push(match[1]);
    }
  }
  return [...new Set(exports)].slice(0, 6); // cap at 6 per file
}

/**
 * Builds the structural manifest — a compact list of all files with their exports.
 * This is the "map" that gets sent to the LLM in Step 1.
 */
function buildManifest(files: FileEntry[], repoRoot: string): string {
  const lines: string[] = [];
  lines.push(`# Repository Structure`);
  lines.push(`Total files: ${files.length}\n`);

  // Group by directory for readability
  const byDir = new Map<string, FileEntry[]>();
  for (const f of files) {
    const dir = path.dirname(f.relPath);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir)!.push(f);
  }

  for (const [dir, dirFiles] of [...byDir.entries()].sort()) {
    lines.push(`\n📁 ${dir}/`);
    for (const f of dirFiles) {
      const fileName = path.basename(f.relPath);
      const exports = f.topLevelExports.length > 0
        ? ` [${f.topLevelExports.join(', ')}]`
        : '';
      lines.push(`  ${fileName}${exports}`);
    }
  }

  return lines.join('\n');
}

function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens * INPUT_PRICE_PER_M + outputTokens * OUTPUT_PRICE_PER_M) / 1_000_000;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

// ─── Core Workflow ────────────────────────────────────────────────────────────
async function runStep1Routing(
  client: Anthropic,
  manifest: string,
  task: Task,
): Promise<{ selectedFiles: string[]; inputTokens: number; outputTokens: number; rawResponse: string }> {
  const prompt = `You are an expert software architect helping an agent decide which files to read before answering a question.

Below is the structural manifest of a real-world codebase. It lists all files and their top-level exported names.

<repository_manifest>
${manifest}
</repository_manifest>

Based on this manifest, select up to ${MAX_SELECTED_FILES} files that are MOST RELEVANT to answer the following question:

<question>
${task.question}
</question>

Instructions:
- Select ONLY file paths that appear in the manifest above
- Prefer service files, controllers, and strategy files over module files
- Return exactly a JSON array of relative file paths (from the repo root in the manifest)
- Be precise — only include files that directly contain the implementation details needed
- Do NOT include test files (.spec.ts)

Respond with ONLY a JSON array, nothing else:
["path/to/file1.ts", "path/to/file2.ts", ...]`;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const rawResponse = msg.content[0].type === 'text' ? msg.content[0].text : '';

  // Parse the file list
  let selectedFiles: string[] = [];
  try {
    const jsonStr = rawResponse.substring(
      rawResponse.indexOf('['),
      rawResponse.lastIndexOf(']') + 1
    );
    selectedFiles = JSON.parse(jsonStr);
  } catch {
    // Fallback: extract paths with regex
    const matches = rawResponse.match(/"([^"]+\.[tj]s[x]?)"/g) || [];
    selectedFiles = matches.map(m => m.replace(/"/g, ''));
  }

  return {
    selectedFiles: selectedFiles.slice(0, MAX_SELECTED_FILES),
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
    rawResponse,
  };
}

async function runStep2Answer(
  client: Anthropic,
  selectedFiles: string[],
  allFiles: FileEntry[],
  task: Task,
  repoDir: string,
): Promise<{ answer: string; context: string; inputTokens: number; outputTokens: number }> {
  // Build a map from relative path to full path for fast lookup
  const pathMap = new Map<string, string>();
  for (const f of allFiles) {
    // Support both exact match and partial match (for directory-style paths in ground truth)
    pathMap.set(f.relPath, f.absPath);
    // Also index just the filename for fuzzy matching
    pathMap.set(path.basename(f.relPath), f.absPath);
  }

  // Resolve selected file paths to absolute paths
  const resolvedFiles: Array<{ relPath: string; absPath: string }> = [];
  for (const sel of selectedFiles) {
    // Try exact match first
    if (pathMap.has(sel)) {
      resolvedFiles.push({ relPath: sel, absPath: pathMap.get(sel)! });
      continue;
    }
    // Try fuzzy: find files whose relPath ends with sel
    const fuzzy = allFiles.find(f => f.relPath.endsWith(sel) || f.relPath.includes(sel));
    if (fuzzy) {
      resolvedFiles.push({ relPath: fuzzy.relPath, absPath: fuzzy.absPath });
    }
  }

  // Build full-mode context from only the selected files
  let context = '';
  let totalContextTokens = 0;
  for (const { relPath, absPath } of resolvedFiles) {
    try {
      const content = fs.readFileSync(absPath, 'utf8');
      const fileTokens = estimateTokens(content);
      if (totalContextTokens + fileTokens > STEP2_MAX_TOKENS) {
        console.log(`   ⚠️  Skipping ${path.basename(relPath)} (would exceed token budget)`);
        continue;
      }
      context += `<file path="${relPath}">\n${content}\n</file>\n\n`;
      totalContextTokens += fileTokens;
    } catch { /* skip */ }
  }

  if (!context.trim()) {
    return {
      answer: 'ERROR: No files could be loaded.',
      context: '',
      inputTokens: 0,
      outputTokens: 0,
    };
  }

  const prompt = `You are a software architect reviewing a codebase. Answer the question based ONLY on the provided code context.
Be specific and precise — name exact file paths, function names, and class names where possible.

<codebase>
${context}
</codebase>

Question: ${task.question}`;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  });

  return {
    answer: msg.content[0].type === 'text' ? msg.content[0].text : '',
    context,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
  };
}

async function gradeAnswer(
  client: Anthropic,
  task: Task,
  answer: string,
): Promise<{ correctness: number; fileId: number; overall: number }> {
  const prompt = `You are a strict technical evaluator. Grade the following answer to a codebase question.

Question: "${task.question}"

Expected key concepts that should appear in a good answer:
${task.groundTruthConcepts.map(c => `- ${c}`).join('\n')}

Answer to evaluate:
"${answer}"

Grade on three criteria (1-5 scale):
1. Correctness: Is the answer factually accurate?
2. File Identification: Does it name relevant files or components?
3. Overall Quality: Is it genuinely useful to a developer?

Respond ONLY with raw JSON:
{"correctness": <1-5>, "fileIdentification": <1-5>, "overallQuality": <1-5>}`;

  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 150,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = msg.content[0].type === 'text' ? msg.content[0].text : '{}';
  try {
    const jsonStr = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const result = JSON.parse(jsonStr);
    return {
      correctness: Number(result.correctness) || 3,
      fileId: Number(result.fileIdentification) || 3,
      overall: Number(result.overallQuality) || 3,
    };
  } catch {
    return { correctness: 3, fileId: 3, overall: 3 };
  }
}

function measureRoutingAccuracy(selectedFiles: string[], groundTruthFiles: string[]): number {
  if (groundTruthFiles.length === 0) return 0;
  let hits = 0;
  for (const gt of groundTruthFiles) {
    const gtBase = path.basename(gt);
    const gtDir = path.dirname(gt);
    const matched = selectedFiles.some(sel => {
      const selBase = path.basename(sel);
      return sel.includes(gt) || gt.includes(sel) ||
             selBase === gtBase ||
             sel.includes(gtDir);
    });
    if (matched) hits++;
  }
  return Math.round((hits / groundTruthFiles.length) * 100);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Please set ANTHROPIC_API_KEY environment variable');
    process.exit(1);
  }

  const client = new Anthropic({ apiKey });
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  // Locate the repo
  const repoDir = path.join(BENCHMARKS_DIR, filterRepo, 'source');
  if (!fs.existsSync(repoDir)) {
    console.error(`Repo not found: ${repoDir}`);
    process.exit(1);
  }

  const searchDir = filterSubdir ? path.join(repoDir, filterSubdir) : repoDir;

  console.log(`\n🔍 LeanContext Workflow PoC`);
  console.log(`   Repository: ${filterRepo}`);
  console.log(`   Search dir: ${searchDir}`);
  console.log(`   Model: ${MODEL}`);
  console.log(`   Tasks: ${TASKS.length}\n`);

  // ─── Discover all files ───────────────────────────────────────────────────
  process.stdout.write('📂 Discovering files... ');
  const allFiles = discoverFiles(searchDir).slice(0, MANIFEST_MAX_FILES);
  console.log(`${allFiles.length} files found`);

  // Enrich with top-level exports
  process.stdout.write('🔬 Extracting exports from skeleton... ');
  const engine = new LeanContextEngine({ mode: 'skeleton' } as any);
  for (const f of allFiles) {
    try {
      const content = fs.readFileSync(f.absPath, 'utf8');
      const ext = path.extname(f.absPath).slice(1);
      const lang = ['ts', 'tsx'].includes(ext) ? 'typescript' : ext === 'js' || ext === 'jsx' ? 'javascript' : ext;
      const skeleton = engine.optimize(content, lang).output;
      f.topLevelExports = extractTopLevelExports(skeleton);
    } catch { /* skip */ }
  }
  console.log('done');

  // ─── Build manifest ───────────────────────────────────────────────────────
  process.stdout.write('📋 Building manifest... ');
  const manifest = buildManifest(allFiles, repoDir);
  const manifestTokens = estimateTokens(manifest);
  console.log(`done (${manifestTokens.toLocaleString()} tokens)`);

  // Estimate what naive full-context would cost
  let naiveFullContextTokens = 0;
  for (const f of allFiles) {
    try {
      const content = fs.readFileSync(f.absPath, 'utf8');
      naiveFullContextTokens += estimateTokens(content);
    } catch { /* skip */ }
  }

  console.log(`\n📊 Baseline comparison:`);
  console.log(`   Naive full context: ~${naiveFullContextTokens.toLocaleString()} tokens`);
  console.log(`   Step 1 manifest:     ~${manifestTokens.toLocaleString()} tokens`);
  console.log(`   Compression ratio:   ${(manifestTokens / naiveFullContextTokens * 100).toFixed(1)}%\n`);
  console.log('─'.repeat(70));

  // ─── Run tasks ────────────────────────────────────────────────────────────
  const results: WorkflowResult[] = [];
  let totalCost = 0;

  for (let i = 0; i < TASKS.length; i++) {
    const task = TASKS[i];
    console.log(`\n[${i + 1}/${TASKS.length}] ${task.id}`);
    console.log(`   Q: ${task.question.slice(0, 80)}...`);

    // ── Step 1: Route ──────────────────────────────────────────────────────
    process.stdout.write('   🗺️  Step 1 (route)... ');
    const step1 = await runStep1Routing(client, manifest, task);
    const step1Cost = estimateCost(step1.inputTokens, step1.outputTokens);
    console.log(`✓ (${step1.inputTokens.toLocaleString()} tokens, $${step1Cost.toFixed(4)})`);
    console.log(`   📁 Selected ${step1.selectedFiles.length} files:`);
    for (const f of step1.selectedFiles) {
      console.log(`      • ${f}`);
    }

    const routingAccuracy = measureRoutingAccuracy(step1.selectedFiles, task.groundTruthFiles);
    console.log(`   🎯 Routing accuracy: ${routingAccuracy}% of ground truth files selected`);

    await new Promise(r => setTimeout(r, 800));

    // ── Step 2: Answer ─────────────────────────────────────────────────────
    process.stdout.write('   📖 Step 2 (answer)... ');
    const step2 = await runStep2Answer(client, step1.selectedFiles, allFiles, task, repoDir);
    const step2Cost = estimateCost(step2.inputTokens, step2.outputTokens);
    console.log(`✓ (${step2.inputTokens.toLocaleString()} tokens, $${step2Cost.toFixed(4)})`);

    await new Promise(r => setTimeout(r, 800));

    // ── Grade ──────────────────────────────────────────────────────────────
    process.stdout.write('   🏆 Grading... ');
    const grades = await gradeAnswer(client, task, step2.answer);
    console.log(`✓  Correctness: ${grades.correctness}/5  FileID: ${grades.fileId}/5  Overall: ${grades.overall}/5`);

    const totalCostTask = step1Cost + step2Cost;
    totalCost += totalCostTask;

    const result: WorkflowResult = {
      taskId: task.id,
      question: task.question,
      step1Prompt: `[manifest ${manifestTokens} tokens]`,
      step1SelectedFiles: step1.selectedFiles,
      step1InputTokens: step1.inputTokens,
      step1OutputTokens: step1.outputTokens,
      step1CostUSD: step1Cost,
      step1RoutingAccuracy: routingAccuracy,
      step2Context: step2.context.slice(0, 500) + '...',
      step2Answer: step2.answer,
      step2InputTokens: step2.inputTokens,
      step2OutputTokens: step2.outputTokens,
      step2CostUSD: step2Cost,
      qualityScore: grades.overall,
      correctnessScore: grades.correctness,
      fileIdScore: grades.fileId,
      totalTokens: step1.inputTokens + step2.inputTokens,
      totalCostUSD: totalCostTask,
      naiveFullContextTokens,
    };

    results.push(result);
    console.log(`   💰 Task cost: $${totalCostTask.toFixed(4)}`);

    await new Promise(r => setTimeout(r, 1000));
  }

  // ─── Summary Report ───────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(70)}`);
  console.log('📊 WORKFLOW POC RESULTS');
  console.log('═'.repeat(70));

  const avgRouting = results.reduce((s, r) => s + r.step1RoutingAccuracy, 0) / results.length;
  const avgCorrectness = results.reduce((s, r) => s + r.correctnessScore, 0) / results.length;
  const avgFileId = results.reduce((s, r) => s + r.fileIdScore, 0) / results.length;
  const avgOverall = results.reduce((s, r) => s + r.qualityScore, 0) / results.length;
  const avgTotalTokens = results.reduce((s, r) => s + r.totalTokens, 0) / results.length;

  const savingsVsNaive = ((naiveFullContextTokens - avgTotalTokens) / naiveFullContextTokens * 100);

  console.log(`\nTasks run:             ${results.length}`);
  console.log(`Avg routing accuracy:  ${avgRouting.toFixed(0)}%`);
  console.log(`Avg correctness:       ${avgCorrectness.toFixed(2)}/5`);
  console.log(`Avg file ID:           ${avgFileId.toFixed(2)}/5`);
  console.log(`Avg overall quality:   ${avgOverall.toFixed(2)}/5`);
  console.log(`Avg tokens (2-step):   ${Math.round(avgTotalTokens).toLocaleString()}`);
  console.log(`Naive full context:    ${naiveFullContextTokens.toLocaleString()}`);
  console.log(`Token savings:         ${savingsVsNaive.toFixed(1)}%`);
  console.log(`Total cost:            $${totalCost.toFixed(4)}`);

  console.log(`\n${'─'.repeat(70)}`);
  console.log('Per-task summary:');
  console.log(`${'Task'.padEnd(18)} ${'Route%'.padStart(7)} ${'Corr'.padStart(6)} ${'FileID'.padStart(7)} ${'Overall'.padStart(8)} ${'Tokens'.padStart(9)} ${'Cost'.padStart(8)}`);
  console.log('─'.repeat(70));
  for (const r of results) {
    console.log(
      `${r.taskId.padEnd(18)} ${String(r.step1RoutingAccuracy + '%').padStart(7)} ${String(r.correctnessScore + '/5').padStart(6)} ${String(r.fileIdScore + '/5').padStart(7)} ${String(r.qualityScore + '/5').padStart(8)} ${r.totalTokens.toLocaleString().padStart(9)} ${'$' + r.totalCostUSD.toFixed(4).padStart(7)}`
    );
  }

  // ─── Write detailed results ───────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = path.join(RESULTS_DIR, `results_${timestamp}.json`);
  const reportPath = path.join(RESULTS_DIR, `report_${timestamp}.md`);

  fs.writeFileSync(jsonPath, JSON.stringify({ meta: { repo: filterRepo, model: MODEL, timestamp: new Date().toISOString(), naiveFullContextTokens }, results }, null, 2));

  // Markdown report
  let md = `# LeanContext 2-Step Workflow PoC Results\n\n`;
  md += `**Date:** ${new Date().toISOString().slice(0, 19).replace('T', ' ')} UTC\n`;
  md += `**Repository:** ${filterRepo}\n`;
  md += `**Model:** ${MODEL}\n`;
  md += `**Total Cost:** $${totalCost.toFixed(4)}\n\n`;

  md += `## Key Findings\n\n`;
  md += `| Metric | Value |\n|---|---|\n`;
  md += `| Tasks evaluated | ${results.length} |\n`;
  md += `| Avg routing accuracy | ${avgRouting.toFixed(0)}% |\n`;
  md += `| Avg correctness | ${avgCorrectness.toFixed(2)}/5 |\n`;
  md += `| Avg file identification | ${avgFileId.toFixed(2)}/5 |\n`;
  md += `| Avg overall quality | ${avgOverall.toFixed(2)}/5 |\n`;
  md += `| Avg tokens used (2-step) | ${Math.round(avgTotalTokens).toLocaleString()} |\n`;
  md += `| Naive full-context tokens | ${naiveFullContextTokens.toLocaleString()} |\n`;
  md += `| Token savings vs naive | ${savingsVsNaive.toFixed(1)}% |\n\n`;

  md += `## Per-Task Results\n\n`;
  md += `| Task | Question (truncated) | Route% | Correctness | Overall | Cost |\n`;
  md += `|---|---|---|---|---|---|\n`;
  for (const r of results) {
    md += `| ${r.taskId} | ${r.question.slice(0, 60)}... | ${r.step1RoutingAccuracy}% | ${r.correctnessScore}/5 | ${r.qualityScore}/5 | $${r.totalCostUSD.toFixed(4)} |\n`;
  }

  md += `\n## Detailed Task Answers\n\n`;
  for (const r of results) {
    md += `### ${r.taskId}\n\n`;
    md += `**Question:** ${r.question}\n\n`;
    md += `**Files selected by routing:**\n${r.step1SelectedFiles.map(f => `- \`${f}\``).join('\n')}\n\n`;
    md += `**Routing accuracy:** ${r.step1RoutingAccuracy}%\n\n`;
    md += `**Answer:**\n${r.step2Answer}\n\n`;
    md += `**Scores:** Correctness ${r.correctnessScore}/5 | File ID ${r.fileIdScore}/5 | Overall ${r.qualityScore}/5\n\n`;
    md += `---\n\n`;
  }

  fs.writeFileSync(reportPath, md);

  console.log(`\n✅ Results saved:`);
  console.log(`   JSON: ${jsonPath}`);
  console.log(`   Report: ${reportPath}`);

  // ─── Verdict ──────────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(70)}`);
  console.log('🔬 VERDICT');
  console.log('═'.repeat(70));

  if (avgRouting >= 70 && avgOverall >= 3.5) {
    console.log(`\n✅ OUTCOME A — Hypothesis CONFIRMED`);
    console.log(`   Skeleton Mode successfully acts as a repository routing layer.`);
    console.log(`   ${avgRouting.toFixed(0)}% routing accuracy with ${avgOverall.toFixed(1)}/5 answer quality.`);
    console.log(`   LeanContext is not just a compression tool — it's a repository map.`);
  } else if (avgRouting >= 50 && avgOverall >= 3.0) {
    console.log(`\n⚠️  OUTCOME B — Partial confirmation`);
    console.log(`   Routing works for some query types but not all.`);
    console.log(`   ${avgRouting.toFixed(0)}% routing accuracy — needs refinement.`);
  } else {
    console.log(`\n❌ OUTCOME C — Hypothesis not confirmed`);
    console.log(`   Routing accuracy too low (${avgRouting.toFixed(0)}%) for reliable use.`);
    console.log(`   The manifest-based approach needs rethinking.`);
  }
  console.log('');
}

main().catch(err => { console.error(err); process.exit(1); });
