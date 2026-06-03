import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const REAL_BENCHMARKS_DIR = path.join(__dirname, '..', 'benchmarks_real');

async function askAgent(context: string, question: string): Promise<string> {
  const prompt = `Context codebase:\n\n${context}\n\nQuestion: ${question}`;
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }]
  });
  return response.choices?.[0]?.message?.content || "";
}

async function analyzeFailures() {
    const repoName = 'nestjs-real';
    const repoDir = path.join(REAL_BENCHMARKS_DIR, repoName);
    const tasksPath = path.join(repoDir, 'tasks.json');
    const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));

    const cgeDir = path.join(repoDir, 'cge');
    let context = "";
    const files = fs.readdirSync(cgeDir, { recursive: true }) as string[];
    for (const file of files) {
        const fullPath = path.join(cgeDir, file);
        if (fs.statSync(fullPath).isFile()) {
            context += `\n--- File: ${file} ---\n`;
            context += fs.readFileSync(fullPath, 'utf8') + "\n";
        }
    }

    console.log(`Analyzing CGE Failures for ${repoName}...\n`);
    console.log(`=== CGE CONTEXT ===\n${context}\n===================\n`);

    for (const task of tasks) {
        console.log(`QUESTION: ${task.question}`);
        console.log(`EXPECTED: ${task.expectedAnswer}`);
        const answer = await askAgent(context, task.question);
        console.log(`CGE ANSWER:\n${answer}\n`);
        console.log(`--------------------------------------------------\n`);
    }
}

analyzeFailures().catch(console.error);
