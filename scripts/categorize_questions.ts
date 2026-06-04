import * as fs from 'fs';
import * as path from 'path';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const QUESTIONS_FILE = path.join(__dirname, '..', 'benchmarks_real', 'ghostfolio', 'ghostfolio_questions.json');

async function main() {
    const tasks = JSON.parse(fs.readFileSync(QUESTIONS_FILE, 'utf-8'));
    
    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        if (task.category) continue; // Skip if already categorized
        
        const prompt = `Categorize this architectural question into one of the following tags:
- Architecture (module relationships, high-level organization)
- Dependency (service interactions, DI)
- Data Flow (request paths, event systems)
- Business Logic (portfolio calculations, rules)
- Infrastructure (schedulers, jobs, caching)
- Data Model (entities, relationships, database)
- Security (authentication, authorization, guards)

Question: ${task.question}
Expected Answer: ${task.expected}

Reply ONLY with the exact tag name (e.g. "Data Flow" or "Security").`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [{ role: "user", content: prompt }],
            temperature: 0
        });
        
        const tag = response.choices?.[0]?.message?.content?.trim() || "Unknown";
        task.category = tag;
        console.log(`Tagged [${task.id}]: ${tag}`);
    }
    
    fs.writeFileSync(QUESTIONS_FILE, JSON.stringify(tasks, null, 2));
    console.log(`Updated ${QUESTIONS_FILE}`);
}

main().catch(console.error);
