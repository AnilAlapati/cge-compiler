import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const BENCHMARKS_DIR = path.join(__dirname, '..', 'benchmarks_massive');

// Define the targeted subsystem for each repo to keep context size manageable
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

async function generateTasksForContext(repo: string, context: string) {
    const prompt = `You are a senior software architect. I am going to give you a specific subsystem of the '${repo}' repository.
    
Your task is to generate 5 complex, architectural questions about this specific code.
The questions should require understanding of:
- Internal logic and constraints (e.g. "Why does it do X instead of Y?")
- Data flow or routing (e.g. "What happens when X is passed to Y?")
- Domain-specific logic (e.g. "How does the tenant score get calculated?")

For each question, provide a detailed 'expectedAnswer' that represents the ground truth.

Return ONLY a valid JSON array of objects, with no markdown formatting or backticks:
[
  {
    "id": "${repo}-1",
    "question": "What happens when...",
    "expectedAnswer": "It first checks X, then calls Y..."
  }
]

Context:
${context}
`;

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2
    });

    let content = response.choices?.[0]?.message?.content?.trim() || "[]";
    if (content.startsWith('```json')) {
        content = content.replace(/^```json\n/, '').replace(/\n```$/, '');
    }
    return JSON.parse(content);
}

function getContext(repoPath: string, targetPaths: string[]): string {
    let context = "";
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
                context += `\n--- File: ${path.relative(repoPath, p)} ---\n`;
                context += fs.readFileSync(p, 'utf8') + "\n";
            }
        }
    };
    
    for (const target of targetPaths) {
        walk(path.join(repoPath, target));
    }
    
    // Hard cap at 50,000 characters to ensure we don't blow the context window
    return context.substring(0, 150000); 
}

async function main() {
    for (const [repo, targetPaths] of Object.entries(REPOS_SUBSYSTEMS)) {
        const repoPath = path.join(BENCHMARKS_DIR, repo);
        const tasksPath = path.join(repoPath, 'tasks.json');
        
        if (fs.existsSync(tasksPath)) {
            console.log(`[SKIP] Tasks already generated for ${repo}`);
            continue;
        }
        
        if (!fs.existsSync(repoPath)) {
            console.warn(`[WARN] Repo ${repo} not found. Did you run setup_10_repos.sh?`);
            continue;
        }

        console.log(`Generating 5 questions for ${repo}...`);
        const context = getContext(repoPath, targetPaths);
        
        if (context.trim() === "") {
            console.warn(`[WARN] No context found for ${repo} at ${targetPaths.join(', ')}`);
            continue;
        }

        try {
            const tasks = await generateTasksForContext(repo, context);
            fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));
            console.log(`✅ Saved 5 tasks for ${repo}`);
        } catch (e: any) {
            console.error(`❌ Failed to generate tasks for ${repo}:`, e.message);
        }
    }
}

main().catch(console.error);
