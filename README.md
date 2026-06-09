# LeanContext: Smart Token Optimizer for LLMs

[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)

**Live Demo / Savings Calculator:** [cge-compiler.vercel.app](https://cge-compiler.vercel.app)

# CGE Compiler & LeanContext

This repository is an npm workspaces monorepo containing:
- `packages/leancontext-core`: The pure context transformation engine.
- `packages/leancontext-mcp`: The Model Context Protocol (MCP) server for LeanContext.
- `packages/leancontext-vscode`: The VS Code extension for LeanContext.

The original CGE compiler code is located in `src/`.

**LeanContext** (formerly LeanContext) reduces your LLM prompt token costs by up to 46% without sacrificing a single percentage point of architectural reasoning or code understanding. It works by surgically stripping comments, dead code, license boilerplate, and unnecessary whitespace before sending context to AI agents like Copilot, Cursor, or Gemini.

---

## ⚡ The Value Proposition: Before vs. After

LeanContext deletes the noise that LLMs don't need to read.

### Before (Raw Source)
```typescript
/**
 * Creates a user account and provisions default resources.
 * @param {Object} userData - The user's registration payload
 * @returns {Promise<UserRecord>}
 */
export async function createUser(userData: any) {
  // Validate the incoming payload
  if (!userData || !userData.email) {
    throw new Error("Invalid payload");
  }

  // const oldHandler = async () => {
  //   return db.users.insertLegacy(userData);
  // }
  // TODO: remove legacy handler code next sprint

  const user = await db.users.insert({
    email: userData.email,
    createdAt: new Date()
  });

  /*
    Provisioning default resources
    We give them a free tier workspace to start
  */
  await provisionWorkspace(user.id, "free_tier");

  return user;
}
```
**Tokens: 124**

### After (Optimized)
```typescript
export async function createUser(userData: any) {
  if (!userData || !userData.email) {
    throw new Error("Invalid payload");
  }
  const user = await db.users.insert({
    email: userData.email,
    createdAt: new Date()
  });
  await provisionWorkspace(user.id, "free_tier");
  return user;
}
```
**Tokens: 71**  
**Savings: 42.7%**

---

## 📊 Benchmarks: 0% Reasoning Degradation

We benchmarked LeanContext across a suite of massive, complex enterprise repositories spanning TypeScript, Python, and Java. 

For each repository, we challenged an LLM with rigorous architectural questions on both the raw source code and the optimized source code.

| Repository | Codebase Type | Token Savings | Reasoning Accuracy |
| :--- | :--- | :--- | :--- |
| **FastAPI** | Python Backend | **46.6%** | 100% |
| **Spring PetClinic** | Java Backend | **38.3%** | 100% |
| **Medusa** | TypeScript E-commerce | **37.2%** | 100% |
| **React-Admin** | TypeScript Frontend | **27.5%** | 100% |
| **Django** | Python Framework | **23.2%** | 100% |

**Conclusion:** Removing comments and documentation does *not* impair an LLM's ability to deduce logical flow or architectural design, but it massively reduces latency and API billing costs.

---

## 💰 The Enterprise Business Case

For engineering teams utilizing Claude 3.5 Sonnet or GPT-4o for daily development, context minification directly impacts the bottom line.

**Scenario:** 100 Developers | 500 prompts/day | 20,000 average context tokens

| Metric | Raw Code | Optimized Code (42% Avg Savings) |
| :--- | :--- | :--- |
| **Tokens per Day** | 10,000,000 | 5,800,000 |
| **Monthly Cost** ($5/1M) | ~$1,500 / mo | ~$870 / mo |

For larger context windows (e.g., passing 100,000 tokens of repository context to an agent):
- **Raw Cost:** $15,000 / month
- **Optimized Cost:** $8,700 / month
- **Direct Savings:** **$6,300 / month ($75,600 / year)**

---

## 🚀 VS Code Extension (Recommended)

The fastest and most frictionless way to use LeanContext is through our native VS Code Extension. It integrates directly into GitHub Copilot Chat as a Chat Participant.

### Installation
1. Download the latest `leancontext-0.2.2.vsix` from the `vscode-extension` directory.
2. Open VS Code -> Extensions Panel -> `...` (More Actions) -> **Install from VSIX...**
3. Select the `.vsix` file and reload your editor.

### Usage
Open any file in your editor, open Copilot Chat, and type:
> `@lc Can you review this code and suggest improvements?`

Behind the scenes, LeanContext intercepts the prompt, optimizes your active file, appends the optimized code to your question, and securely forwards it to the built-in Copilot Language Model.

#### Slash Commands for Granular Control
- `@lc /all` (Default): Strips everything (comments, JSDoc, dead code).
- `@lc /comments`: Strips ONLY inline and block comments.
- `@lc /docs`: Strips ONLY JSDoc and docstrings.
- `@lc /deadcode`: Strips ONLY disabled/commented-out code.
- `@lc /workspace`: Packages all supported workspace files (up to 500 files or 500k tokens), optimizing them in-place.
- `@lc /folder [relative-path] [prompt]`: Packages and optimizes a specific subdirectory.

#### Decoupled Audit Summary & Visual Proof
Every response ends with a token savings report:
> *⚡ LeanContext: Saved 28.5% (~452 tokens) on this request.* **`[Audit LeanContext]`** / **`[View Optimized Code]`**

- **View Optimized Code:** Opens a native **Split Diff Window** so you can visually verify exactly which lines were removed from the active file.
- **Audit LeanContext:** Launches a dual-panel inspector side-by-side. The left panel shows a Markdown summary (Context Window Usage % reduction, top folder token counts), and the right panel shows the raw XML context vs optimized XML context.

---

## ⚙️ Local Playground & Developer API

### Installation
```bash
git clone https://github.com/AnilAlapati/cge-compiler.git
cd cge-compiler
npm install
npm run build
```

### Running the Web Playground
Launch a local HTTP server in the root directory and open `index.html` to try LeanContext in your browser (drag-and-drop a zip of your project to calculate token savings immediately).

### Programmatic Usage (TypeScript)
You can integrate `LeanContextEngine` into your own node/web workflows:
```typescript
import { LeanContextEngine } from './src/leancontext/leancontext_engine';

const engine = new LeanContextEngine({
  stripLineComments: true,
  stripBlockComments: true,
  stripDocComments: true,
  stripDeadCode: true,
  normalizeNewlines: true
});

const result = engine.optimize(rawSourceCode, "typescript");
console.log(result.output); // Clean optimized code
console.log(`Saved ${result.savings.percentSaved}% tokens!`);
```

---

## 🧭 Project History: The Three Journeys

LeanContext is the culmination of extensive research into how LLMs read and comprehend source code. Our project journey spans three distinct ideas:

### Idea 1: Cognitive Graph Encoding (CGE) [Archived]
We initially attempted to create a custom, dense shorthand language (CGE) to compress code at the AST level. 
* **Learning:** We proved that aggressively mutating the syntax of a language destroys the metadata and decorators that LLMs rely on for context. Compression alone does not equal better reasoning.

### Idea 2: Repository Cognition [Active Research]
We shifted focus to extracting structural maps from codebases (Routes, Entity Relations, Middleware chains) to augment LLM reasoning.
* **Learning:** Supplying an LLM with an explicit Architecture Map alongside the source code consistently improves task success rates by 10-15%. This remains an active research track in the `src/architecture` modules.

### Idea 3: LeanContext (Product Candidate)
We realized the safest, most immediate way to optimize LLM performance was to leave the syntax completely alone, but strip the human-centric noise. 
* **Result:** LeanContext is our primary product focus, delivering 10-46% token savings instantly via the VS Code Extension and Web Playground.

---

## 📁 Repository Structure
```
cge-compiler/
├── src/
│   ├── leancontext/        # Core LeanContext engine
│   ├── cli/                # CGE CLI implementation (cge-cli)
│   └── architecture/       # Idea 2 (Repository Cognition) research code
├── vscode-extension/       # The Native Copilot Chat Participant Extension
├── scripts/                # Evaluation & benchmark runners
├── benchmarks_real/        # Benchmark output reports
├── index.html              # LeanContext Web UI
└── cge.html                # Legacy CGE Research UI
```
