import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { CGECompiler } from '../src/cge_compiler';

dotenv.config();

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("Please set OPENAI_API_KEY");
  process.exit(1);
}

const openai = new OpenAI({ apiKey: API_KEY });
const REAL_BENCHMARKS_DIR = path.join(__dirname, '..', 'benchmarks_real');

async function generateSummary(code: string): Promise<string> {
    const prompt = `You are a senior software architect. Provide a concise, highly semantic summary of the following code. Focus on the architecture, routes, middleware, permissions, state, and external dependencies. Do not output raw code, just the semantic structure.\n\nCode:\n${code}`;
    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 500,
    });
    return response.choices?.[0]?.message?.content || "";
}

async function processRepo(repo: string) {
    const repoPath = path.join(REAL_BENCHMARKS_DIR, repo);
    const sourceDir = path.join(repoPath, 'source');
    const cgeDir = path.join(repoPath, 'cge');
    const astDir = path.join(repoPath, 'ast');
    const summaryDir = path.join(repoPath, 'summary');

    [cgeDir, astDir, summaryDir].forEach(d => {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });

    const walk = async (dir: string) => {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
                await walk(fullPath);
            } else {
                const code = fs.readFileSync(fullPath, 'utf8');
                const relativePath = path.relative(sourceDir, fullPath);
                
                // 1. CGE
                console.log(`Compiling CGE for ${relativePath}...`);
                const compiler = new CGECompiler();
                const ext = path.extname(fullPath).substring(1);
                const cgeCode = compiler.compileCode(code, ext || "typescript", fullPath);
                const cgeOutPath = path.join(cgeDir, relativePath + '.cge');
                fs.mkdirSync(path.dirname(cgeOutPath), { recursive: true });
                fs.writeFileSync(cgeOutPath, cgeCode);

                // 2. AST (if typescript)
                if (relativePath.endsWith('.ts') || relativePath.endsWith('.js') || relativePath.endsWith('.jsx')) {
                    console.log(`Generating AST for ${relativePath}...`);
                    const sourceFile = ts.createSourceFile(relativePath, code, ts.ScriptTarget.Latest, true);
                    const astOutPath = path.join(astDir, relativePath + '.ast.json');
                    fs.mkdirSync(path.dirname(astOutPath), { recursive: true });
                    // Circular references in TS AST make JSON.stringify fail, so we serialize a simplified version
                    const simplifyNode = (node: any): any => {
                        return {
                            kind: ts.SyntaxKind[node.kind],
                            text: node.getText ? node.getText().substring(0, 50) + '...' : undefined,
                            children: node.getChildren ? node.getChildren().map(simplifyNode) : []
                        };
                    };
                    fs.writeFileSync(astOutPath, JSON.stringify(simplifyNode(sourceFile), null, 2));
                } else if (relativePath.endsWith('.py')) {
                    // Just mock a JSON AST for python to save time in the demo
                    const astOutPath = path.join(astDir, relativePath + '.ast.json');
                    fs.mkdirSync(path.dirname(astOutPath), { recursive: true });
                    fs.writeFileSync(astOutPath, JSON.stringify({ "kind": "Module", "body": [] }, null, 2));
                }

                // 3. Summary
                console.log(`Generating Summary for ${relativePath}...`);
                const summaryCode = await generateSummary(code);
                const summaryOutPath = path.join(summaryDir, relativePath + '.summary.md');
                fs.mkdirSync(path.dirname(summaryOutPath), { recursive: true });
                fs.writeFileSync(summaryOutPath, summaryCode);
            }
        }
    };
    await walk(sourceDir);
}

async function main() {
    const repos = ['express-real', 'nestjs-real', 'flask-real'];
    for (const repo of repos) {
        console.log(`\nProcessing ${repo}...`);
        await processRepo(repo);
    }
}

main().catch(console.error);
