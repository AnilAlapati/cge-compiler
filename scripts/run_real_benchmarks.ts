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
const REAL_BENCHMARKS_DIR = path.join(__dirname, '..', 'benchmarks_real');

interface BenchmarkTask {
  id: string;
  question: string;
  expectedAnswer: string;
}

interface BenchmarkResult {
  accuracy: number;
  tokens: number;
}

type Mode = 'source' | 'ast' | 'summary' | 'cge';

async function evaluateAnswer(question: string, expected: string, modelAnswer: string): Promise<boolean> {
  const prompt = `You are a technical judge. 
Question: ${question}
Expected Answer: ${expected}
Model Answer: ${modelAnswer}

Did the Model Answer correctly identify the core facts from the Expected Answer?
Reply ONLY with "YES" or "NO".`;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    temperature: 0
  });

  return response.choices?.[0]?.message?.content?.trim() === "YES";
}

async function askAgent(context: string, question: string): Promise<{ answer: string, tokens: number }> {
  const prompt = `Context codebase:\n\n${context}\n\nQuestion: ${question}`;
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }]
  });
  return {
    answer: response.choices?.[0]?.message?.content || "",
    tokens: response.usage?.prompt_tokens || 0
  };
}

async function getContextForMode(repoDir: string, mode: Mode): Promise<string> {
    const dir = path.join(repoDir, mode);
    if (!fs.existsSync(dir)) return "";
    let context = "";
    const walk = (d: string) => {
        const files = fs.readdirSync(d);
        for (const file of files) {
            const fullPath = path.join(d, file);
            if (fs.statSync(fullPath).isDirectory()) {
                walk(fullPath);
            } else {
                context += `\n--- File: ${path.relative(dir, fullPath)} ---\n`;
                context += fs.readFileSync(fullPath, 'utf8') + "\n";
            }
        }
    };
    walk(dir);
    return context;
}

async function runRepoBenchmark(repoName: string): Promise<Record<Mode, BenchmarkResult>> {
    const repoDir = path.join(REAL_BENCHMARKS_DIR, repoName);
    const tasksPath = path.join(repoDir, 'tasks.json');
    if (!fs.existsSync(tasksPath)) return {} as any;
    
    const tasks: BenchmarkTask[] = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
    const results: Record<Mode, BenchmarkResult> = {
        source: { accuracy: 0, tokens: 0 },
        ast: { accuracy: 0, tokens: 0 },
        summary: { accuracy: 0, tokens: 0 },
        cge: { accuracy: 0, tokens: 0 },
    };

    const modes: Mode[] = ['source', 'ast', 'summary', 'cge'];

    for (const mode of modes) {
        console.log(`  Evaluating mode: ${mode}`);
        const context = await getContextForMode(repoDir, mode);
        let correctCount = 0;
        let totalTokens = 0;

        for (const task of tasks) {
            const { answer, tokens } = await askAgent(context, task.question);
            totalTokens += tokens;
            const isCorrect = await evaluateAnswer(task.question, task.expectedAnswer, answer);
            if (isCorrect) correctCount++;
        }

        results[mode].accuracy = (correctCount / tasks.length) * 100;
        results[mode].tokens = Math.round(totalTokens / tasks.length); // avg tokens per query
    }

    return results;
}

async function main() {
    const repos = ['express-real', 'nestjs-real', 'flask-real'];
    let markdownReport = `# Real-World Validation Benchmarks\n\n`;

    for (const repo of repos) {
        console.log(`\nRunning Benchmark for ${repo}...`);
        const results = await runRepoBenchmark(repo);

        markdownReport += `## ${repo}\n\n`;
        markdownReport += `| Representation | Accuracy | Avg Tokens |\n`;
        markdownReport += `| -------------- | -------- | ---------- |\n`;
        markdownReport += `| Raw Source     | ${results.source.accuracy}% | ${results.source.tokens} |\n`;
        markdownReport += `| AST Dump       | ${results.ast.accuracy}% | ${results.ast.tokens} |\n`;
        markdownReport += `| Semantic Summary| ${results.summary.accuracy}% | ${results.summary.tokens} |\n`;
        markdownReport += `| CGE            | ${results.cge.accuracy}% | ${results.cge.tokens} |\n\n`;

        const reasoningLift = results.cge.accuracy - results.source.accuracy;
        markdownReport += `**Reasoning Lift:** ${reasoningLift > 0 ? '+' : ''}${reasoningLift}%\n\n`;
    }

    fs.writeFileSync(path.join(REAL_BENCHMARKS_DIR, 'report.md'), markdownReport);
    console.log(`\nReport generated at benchmarks_real/report.md`);
}

main().catch(console.error);
