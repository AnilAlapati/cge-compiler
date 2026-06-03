import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("Please set OPENAI_API_KEY in your environment or .env file.");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: API_KEY });
const BENCHMARKS_DIR = path.join(__dirname, '..', 'benchmarks');

interface Task {
  id: string;
  question: string;
  expectedAnswer: string;
}

interface BenchmarkResult {
  taskId: string;
  question: string;
  sourceAnswer: string;
  cgeAnswer: string;
  sourceTimeMs: number;
  cgeTimeMs: number;
  sourceTokens: number;
  cgeTokens: number;
}

async function readFileContext(dir: string): Promise<string> {
  let context = "";
  if (!fs.existsSync(dir)) return context;
  
  const walk = (currentDir: string) => {
    const files = fs.readdirSync(currentDir);
    for (const file of files) {
      const fullPath = path.join(currentDir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        walk(fullPath);
      } else {
        context += `\n--- File: ${file} ---\n`;
        context += fs.readFileSync(fullPath, 'utf8');
      }
    }
  };
  walk(dir);
  return context;
}

async function runInference(context: string, question: string): Promise<{ answer: string; timeMs: number, tokens: number }> {
  const prompt = `You are a helpful coding assistant. Answer the following question based on the provided codebase context.\n\nContext:\n${context}\n\nQuestion:\n${question}`;
  
  const start = Date.now();
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 150,
    });
    
    const timeMs = Date.now() - start;
    return { 
      answer: response.choices?.[0]?.message?.content || "", 
      timeMs, 
      tokens: response.usage?.total_tokens || 0 
    };
  } catch (error: any) {
    return { answer: `Error: ${error.message}`, timeMs: Date.now() - start, tokens: 0 };
  }
}

async function main() {
  const dirs = fs.readdirSync(BENCHMARKS_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && dirent.name !== 'node_modules')
    .map(dirent => dirent.name);
  
  const allResults: Record<string, BenchmarkResult[]> = {};

  for (const repo of dirs) {
    console.log(`\nEvaluating repository: ${repo}...`);
    const repoPath = path.join(BENCHMARKS_DIR, repo);
    const tasksFile = path.join(repoPath, 'tasks.json');
    
    if (!fs.existsSync(tasksFile)) {
      console.log(`Skipping ${repo}: No tasks.json found.`);
      continue;
    }

    const tasks: Task[] = JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
    const sourceContext = await readFileContext(path.join(repoPath, 'source'));
    const cgeContext = await readFileContext(path.join(repoPath, 'cge'));

    allResults[repo] = [];

    for (const task of tasks) {
      console.log(`  Task: ${task.question}`);
      
      const sourceRes = await runInference(sourceContext, task.question);
      const cgeRes = await runInference(cgeContext, task.question);

      allResults[repo].push({
        taskId: task.id,
        question: task.question,
        sourceAnswer: sourceRes.answer,
        cgeAnswer: cgeRes.answer,
        sourceTimeMs: sourceRes.timeMs,
        cgeTimeMs: cgeRes.timeMs,
        sourceTokens: sourceRes.tokens,
        cgeTokens: cgeRes.tokens,
      });
    }
  }

  // Generate Report
  let report = `# Agent Benchmark Suite Results\n\n`;
  report += `Date: ${new Date().toISOString()}\n\n`;

  for (const [repo, results] of Object.entries(allResults)) {
    report += `## Repository: ${repo}\n\n`;
    
    for (const res of results) {
      report += `### Q: ${res.question}\n`;
      report += `**Context Tokens**: Source (${res.sourceTokens}) vs CGE (${res.cgeTokens})\n`;
      report += `**Latency**: Source (${res.sourceTimeMs}ms) vs CGE (${res.cgeTimeMs}ms)\n\n`;
      report += `**Source Answer**:\n> ${res.sourceAnswer.split('\n').join('\n> ')}\n\n`;
      report += `**CGE Answer**:\n> ${res.cgeAnswer.split('\n').join('\n> ')}\n\n`;
      report += `---\n\n`;
    }
  }

  const reportPath = path.join(BENCHMARKS_DIR, 'report.md');
  fs.writeFileSync(reportPath, report);
  console.log(`\nBenchmark complete! Report written to ${reportPath}`);
}

main().catch(console.error);
