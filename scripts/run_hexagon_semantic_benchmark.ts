/**
 * run_hexagon_semantic_benchmark.ts
 *
 * Final semantic experiment: run Architecture-Only benchmark on domain-driven-hexagon
 * using the updated compiler with class properties, module provider resolution,
 * and APP_INTERCEPTOR detection.
 */

import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("Please set OPENAI_API_KEY");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: API_KEY });

const REPO_NAME = 'domain-driven-hexagon';
const BENCHMARKS_DIR = path.join(__dirname, '..', 'benchmarks_real');
const REPO_DIR = path.join(BENCHMARKS_DIR, REPO_NAME);
const SOURCE_DIR = path.join(REPO_DIR, 'source');
const TASKS_FILE = path.join(REPO_DIR, 'tasks_phase2.json');
const MAP_FILE = path.join(SOURCE_DIR, 'GENERATED_ARCHITECTURE.md');

interface BenchmarkTask {
  id: string;
  question: string;
  expected: string | string[];
}

async function evaluateAnswer(question: string, expected: string | string[], modelAnswer: string): Promise<boolean> {
  const expectedStr = Array.isArray(expected) ? expected.join(', ') : expected;
  const prompt = `You are a strict technical judge grading an AI's response to an architectural question.
Question: ${question}
Expected Knowledge: ${expectedStr}
Model Answer: ${modelAnswer}

Perform a robust semantic comparison to decide if the Model Answer correctly and accurately identifies the core facts from the Expected Knowledge.

Please use the following rules:
1. Ignore markdown formatting, bullets vs numbering, list styles, and bold/italic markup.
2. Ignore ordering differences, case differences, and presentation styles.
3. For route/list questions: treat answers as sets. Verify that all expected elements/routes exist in the model's response.
4. For dependency/relationship/graph questions: treat relationships as graph edges and ignore ordering.
5. If the Model Answer is semantically complete and contains the expected facts (even if formatted or grouped differently, or if it includes additional correct details), answer YES.
6. If the Model Answer missed a crucial required fact or hallucinated incorrect information, answer NO.

Reply ONLY with "YES" or "NO".`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0
  });

  return response.choices?.[0]?.message?.content?.trim().toUpperCase() === "YES";
}

async function askAgent(context: string, question: string): Promise<string> {
  const prompt = `You are a senior software architect. Analyze the provided codebase context and answer the question accurately.
Context:
${context}

Question: ${question}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0
  });
  return response.choices?.[0]?.message?.content || "";
}

async function main() {
    console.log(`\n==========================================`);
    console.log(`Final Semantic Experiment: ${REPO_NAME}`);
    console.log(`==========================================\n`);

    if (!fs.existsSync(TASKS_FILE)) {
        console.error(`Missing tasks file: ${TASKS_FILE}`);
        process.exit(1);
    }
    if (!fs.existsSync(MAP_FILE)) {
        console.error(`Missing architecture map: ${MAP_FILE}. Please generate it first.`);
        process.exit(1);
    }

    const tasks: BenchmarkTask[] = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf-8'));
    const mapContent = fs.readFileSync(MAP_FILE, 'utf-8');

    console.log(`Loaded ${tasks.length} questions and map (${mapContent.length} characters)`);
    console.log(`Evaluating Mode: [gen_arch] (Architecture Map Only)\n`);

    let correctCount = 0;
    const results: any[] = [];
    
    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        process.stdout.write(`  Task ${i + 1}/${tasks.length}... `);
        
        const answer = await askAgent(`\n--- File: GENERATED_ARCHITECTURE.md ---\n${mapContent}\n`, task.question);
        const expectedStr = Array.isArray(task.expected) ? task.expected.join(', ') : task.expected;
        const isCorrect = await evaluateAnswer(task.question, task.expected, answer);
        
        results.push({
            taskId: task.id,
            question: task.question,
            expected: expectedStr,
            actual: answer,
            passed: isCorrect
        });
        
        if (isCorrect) {
            correctCount++;
            console.log(`✅`);
        } else {
            console.log(`❌`);
        }
    }

    const accuracy = Math.round((correctCount / tasks.length) * 100);
    console.log(`  Result for [gen_arch]: ${accuracy}%\n`);

    // Save results
    const outDir = path.join(__dirname, '..', 'results', 'semantic_experiment');
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(path.join(outDir, 'hexagon_results.json'), JSON.stringify(results, null, 2));
    console.log(`Results saved to results/semantic_experiment/hexagon_results.json`);
    
    // Decision rule
    console.log(`\n--- Decision ---`);
    if (accuracy >= 60) {
        console.log(`🏆 EXCELLENT VALIDATION: ${accuracy}% (≥60%)`);
    } else if (accuracy >= 50) {
        console.log(`✅ STRONG VALIDATION: ${accuracy}% (≥50%)`);
    } else if (accuracy >= 40) {
        console.log(`⚠️  WEAK VALIDATION: ${accuracy}% (≥40%)`);
    } else {
        console.log(`❌ INSUFFICIENT: ${accuracy}% (<40%)`);
    }
    console.log(`Previous: 30% → Current: ${accuracy}% (Δ${accuracy - 30})`);
}

main().catch(console.error);
