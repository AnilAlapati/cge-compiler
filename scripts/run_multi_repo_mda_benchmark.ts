import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { ArchitectureMapGeneratorPhase2 } from '../src/architecture_map_generator_phase2';

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

type Mode = 'raw' | 'gen_arch' | 'raw_gen_arch';

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

async function getContextForMode(repoDir: string, mode: Mode): Promise<string> {
    let context = "";
    
    const readSource = () => {
        let srcContext = "";
        const sourceDir = path.join(repoDir, 'source');
        if (!fs.existsSync(sourceDir)) return "";
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
                    srcContext += `\n--- File: ${path.relative(repoDir, fullPath)} ---\n`;
                    srcContext += fs.readFileSync(fullPath, 'utf8') + "\n";
                }
            }
        };
        walk(sourceDir);
        return srcContext;
    };

    const readGenArch = () => {
        const genArchPath = path.join(repoDir, 'source', 'GENERATED_ARCHITECTURE.md');
        if (!fs.existsSync(genArchPath)) return "";
        return `\n--- File: GENERATED_ARCHITECTURE.md ---\n${fs.readFileSync(genArchPath, 'utf8')}\n`;
    };

    if (mode === 'raw') {
        context = readSource();
    } else if (mode === 'gen_arch') {
        context = readGenArch();
    } else if (mode === 'raw_gen_arch') {
        context = readGenArch() + "\n" + readSource();
    }
    
    return context;
}

async function main() {
    const repos = fs.readdirSync(BENCHMARKS_DIR, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
        
    let overallMarkdown = `# Multi-Repository Architecture Benchmark Results (Phase 5 MDA)\n\n`;
    overallMarkdown += `| Repository | Gen Map (MDA) |\n`;
    overallMarkdown += `| ---------- | ------------- |\n`;

    const allFailures: Record<string, any[]> = {};

    for (const repo of repos) {
        if (['express-real', 'flask-real', 'nestjs-real', 'ghostfolio'].includes(repo)) {
            continue;
        }

        const repoDir = path.join(BENCHMARKS_DIR, repo);
        const tasksPath = path.join(repoDir, 'tasks_phase2.json');
        
        if (!fs.existsSync(tasksPath)) {
            console.warn(`[SKIP] No tasks_phase2.json found for ${repo}`);
            continue;
        }

        console.log(`\n==========================================`);
        console.log(`Benchmarking repository: ${repo} with MDA`);
        console.log(`==========================================\n`);

        // Force generate the Architecture Map to use Phase 5 MDA
        console.log(`Generating Architecture Map for ${repo}...`);
        const generator = new ArchitectureMapGeneratorPhase2();
        await generator.generate(path.join(repoDir, 'source'), 'GENERATED_ARCHITECTURE.md');
        console.log(`Map generated.`);

        const tasks: BenchmarkTask[] = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
        const modes: Mode[] = ['gen_arch'];
        const results = { gen_arch: 0 };
        const repoFailures: any[] = [];
        
        for (const mode of modes) {
            console.log(`Evaluating Mode: [${mode}]`);
            const context = await getContextForMode(repoDir, mode);
            let correctCount = 0;

            for (const [idx, task] of Object.entries(tasks)) {
                process.stdout.write(`  Task ${Number(idx)+1}/10... `);
                const answer = await askAgent(context, task.question);
                const isCorrect = await evaluateAnswer(task.question, task.expected, answer);
                if (isCorrect) {
                    correctCount++;
                    console.log(`✅`);
                } else {
                    console.log(`❌`);
                    if (mode === 'raw_gen_arch') {
                        repoFailures.push({ task, answer });
                    }
                }
            }
            results[mode] = (correctCount / tasks.length) * 100;
            console.log(`  Result for [${mode}]: ${results[mode]}%\n`);
        }

        overallMarkdown += `| ${repo} | ${results.gen_arch}% |\n`;
        if (repoFailures.length > 0) {
            allFailures[repo] = repoFailures;
        }
    }

    overallMarkdown += `\n## Coverage Gaps (Failures in Gen+Raw)\n\n`;
    for (const [repo, failures] of Object.entries(allFailures)) {
        overallMarkdown += `### ${repo}\n\n`;
        overallMarkdown += `| Question | Expected | Model Answer |\n`;
        overallMarkdown += `| -------- | -------- | ------------ |\n`;
        for (const f of failures) {
            overallMarkdown += `| ${f.task.question} | ${f.task.expected} | ${f.answer.replace(/\n/g, ' ')} |\n`;
        }
        overallMarkdown += `\n`;
    }

    fs.writeFileSync(path.join(BENCHMARKS_DIR, 'multi_repo_mda_benchmark_report.md'), overallMarkdown);
    console.log(`\nUnified report generated at benchmarks_real/multi_repo_mda_benchmark_report.md`);
}

main().catch(console.error);
