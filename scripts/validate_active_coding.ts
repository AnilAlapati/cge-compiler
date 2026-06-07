import * as fs from 'fs';
import * as path from 'path';
import { LeanContextEngine } from '../src/leancontext/leancontext_engine';
import Anthropic from '@anthropic-ai/sdk';

/**
 * LeanContext - 10-Task Validation Benchmark
 * Model: Claude Haiku 4.5 (cheapest available)
 * 
 * Measures: Success, Input Tokens, Output Tokens, Cost, Latency
 */

const MODEL = "claude-haiku-4-5-20251001";

// Haiku 4.5 pricing (per million tokens)
const INPUT_COST_PER_M = 1.00;   // $1/M input
const OUTPUT_COST_PER_M = 5.00;  // $5/M output

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || ""
});

interface CodingTask {
  id: number;
  name: string;
  filePath: string;
  instruction: string;
}

const TASKS: CodingTask[] = [
  // --- Controllers (Feature additions) ---
  {
    id: 1,
    name: "Add GET /count endpoint",
    filePath: 'source/src/article/article.controller.ts',
    instruction: 'Add a new GET endpoint at path "count" that calls this.articleService.getArticleCount(userId) using the @User("id") decorator to extract the userId.'
  },
  {
    id: 2,
    name: "Add DELETE user by email",
    filePath: 'source/src/user/user.controller.ts',
    instruction: 'Add a new DELETE endpoint at "users/email/:email" that calls this.userService.delete(email) to delete a user by their email address.'
  },
  {
    id: 3,
    name: "Add GET followers list",
    filePath: 'source/src/profile/profile.controller.ts',
    instruction: 'Add a new GET endpoint at ":username/followers" that calls this.profileService.getFollowers(username) and returns a list of followers.'
  },
  // --- Services (Bug fixes & feature additions) ---
  {
    id: 4,
    name: "Fix update - null check",
    filePath: 'source/src/user/user.service.ts',
    instruction: 'In the "update" method, add a null check: if the user (toUpdate) is not found, throw an HttpException with status 404 and message "User not found".'
  },
  {
    id: 5,
    name: "Add getArticleCount method",
    filePath: 'source/src/article/article.service.ts',
    instruction: 'Add a new method "getArticleCount(authorId: number)" that uses this.articleRepository.count({ where: { authorId } }) to return the number of articles by that author.'
  },
  {
    id: 6,
    name: "Fix favorite duplicate check",
    filePath: 'source/src/article/article.service.ts',
    instruction: 'In the "favorite" method, after checking isNewFavorite, add an else branch that throws an HttpException with message "Article already favorited" and status HttpStatus.BAD_REQUEST.'
  },
  {
    id: 7,
    name: "Add password hashing to update",
    filePath: 'source/src/user/user.service.ts',
    instruction: 'In the "update" method, if dto contains a password field, hash it using argon2.hash(dto.password) before saving. Import argon2 is already present.'
  },
  // --- Middleware & cross-cutting ---
  {
    id: 8,
    name: "Add token expiry check",
    filePath: 'source/src/user/auth.middleware.ts',
    instruction: 'After decoding the JWT token, check if the token is expired by comparing decoded.exp with Date.now()/1000. If expired, throw an HttpException with message "Token expired" and HttpStatus.UNAUTHORIZED.'
  },
  // --- Services (complex logic) ---
  {
    id: 9,
    name: "Add article search by tag",
    filePath: 'source/src/article/article.service.ts',
    instruction: 'Add a new method "findByTag(tag: string): Promise<ArticlesRO>" that queries articles where tagList contains the given tag using the QueryBuilder, similar to how findAll filters by tag.'
  },
  {
    id: 10,
    name: "Add self-follow prevention",
    filePath: 'source/src/profile/profile.service.ts',
    instruction: 'In the "follow" method, before creating the follow record, check if followingUser.id equals followerUser.id. The check already exists for email but add a redundant ID check that throws HttpException with "Cannot follow yourself" and HttpStatus.BAD_REQUEST.'
  }
];

const engine = new LeanContextEngine({
  stripLineComments: true,
  stripBlockComments: true,
  stripDocComments: true,
  stripDeadCode: true,
  normalizeNewlines: true,
  stripTrailingWhitespace: true,
  preserveTodos: false
});

interface TaskResult {
  id: number;
  name: string;
  rawInputTokens: number;
  rawOutputTokens: number;
  rawLatencyMs: number;
  rawPass: boolean;
  minInputTokens: number;
  minOutputTokens: number;
  minLatencyMs: number;
  minPass: boolean;
  tokenSavingsPercent: string;
}

async function callClaude(code: string, instruction: string): Promise<{text: string, inputTokens: number, outputTokens: number, latencyMs: number}> {
  const prompt = `You are an expert NestJS/TypeScript developer. Modify the provided source code to fulfill the instruction.
Instruction: ${instruction}

Source Code:
\`\`\`typescript
${code}
\`\`\`

Output ONLY the complete modified source file wrapped in \`\`\`typescript ... \`\`\` codeblocks. Do not explain anything.`;

  const start = Date.now();
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }]
  });
  const latencyMs = Date.now() - start;

  return {
    text: (msg.content[0] as any).text,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
    latencyMs
  };
}

async function judgePatch(rawPatch: string, minPatch: string, instruction: string): Promise<{rawPass: boolean, minPass: boolean}> {
  const prompt = `You are a strict code reviewer judging TWO code patches.
  
Instruction that both patches attempted: ${instruction}

=== PATCH A (Raw Context) ===
${rawPatch}

=== PATCH B (Minified Context) ===
${minPatch}

For EACH patch, decide if it correctly implements the instruction.
Answer in this exact format (no other text):
PATCH_A: PASS or FAIL
PATCH_B: PASS or FAIL`;

  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 50,
    messages: [{ role: "user", content: prompt }]
  });

  const answer = (msg.content[0] as any).text.toUpperCase();
  return {
    rawPass: answer.includes('PATCH_A: PASS') || (answer.includes('PATCH_A') && answer.includes('PASS')),
    minPass: answer.includes('PATCH_B: PASS') || (answer.split('PATCH_B')[1]?.includes('PASS') ?? false)
  };
}

async function main() {
  console.log(`\n🧪 LeanContext — 10-Task Validation Benchmark`);
  console.log(`Model: ${MODEL}`);
  console.log(`Repository: messy-nestjs`);
  console.log(`Mode: Aggressive (strip all comments, docs, dead code)\n`);
  console.log(`${'='.repeat(70)}\n`);

  const results: TaskResult[] = [];
  const basePath = path.resolve(__dirname, '../benchmarks_real/messy-nestjs');

  for (const task of TASKS) {
    const filePath = path.resolve(basePath, task.filePath);
    let rawCode: string;
    try {
      rawCode = fs.readFileSync(filePath, 'utf-8');
    } catch {
      console.log(`⚠️ Skipping Task #${task.id}: File not found at ${filePath}`);
      continue;
    }

    const minified = engine.optimize(rawCode, 'typescript');
    const minCode = minified.output;

    console.log(`[Task #${task.id}] ${task.name}`);
    console.log(`  File: ${task.filePath}`);
    console.log(`  Raw chars: ${rawCode.length} | Minified chars: ${minCode.length}`);

    try {
      // Run Raw
      process.stdout.write(`  → Raw patch...  `);
      const rawResult = await callClaude(rawCode, task.instruction);
      console.log(`${rawResult.latencyMs}ms (in: ${rawResult.inputTokens}, out: ${rawResult.outputTokens})`);

      // Run Minified
      process.stdout.write(`  → Min patch...  `);
      const minResult = await callClaude(minCode, task.instruction);
      console.log(`${minResult.latencyMs}ms (in: ${minResult.inputTokens}, out: ${minResult.outputTokens})`);

      // Judge
      process.stdout.write(`  → Judging...    `);
      const verdict = await judgePatch(rawResult.text, minResult.text, task.instruction);
      console.log(`Raw=${verdict.rawPass ? '✅' : '❌'} Min=${verdict.minPass ? '✅' : '❌'}`);

      const savings = ((rawResult.inputTokens - minResult.inputTokens) / rawResult.inputTokens * 100).toFixed(1);

      results.push({
        id: task.id,
        name: task.name,
        rawInputTokens: rawResult.inputTokens,
        rawOutputTokens: rawResult.outputTokens,
        rawLatencyMs: rawResult.latencyMs,
        rawPass: verdict.rawPass,
        minInputTokens: minResult.inputTokens,
        minOutputTokens: minResult.outputTokens,
        minLatencyMs: minResult.latencyMs,
        minPass: verdict.minPass,
        tokenSavingsPercent: savings
      });

      console.log(`  → Token Savings: ${savings}%\n`);
    } catch (err: any) {
      console.error(`  ❌ API Error: ${err.message}\n`);
    }
  }

  // === SUMMARY ===
  console.log(`\n${'='.repeat(70)}`);
  console.log(`📊 FINAL RESULTS`);
  console.log(`${'='.repeat(70)}\n`);

  const rawPassed = results.filter(r => r.rawPass).length;
  const minPassed = results.filter(r => r.minPass).length;
  const totalRawIn = results.reduce((s, r) => s + r.rawInputTokens, 0);
  const totalMinIn = results.reduce((s, r) => s + r.minInputTokens, 0);
  const totalRawOut = results.reduce((s, r) => s + r.rawOutputTokens, 0);
  const totalMinOut = results.reduce((s, r) => s + r.minOutputTokens, 0);
  const totalRawCost = (totalRawIn / 1_000_000 * INPUT_COST_PER_M) + (totalRawOut / 1_000_000 * OUTPUT_COST_PER_M);
  const totalMinCost = (totalMinIn / 1_000_000 * INPUT_COST_PER_M) + (totalMinOut / 1_000_000 * OUTPUT_COST_PER_M);
  const avgRawLatency = Math.round(results.reduce((s, r) => s + r.rawLatencyMs, 0) / results.length);
  const avgMinLatency = Math.round(results.reduce((s, r) => s + r.minLatencyMs, 0) / results.length);

  // Print task-level table
  console.log(`| # | Task                         | Raw    | Min    | Savings | Raw  | Min  |`);
  console.log(`|---|------------------------------|--------|--------|---------|------|------|`);
  results.forEach(r => {
    console.log(`| ${r.id} | ${r.name.padEnd(28)} | ${String(r.rawInputTokens).padStart(6)} | ${String(r.minInputTokens).padStart(6)} | ${r.tokenSavingsPercent.padStart(5)}%  | ${r.rawPass ? ' ✅ ' : ' ❌ '} | ${r.minPass ? ' ✅ ' : ' ❌ '} |`);
  });

  console.log(`\n--- Aggregate ---`);
  console.log(`| Metric          | Raw          | Minified     | Delta          |`);
  console.log(`|-----------------|--------------|--------------|----------------|`);
  console.log(`| Tasks Passed    | ${rawPassed}/${results.length}          | ${minPassed}/${results.length}          |                |`);
  console.log(`| Input Tokens    | ${totalRawIn.toLocaleString().padStart(12)} | ${totalMinIn.toLocaleString().padStart(12)} | ${((totalRawIn - totalMinIn) / totalRawIn * 100).toFixed(1)}% saved    |`);
  console.log(`| Output Tokens   | ${totalRawOut.toLocaleString().padStart(12)} | ${totalMinOut.toLocaleString().padStart(12)} |                |`);
  console.log(`| Total Cost      | $${totalRawCost.toFixed(4).padStart(11)} | $${totalMinCost.toFixed(4).padStart(11)} | $${(totalRawCost - totalMinCost).toFixed(4)} saved |`);
  console.log(`| Avg Latency     | ${String(avgRawLatency).padStart(9)}ms | ${String(avgMinLatency).padStart(9)}ms |                |`);

  // Write markdown report
  const report = `# LeanContext: 10-Task Validation Benchmark

**Model:** ${MODEL}
**Date:** ${new Date().toISOString()}
**Repository:** messy-nestjs
**Mode:** Aggressive (strip all comments, docs, dead code)

## Per-Task Results

| # | Task | Raw Tokens | Min Tokens | Savings | Raw Result | Min Result |
|---|------|-----------|-----------|---------|-----------|-----------|
${results.map(r => `| ${r.id} | ${r.name} | ${r.rawInputTokens} | ${r.minInputTokens} | ${r.tokenSavingsPercent}% | ${r.rawPass ? '✅ Pass' : '❌ Fail'} | ${r.minPass ? '✅ Pass' : '❌ Fail'} |`).join('\n')}

## Aggregate

| Metric | Raw | Minified | Delta |
|--------|-----|----------|-------|
| Tasks Passed | ${rawPassed}/${results.length} | ${minPassed}/${results.length} | |
| Input Tokens | ${totalRawIn.toLocaleString()} | ${totalMinIn.toLocaleString()} | ${((totalRawIn - totalMinIn) / totalRawIn * 100).toFixed(1)}% saved |
| Output Tokens | ${totalRawOut.toLocaleString()} | ${totalMinOut.toLocaleString()} | |
| Total Cost | $${totalRawCost.toFixed(4)} | $${totalMinCost.toFixed(4)} | $${(totalRawCost - totalMinCost).toFixed(4)} saved |
| Avg Latency | ${avgRawLatency}ms | ${avgMinLatency}ms | |

## Conclusion

${minPassed >= rawPassed ? '✅ LeanContext produces equivalent coding outcomes while reducing input token costs.' : '⚠️ Optimization degraded some task outcomes. Further investigation needed.'}
`;

  const reportPath = path.resolve(basePath, 'validation_benchmark_report.md');
  fs.writeFileSync(reportPath, report);
  console.log(`\n📄 Report saved to: ${reportPath}`);
}

main().catch(console.error);
