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
  expected: string;
}

type Mode = 'raw' | 'arch' | 'raw_arch' | 'gen_arch' | 'raw_gen_arch';

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
    model: "gpt-4o-mini", // Using mini for fast benchmarking
    messages: [{ role: "user", content: prompt }],
    temperature: 0
  });
  return response.choices?.[0]?.message?.content || "";
}

async function getContextForMode(repoDir: string, mode: Mode): Promise<string> {
    let context = "";
    
    const readSource = () => {
        let srcContext = "";
        const srcDir = path.join(repoDir, 'source', 'src');
        if (!fs.existsSync(srcDir)) return "";
        const walk = (d: string) => {
            const files = fs.readdirSync(d);
            for (const file of files) {
                const fullPath = path.join(d, file);
                if (fs.statSync(fullPath).isDirectory()) {
                    walk(fullPath);
                } else if (fullPath.endsWith('.ts')) {
                    srcContext += `\n--- File: ${path.relative(repoDir, fullPath)} ---\n`;
                    srcContext += fs.readFileSync(fullPath, 'utf8') + "\n";
                }
            }
        };
        walk(srcDir);
        return srcContext;
    };
    
    const readArch = () => {
        const archPath = path.join(repoDir, 'ARCHITECTURE.md');
        if (!fs.existsSync(archPath)) return "";
        return `\n--- File: ARCHITECTURE.md ---\n${fs.readFileSync(archPath, 'utf8')}\n`;
    };

    const readGenArch = () => {
        const genArchPath = path.join(repoDir, 'source', 'GENERATED_ARCHITECTURE.md');
        if (!fs.existsSync(genArchPath)) return "";
        return `\n--- File: GENERATED_ARCHITECTURE.md ---\n${fs.readFileSync(genArchPath, 'utf8')}\n`;
    };

    if (mode === 'raw') {
        context = readSource();
    } else if (mode === 'arch') {
        context = readArch();
    } else if (mode === 'raw_arch') {
        context = readArch() + "\n" + readSource();
    } else if (mode === 'gen_arch') {
        context = readGenArch();
    } else if (mode === 'raw_gen_arch') {
        context = readGenArch() + "\n" + readSource();
    }
    
    return context;
}

async function main() {
    const repoName = 'nestjs-real';
    const repoDir = path.join(REAL_BENCHMARKS_DIR, repoName);
    const tasksPath = path.join(repoDir, 'tasks_phase2.json');
    if (!fs.existsSync(tasksPath)) {
        console.error("No tasks_phase2.json found");
        return;
    }
    
    const tasks: BenchmarkTask[] = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
    const modes: Mode[] = ['raw', 'arch', 'raw_arch', 'gen_arch', 'raw_gen_arch'];
    const results = { raw: 0, arch: 0, raw_arch: 0, gen_arch: 0, raw_gen_arch: 0 };
    
    // Store detailed failures for the Coverage Gap analysis
    const failures: Record<Mode, Array<{ task: BenchmarkTask; answer: string }>> = {
        raw: [],
        arch: [],
        raw_arch: [],
        gen_arch: [],
        raw_gen_arch: []
    };

    console.log(`Starting Phase 2 Validation Benchmark for ${repoName}...\n`);

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
                failures[mode].push({ task, answer });
            }
        }

        results[mode] = (correctCount / tasks.length) * 100;
        console.log(`  Result for [${mode}]: ${results[mode]}%\n`);
    }

    // Human Map Fidelity
    const fidelity = results.raw_gen_arch / (results.raw_arch || 1);

    let markdownReport = `# Phase 2 Validation Benchmark Results\n\n`;
    markdownReport += `Repository: **${repoName}** (RealWorld Example App)\n\n`;
    markdownReport += `## Performance Matrix\n\n`;
    markdownReport += `| Mode | Accuracy |\n`;
    markdownReport += `| ---- | -------- |\n`;
    markdownReport += `| Raw Only | ${results.raw}% |\n`;
    markdownReport += `| Human Map | ${results.arch}% |\n`;
    markdownReport += `| Human + Raw | ${results.raw_arch}% |\n`;
    markdownReport += `| Generated Map | ${results.gen_arch}% |\n`;
    markdownReport += `| Generated + Raw | ${results.raw_gen_arch}% |\n\n`;
    
    markdownReport += `## Human Map Fidelity\n\n`;
    markdownReport += `Conceptually: \`Generated + Raw / Human + Raw\` = **${(fidelity * 100).toFixed(1)}%**\n\n`;

    markdownReport += `## Coverage Gap Analysis (Failures in Generated + Raw)\n\n`;
    if (failures.raw_gen_arch.length === 0) {
        markdownReport += `🎉 **Zero failures! Generated + Raw achieved 100% accuracy.**\n`;
    } else {
        markdownReport += `| Question | Expected | Model Answer | Possible Missing Element in Generator |\n`;
        markdownReport += `| -------- | -------- | ------------ | ------------------------------------- |\n`;
        for (const f of failures.raw_gen_arch) {
            markdownReport += `| ${f.task.question} | ${f.task.expected} | ${f.answer.replace(/\n/g, ' ')} | *TBD - Compare generator output with human map* |\n`;
        }
    }

    markdownReport += `\n## Conclusion Signal\n\n`;
    
    if (results.raw_gen_arch >= 95) {
        markdownReport += `**STRONG SIGNAL (Success)** - The automatically generated map preserves the reasoning lift of the human map.`;
    } else if (results.raw_gen_arch >= 80) {
        markdownReport += `**EXTRACTION BOTTLENECK (Failure)** - The generator is missing critical context that the human included.`;
    } else {
        markdownReport += `**WEAK SIGNAL (Stop)** - Auto-generation does not provide useful reasoning lift.`;
    }

    fs.writeFileSync(path.join(REAL_BENCHMARKS_DIR, 'augmentation_report_phase2.md'), markdownReport);
    console.log(`Report generated at benchmarks_real/augmentation_report_phase2.md`);
}

main().catch(console.error);
