import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { MinifyEngine } from '../src/minify/minify_engine';

dotenv.config();

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("Please set OPENAI_API_KEY");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: API_KEY });
const BENCHMARKS_DIR = path.join(__dirname, '..', 'benchmarks_massive');

// Exact same subsystems as task generation
const REPOS_SUBSYSTEMS: Record<string, string[]> = {
    'nestjs-realworld': ['src/article'],
    'medusa': ['packages/core/core-flows/src/customer'],
    'commerce': ['lib/shopify'],
    'react-admin': ['packages/ra-core/src/dataProvider'],
    'fastapi': ['fastapi/routing.py', 'fastapi/dependencies'],
    'django': ['django/core/handlers'],
    'spring-petclinic': ['src/main/java/org/springframework/samples/petclinic/owner'],
    'spring-framework': ['spring-webmvc/src/main/java/org/springframework/web/servlet/mvc/method'],
    'ripgrep': ['crates/ignore/src'],
    'fmt': ['include/fmt']
};

type Mode = 'raw' | 'conservative' | 'safe' | 'aggressive';

async function askAgent(context: string, question: string): Promise<string> {
    const prompt = `You are a senior software architect analyzing a specific subsystem of a repository.
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

async function evaluateAnswer(question: string, expected: string, modelAnswer: string): Promise<boolean> {
    const prompt = `You are a strict technical judge grading an AI's response to an architectural question.
Question: ${question}
Expected Knowledge: ${expected}
Model Answer: ${modelAnswer}

Perform a robust semantic comparison to decide if the Model Answer correctly and accurately identifies the core facts from the Expected Knowledge.

Please use the following rules:
1. Ignore markdown formatting, bullets vs numbering, list styles, and bold/italic markup.
2. Ignore ordering differences, case differences, and presentation styles.
3. If the Model Answer is semantically complete and contains the expected facts, answer YES.
4. If the Model Answer missed a crucial required fact or hallucinated incorrect information, answer NO.

Reply ONLY with "YES" or "NO".`;

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0
    });

    return response.choices?.[0]?.message?.content?.trim().toUpperCase() === "YES";
}

function getLanguageFromExtension(ext: string): string {
    switch(ext) {
        case '.ts': case '.tsx': case '.js': case '.jsx': return 'typescript';
        case '.py': return 'python';
        case '.rs': return 'rust';
        case '.go': return 'go';
        case '.cpp': case '.h': case '.hpp': return 'cpp';
        case '.java': return 'java';
        default: return 'typescript';
    }
}

function getContext(repoPath: string, targetPaths: string[], mode: Mode): { context: string, tokens: number } {
    let finalContext = "";
    let totalTokens = 0;

    let engine: MinifyEngine | null = null;
    if (mode === 'conservative') {
        engine = new MinifyEngine({ 
            stripLineComments: false, 
            stripBlockComments: false, 
            stripDocComments: false, 
            stripDeadCode: true,
            normalizeNewlines: true,
            stripTrailingWhitespace: true 
        });
    } else if (mode === 'safe') {
        engine = new MinifyEngine({ 
            stripLineComments: true, 
            stripBlockComments: true, 
            stripDocComments: false, 
            stripDeadCode: true,
            preserveTodos: true,
            normalizeNewlines: true,
            stripTrailingWhitespace: true 
        });
    } else if (mode === 'aggressive') {
        engine = new MinifyEngine({ 
            stripLineComments: true, 
            stripBlockComments: true, 
            stripDocComments: true, 
            stripDeadCode: true,
            preserveTodos: false,
            normalizeNewlines: true,
            stripTrailingWhitespace: true 
        });
    }

    const walk = (p: string) => {
        if (!fs.existsSync(p)) return;
        const stat = fs.statSync(p);
        if (stat.isDirectory()) {
            for (const file of fs.readdirSync(p)) {
                walk(path.join(p, file));
            }
        } else {
            const ext = path.extname(p);
            if (['.ts', '.js', '.py', '.java', '.rs', '.cpp', '.h', '.hpp'].includes(ext) && !p.includes('.test.') && !p.includes('.spec.')) {
                const rawCode = fs.readFileSync(p, 'utf8');
                const lang = getLanguageFromExtension(ext);
                
                let processedCode = rawCode;
                let tokens = Math.ceil(rawCode.length / 3.5);

                if (engine) {
                    const result = engine.minify(rawCode, lang);
                    processedCode = result.output;
                    tokens = result.minifiedTokens;
                }
                
                finalContext += `\n--- File: ${path.relative(repoPath, p)} ---\n`;
                finalContext += processedCode + "\n";
                totalTokens += tokens;
            }
        }
    };
    
    for (const target of targetPaths) {
        walk(path.join(repoPath, target));
    }
    
    return { context: finalContext, tokens: totalTokens };
}

async function main() {
    const modes: Mode[] = ['raw', 'conservative', 'safe', 'aggressive'];
    const summary: Record<string, Record<string, { accuracy: number, tokens: number }>> = {};

    for (const [repo, targetPaths] of Object.entries(REPOS_SUBSYSTEMS)) {
        const repoPath = path.join(BENCHMARKS_DIR, repo);
        const tasksPath = path.join(repoPath, 'tasks.json');
        
        if (!fs.existsSync(tasksPath)) {
            console.warn(`[SKIP] Missing tasks.json for ${repo}`);
            continue;
        }

        console.log(`\n======================================================`);
        console.log(`Evaluating Repository: ${repo}`);
        console.log(`======================================================`);

        const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
        summary[repo] = {};

        for (const mode of modes) {
            console.log(`\nMode: [${mode.toUpperCase()}]`);
            const { context, tokens } = getContext(repoPath, targetPaths, mode);
            console.log(`Context size: ~${tokens} tokens`);
            
            let correctCount = 0;
            for (const [idx, task] of Object.entries(tasks) as any) {
                process.stdout.write(`  Task ${Number(idx)+1}/${tasks.length}... `);
                const answer = await askAgent(context, task.question);
                const isCorrect = await evaluateAnswer(task.question, task.expectedAnswer, answer);
                if (isCorrect) {
                    correctCount++;
                    console.log(`✅`);
                } else {
                    console.log(`❌`);
                }
            }
            
            const accuracy = (correctCount / tasks.length) * 100;
            summary[repo][mode] = { accuracy, tokens };
            console.log(`  Score: ${accuracy}%`);
        }
    }

    // Generate Final Markdown Report
    const timestamp = new Date().toISOString();
    let report = `# AI Minify: 150-Evaluation Matrix Results\n`;
    report += `*Generated on: ${timestamp}*\n\n`;
    
    for (const mode of modes) {
        report += `## ${mode.toUpperCase()} MODE\n`;
        report += `| Repository | Accuracy | Tokens | Token Savings |\n`;
        report += `| ---------- | -------- | ------ | ------------- |\n`;
        
        let sumAcc = 0;
        let sumSavings = 0;
        let count = 0;

        for (const repo of Object.keys(summary)) {
            const repoSummary = summary[repo];
            if (!repoSummary) continue;
            
            const res = repoSummary[mode];
            const raw = repoSummary['raw'];
            if (!res || !raw) continue;
            
            const savingsPct = raw.tokens > 0 ? ((raw.tokens - res.tokens) / raw.tokens * 100) : 0;
            report += `| ${repo} | ${res.accuracy}% | ${res.tokens} | ${mode === 'raw' ? '-' : savingsPct.toFixed(1) + '%'} |\n`;
            
            sumAcc += res.accuracy;
            sumSavings += savingsPct;
            count++;
        }
        
        if (count > 0) {
            report += `| **AVERAGE** | **${(sumAcc/count).toFixed(1)}%** | - | **${(sumSavings/count).toFixed(1)}%** |\n\n`;
        }
    }

    fs.writeFileSync(path.join(BENCHMARKS_DIR, 'matrix_results.md'), report);
    console.log(`\n✅ Saved comprehensive report to benchmarks_massive/matrix_results.md`);
}

main().catch(console.error);
