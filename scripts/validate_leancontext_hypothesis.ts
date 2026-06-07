import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { LeanContextEngine } from '../src/leancontext/leancontext_engine';

dotenv.config();

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("Please set OPENAI_API_KEY");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: API_KEY });
const BENCHMARKS_DIR = path.join(__dirname, '..', 'benchmarks_real');

interface BenchmarkTask {
  id: string;
  question: string;
  expected: string;
}

type Mode = 'raw' | 'optimized_safe' | 'optimized_aggressive';

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

function getLanguageFromExtension(ext: string): string {
    switch(ext) {
        case '.ts': case '.tsx': case '.js': case '.jsx': return 'typescript';
        case '.py': return 'python';
        case '.rs': return 'rust';
        case '.go': return 'go';
        case '.cpp': case '.h': case '.hpp': return 'cpp';
        default: return 'typescript';
    }
}

async function getContextForMode(repoDir: string, mode: Mode): Promise<{ context: string, tokens: number }> {
    const sourceDir = path.join(repoDir, 'source');
    if (!fs.existsSync(sourceDir)) return { context: "", tokens: 0 };
    
    let engine: LeanContextEngine | null = null;
    if (mode === 'optimized_safe') {
        engine = new LeanContextEngine({ stripDocComments: false });
    } else if (mode === 'optimized_aggressive') {
        engine = new LeanContextEngine({ stripDocComments: true });
    }

    let finalContext = "";
    let totalTokens = 0;

    const walk = (d: string) => {
        const files = fs.readdirSync(d);
        for (const file of files) {
            const fullPath = path.join(d, file);
            if (fs.statSync(fullPath).isDirectory()) {
                const name = path.basename(fullPath);
                if (['node_modules', 'dist', 'build', 'client', 'frontend', 'test', 'e2e'].includes(name) || name.startsWith('.')) {
                    continue;
                }
                walk(fullPath);
            } else if (fullPath.endsWith('.ts') && !fullPath.includes('.spec.ts') && !fullPath.includes('.test.ts') && !fullPath.endsWith('.d.ts')) {
                const rawCode = fs.readFileSync(fullPath, 'utf8');
                const lang = getLanguageFromExtension(path.extname(fullPath));
                
                let processedCode = rawCode;
                let tokens = Math.ceil(rawCode.length / 3.5);

                if (engine) {
                    const result = engine.optimize(rawCode, lang);
                    processedCode = result.output;
                    tokens = result.optimizedTokens;
                }
                
                finalContext += `\n--- File: ${path.relative(repoDir, fullPath)} ---\n`;
                finalContext += processedCode + "\n";
                totalTokens += tokens;
            }
        }
    };
    walk(sourceDir);
    return { context: finalContext, tokens: totalTokens };
}

async function main() {
    const repo = 'messy-nestjs';
    const repoDir = path.join(BENCHMARKS_DIR, repo);
    const tasksPath = path.join(repoDir, 'tasks_phase2.json');
    
    if (!fs.existsSync(tasksPath)) {
        console.error(`Cannot find tasks at ${tasksPath}`);
        process.exit(1);
    }

    console.log(`\n======================================================`);
    console.log(`Phase 0 Validation Benchmark: LeanContext Hypothesis`);
    console.log(`Repository: ${repo}`);
    console.log(`======================================================\n`);

    const tasks: BenchmarkTask[] = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
    const modes: Mode[] = ['raw', 'optimized_safe', 'optimized_aggressive'];
    const results: Record<string, { accuracy: number, tokens: number }> = {};
    
    for (const mode of modes) {
        console.log(`\nEvaluating Mode: [${mode.toUpperCase()}]`);
        const { context, tokens } = await getContextForMode(repoDir, mode);
        console.log(`Context size: ~${tokens} tokens`);
        
        let correctCount = 0;

        for (const [idx, task] of Object.entries(tasks)) {
            process.stdout.write(`  Task ${Number(idx)+1}/${tasks.length}... `);
            const answer = await askAgent(context, task.question);
            const isCorrect = await evaluateAnswer(task.question, task.expected, answer);
            if (isCorrect) {
                correctCount++;
                console.log(`✅`);
            } else {
                console.log(`❌`);
            }
        }
        const accuracy = (correctCount / tasks.length) * 100;
        results[mode] = { accuracy, tokens };
        console.log(`  Result for [${mode}]: ${accuracy}% accuracy\n`);
    }

    console.log(`\n======================================================`);
    console.log(`FINAL REPORT`);
    console.log(`======================================================`);
    
    const timestamp = new Date().toISOString();
    let reportMarkdown = `# LeanContext: Phase 0 Validation Benchmark\n`;
    reportMarkdown += `*Generated on: ${timestamp}*\n\n`;
    reportMarkdown += `| Condition | Accuracy | Tokens | Savings |\n`;
    reportMarkdown += `| --------- | -------- | ------ | ------- |\n`;
    
    const rawTokens = results['raw']?.tokens || 0;

    for (const mode of modes) {
        const acc = results[mode]?.accuracy || 0;
        const toks = results[mode]?.tokens || 0;
        const savings = rawTokens > 0 ? ((rawTokens - toks) / rawTokens * 100).toFixed(1) : "0.0";
        const savingsStr = mode === 'raw' ? "-" : `${savings}%`;
        
        reportMarkdown += `| ${mode} | ${acc}% | ${toks} | ${savingsStr} |\n`;
    }

    console.log(reportMarkdown);
    fs.writeFileSync(path.join(repoDir, 'leancontext_validation_report.md'), reportMarkdown);
    console.log(`Saved report to benchmarks_real/messy-nestjs/leancontext_validation_report.md`);
}

main().catch(console.error);
