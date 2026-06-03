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
const BENCHMARKS_DIR = path.join(__dirname, '..', 'benchmarks_real');

async function getSourceContext(repoDir: string): Promise<string> {
    let srcContext = "";
    const sourceDir = path.join(repoDir, 'source');
    
    if (!fs.existsSync(sourceDir)) {
        console.warn(`No source directory found in ${repoDir}`);
        return "";
    }
    
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
}

async function generateTasks(repoName: string) {
    const repoDir = path.join(BENCHMARKS_DIR, repoName);
    const tasksPath = path.join(repoDir, 'tasks_phase2.json');
    
    if (fs.existsSync(tasksPath)) {
        console.log(`[SKIP] Tasks already exist for ${repoName}`);
        return;
    }
    
    console.log(`Generating tasks for ${repoName}...`);
    const sourceContext = await getSourceContext(repoDir);
    
    if (!sourceContext) {
        console.error(`Cannot generate tasks for ${repoName} - no source context.`);
        return;
    }
    
    // We truncate if it's absurdly large, but gpt-4o-mini has 128k context which usually handles medium repos.
    const truncatedContext = sourceContext.slice(0, 300000); // rough heuristic ~75k tokens max
    
    const prompt = `You are a Senior Software Architect. 
I am providing you with the full TypeScript source code of a NestJS backend repository.

Your task is to generate EXACTLY 10 highly specific "architectural questions" about this codebase.
These questions will be used to benchmark an AI's ability to reason about the system's architecture.

What makes a good architectural question:
1. It should ask about system-wide concepts, not local logic. (e.g., "What are all the protected routes?", "What is the dependency chain for X service?", "Which entities are related to User?")
2. The question must have a concrete, verifiable, factual answer based ONLY on the source code provided.
3. Include the expected answer. The expected answer should be a concise list of facts, routes, or entities.

Output EXACTLY a JSON array of 10 objects, with NO markdown formatting, NO \`\`\`json wrappers, just the raw array.
Format:
[
  {
    "id": "task_1",
    "question": "What middleware is applied to the /admin routes?",
    "expected": "AdminMiddleware"
  }
]

Repository Source Context:
${truncatedContext}`;

    console.log(`Waiting for OpenAI response for ${repoName}...`);
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
        });

        const content = response.choices?.[0]?.message?.content?.trim() || "[]";
        
        let jsonStr = content;
        if (jsonStr.startsWith("\`\`\`json")) {
            jsonStr = jsonStr.replace(/\`\`\`json/g, "").replace(/\`\`\`/g, "").trim();
        }

        const tasks = JSON.parse(jsonStr);
        if (!Array.isArray(tasks) || tasks.length === 0) {
            throw new Error("Invalid format returned by LLM");
        }

        fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));
        console.log(`[OK] Generated ${tasks.length} tasks for ${repoName} and saved to tasks_phase2.json`);
    } catch (e) {
        console.error(`[ERROR] Failed to generate tasks for ${repoName}:`, e);
    }
}

async function main() {
    const repos = fs.readdirSync(BENCHMARKS_DIR, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);
        
    for (const repo of repos) {
        // Skip express/flask/etc.
        if (repo === 'express-real' || repo === 'flask-real' || repo === 'nestjs-real') {
            continue;
        }
        await generateTasks(repo);
    }
    console.log('Task generation completed.');
}

main().catch(console.error);
