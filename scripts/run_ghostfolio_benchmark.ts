/**
 * run_ghostfolio_benchmark.ts
 *
 * Runs an Architecture-Only (gen_arch) benchmark on Ghostfolio.
 * It bypasses the raw code evaluation completely because the raw code
 * is too large for the context window (336k tokens).
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

const REPO_NAME = 'ghostfolio';
const BENCHMARKS_DIR = path.join(__dirname, '..', 'benchmarks_real');
const REPO_DIR = path.join(BENCHMARKS_DIR, REPO_NAME);
const SOURCE_DIR = path.join(REPO_DIR, 'source');
const QUESTIONS_FILE = path.join(REPO_DIR, 'ghostfolio_questions.json');
const MAP_FILE = path.join(SOURCE_DIR, 'GENERATED_ARCHITECTURE.md');

async function evaluateAnswer(question: string, expected: string, modelAnswer: string): Promise<boolean> {
  const prompt = `You are a strict technical judge grading an AI's response to an architectural question.
Question: ${question}
Expected Knowledge: ${expected}
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
    console.log(`Benchmarking repository: ${REPO_NAME}`);
    console.log(`==========================================\n`);

    if (!fs.existsSync(QUESTIONS_FILE)) {
        console.error(`Missing questions file: ${QUESTIONS_FILE}`);
        process.exit(1);
    }
    if (!fs.existsSync(MAP_FILE)) {
        console.error(`Missing architecture map: ${MAP_FILE}. Please generate it first.`);
        process.exit(1);
    }

    const tasks = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf-8'));
    const mapContent = fs.readFileSync(MAP_FILE, 'utf-8');

    console.log(`Loaded ${tasks.length} questions and map (${mapContent.length} characters)`);
    console.log(`Evaluating Mode: [gen_arch] (Architecture Map Only)\n`);

    const genArchResults: any[] = [];
    let correctCount = 0;
    
    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        process.stdout.write(`  Task ${i + 1}/${tasks.length}... `);
        
        const answer = await askAgent(`\n--- File: GENERATED_ARCHITECTURE.md ---\n${mapContent}\n`, task.question);
        const isCorrect = await evaluateAnswer(task.question, task.expected, answer);
        
        genArchResults.push({
            taskId: task.id,
            question: task.question,
            expected: task.expected,
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

    // Output detailed JSON results for CSV formatting
    const outPath = path.join(__dirname, '..', 'results', 'phase5', 'raw_benchmark_output.json');
    if (!fs.existsSync(path.dirname(outPath))) {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
    }
    fs.writeFileSync(outPath, JSON.stringify(genArchResults, null, 2));
    
    // Also generate CSV automatically
    const csvLines = ['Question,Expected,Actual,Correct?,Confidence,Failure Type,Notes'];
    genArchResults.forEach((res: any) => {
        const q = tasks.find((t: any) => t.id === res.taskId)?.question || '';
        const exp = tasks.find((t: any) => t.id === res.taskId)?.expected || '';
        const escapeCSV = (str: string) => `"${str.replace(/"/g, '""')}"`;
        csvLines.push(`${escapeCSV(q)},${escapeCSV(exp)},${escapeCSV(res.actual)},${res.passed},,,,`);
    });
    fs.writeFileSync(path.join(__dirname, '..', 'results', 'phase5', 'ghostfolio_results.csv'), csvLines.join('\n'));
    console.log(`Results saved to results/phase5/ghostfolio_results.csv`);
}

main().catch(console.error);
