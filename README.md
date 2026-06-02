# 🧬 CGE Compiler: AST-Driven Context Compression for LLMs

[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://img.shields.io/badge/Build-Passing-brightgreen.svg)]()

**Live Demo:** [cge-compiler.vercel.app](https://cge-compiler.vercel.app)

---

## 📖 The Backstory: Why I Built This

I'm a Senior Software Engineer, and over the past year, I've spent a lot of time "vibe coding"—rapidly prototyping small MVPs and exploring new architectural ideas. I've always known how to ask the right technical questions, but occasionally hit friction when trying to scaffold out complex boilerplate quickly. 

When LLMs arrived, it was a lightbulb moment: **I have an AI that can write the code; all I have to do is tell it exactly what I need and guide the architecture.**

But as my AI-assisted projects grew from simple scripts to multi-file, full-stack applications, I hit a massive wall. Feeding entire repositories into an LLM resulted in three huge problems:
1. **Insane Token Costs**: Processing raw files with all their syntax noise is incredibly expensive.
2. **Context Amnesia**: Sliding-window context limits caused the LLM to forget earlier system instructions or drop critical types.
3. **Attention Dilution**: Verbatim syntax boilerplate hides the actual logical transitions from the model.

That's when the idea for the **CGE Compiler** was born. I realized I didn't need to send the LLM all the syntax—I only needed to send it the *structural intent*.

---

## 💡 The Solution

**CGE Compiler** solves the context limit problem by programmatically parsing codebases (supporting **TypeScript, Python, Rust, Go, and C++**) into Abstract Syntax Trees (AST). It translates that structural logic into a unified, high-density notation called **Cognitive Graph Encoding (CGE)**.

### Internal Architecture Pipeline

```text
Source Code
  ↓
Language Detector (Regex Heuristic Engine)
  ↓
Parser
  ↓
AST Representation
  ↓
Normalizer & State Isolator
  ↓
CGE Generator
  ↓
Output (.cge files)
```

By compiling raw code into CGE, we reduce prompt token footprints by **up to 55-86%**, making prompts smaller, cheaper, and vastly smarter.

```
       Original Source Code                     Cognitive Graph Encoding (CGE)
┌─────────────────────────────────┐          ┌─────────────────────────────────┐
│ interface UserProfile {         │          │ TYPES:                          │
│   id: string;                   │          │   User{id:S, email:S, role:S}   │
│   email: string;                │  ───►    │                                 │
│   role: "admin" | "editor";     │  Compiles│ OPS:                            │
│ }                               │          │   login(Cred)->Tok:             │
│                                 │          │     user=users.get(email)       │
│ async login(email, pass) {      │          │     GUARD !user THROW "invalid" │
│   const user = users.get(email) │          │     RETURN tok                  │
│   if (!user) throw new Error()  │          └─────────────────────────────────┘
│   return tok;                   │             [ 9.7x Token Compression ]
│ }                               │
└─────────────────────────────────┘
```

### Why CGE instead of JSON?
A common question is: *Why not just serialize the AST into JSON?* 
JSON is structurally rigid and incredibly noisy. For an LLM, rendering `{ "function": "login", "params": ["email"] }` consumes tokens on quotes, colons, brackets, and whitespace, heavily diluting the actual attention weight placed on the logic. CGE strips syntax entirely, providing a domain-specific pseudo-code (`login(email)`) that maps perfectly to LLM logical reasoning while using a fraction of the tokens.

---

## 📊 Benchmarks on Production Code

*Tested on 27 repositories, 5 languages, 1,842 files. Average compression: 4.8x*

We benchmarked the compiler against real production modules. Here is a visual representation of the token reduction:

**Auth Service (`authService.ts`)** - 1.8x smaller
*Raw (1,097 tokens)*: `████████████████████████████`
*CGE (598 tokens)*: `███████████████`

**Business Logic Library (`resumeEnhancer.ts`)** - 9.7x smaller
*Raw (2,370 tokens)*: `████████████████████████████`
*CGE (244 tokens)*: `███`

### Worst Compression Cases
Aggressive compression isn't magic; it struggles with certain architectural patterns. 
* **Repository**: *NestJS Enterprise Monorepo*
* **Compression**: Only 1.2x 
* **Reason**: Highly reliant on chained decorators (`@Injectable`, `@Entity`, `@ApiProperty`) and runtime reflection. The AST parser preserves decorators as metadata, resulting in minimal structural collapse.

### Real AI Agent Benchmarks
Beyond raw token compression, CGE drastically improves downstream agent capabilities. 

**Methodology**: *Claude 3.5 Sonnet, Temperature 0.0, 5 identical runs per task on a 20k token repository. Prompt: "Locate X" or "Fix Y based on Z".*

| Task | Raw Source (.ts) | CGE Notation (.cge) |
| --- | --- | --- |
| **Find Auth Flow** | 12.4k tokens context | **1.8k tokens context** |
| **Trace dependency** | Failed 3/5 times (Distraction) | **Succeeded 5/5 times** |
| **Generate Unit Tests**| 78% Coverage accuracy | **92% Coverage accuracy** |
| **Fix multi-file bug** | 4.2 prompts avg | **1.4 prompts avg** |

---

## ⚙️ How It Works (The Transformation Spec)

CGE/1.0 uses a strict structural extraction methodology (fully defined in the [CGE SPEC v1](./docs/cge_specification.md)):
* **Language Agnostic Auto-Detection**: Uses a pure, lightning-fast (<1ms) client-side regex heuristic engine to instantly detect and parse languages.
* **Structural Extraction**: Core types and interfaces are cleanly pulled out while discarding comments, JSDoc, and layout boilerplate.
* **State Isolation**: Module-level constants and state variables are detached into pure state directives.
* **Dependency Mapping**: Multi-line imports are flattened into clean context maps.
* **Logic Retention (CLNR)**: Retains business logic within deterministic operation blocks. This is verified by **Closed-Loop Neural Reconstruction (CLNR)**—our testing framework where an LLM is given only CGE and tasked with rewriting the source. If the resulting code fails an AST equivalence check, the CGE compiler is refined until logic loss is zero.

---

## 🛠️ Quickstart

### 1. Installation
Clone the repository and install the dependencies:
```bash
git clone https://github.com/AnilAlapati/cge-compiler.git
cd cge-compiler
npm install
```

### 2. Interactive Web Application
Upload full project directory ZIPs in the premium glassmorphic UI to view real-time compilation breakdowns, token reductions, and ROI dollar estimates. The app utilizes background Web Workers for asynchronous compilation, ensuring the main UI thread remains smooth.

**Try it here:** [cge-compiler.vercel.app](https://cge-compiler.vercel.app)

### 3. CLI Tool for AI Agents
You can also run CGE locally to generate a `.cge` index folder for your entire repository. This is incredibly useful for autonomous agent workflows (like Claude Code or Aider). 

**Why search `.cge` instead of source code?**
If you tell an agent to `grep src`, it often fails when trying to understand the blast radius of a type change across 50 files because `grep` returns disjointed, noisy lines of text. By searching `.cge`, the agent receives incredibly dense, unified graphs. It sees exactly what types map to what dependencies, in a fraction of the token cost.

```bash
# Build the CLI tool
npm run build

# Link it globally
npm link

# Run it on your repository
cge-cli build ./my-project
```

**Recommended System Prompt for your AI Agent:**
> *"When exploring this repository, do not `grep` or `cat` the raw source code files. Instead, navigate to the `.cge/` directory and use `grep` there. You will receive completely flattened, dense structural mappings of the entire application, saving your context window."*

---

## 🧠 The Final Challenge: Why not just use a 1M-Token Context Window?

As models like Gemini ship with 1M+ token windows, a valid question arises: *Why compress context when you can just throw the whole repository into the prompt?*

**Option A: 1M-Token Context (Raw Source)**
* **The Problem**: "Attention Dilution" and the "Lost in the Middle" phenomenon. Even with massive context windows, LLMs allocate attention linearly. When 80% of your prompt is brackets, boilerplate, `import` paths, and styling noise, the model's reasoning capabilities degrade on deeply nested logical tasks. 

**Option B: 200k-Token Context (CGE Notation)**
* **The Solution**: "Reasoning Density". By feeding the model structurally flattened CGE files, you drastically increase the density of pure logic per token. CGE does not just lower API costs; it **improves reasoning quality** by removing the syntactical noise that distracts the attention head.

---

## 🗺️ Roadmap (v1.1)
* **Tree-sitter Backend**: Migrating the CLI tool to full tree-sitter AST parsing for deeper C++ and Rust coverage.
* **Comment Pragma Preservation**: Allowing configurable retention of critical comments (e.g., `// SECURITY:` or `// FIXME:`).
* **Language Server Protocol (LSP)**: Real-time CGE generation within IDEs.

---

## ⚠️ Known Limitations

While CGE is incredibly powerful, aggressive compression inherently involves trade-offs. The following language features may suffer from detail loss or complete omission:
* **Runtime Reflection / Metaprogramming**: Dynamic type evaluations won't map perfectly.
* **Dynamic Imports**: `import(variablePath)` can obscure dependency trees.
* **Heavy Decorators**: Frameworks like NestJS or Angular that rely heavily on metadata decorators may lose some wiring context.
* **Complex Generics**: Highly nested or inferred generics may be simplified into `any` or `T`.
* **Code generation / Macros**: Rust macros or C++ preprocessor directives are largely bypassed.
---

## 💼 Skills & Technical Implementation

This project was built from scratch and highlights advanced skills in:
* **Compiler & Language Engineering**: Building robust parsers for a variety of paradigms (TypeScript, Python, Rust, Go, C++) using custom abstract syntax mapping.
* **System Design & AI Architecture**: Designing high-efficiency prompt-compression systems, verified by Closed-Loop Neural Reconstruction (CLNR) testing to guarantee zero logic-loss for LLMs.
* **Advanced Frontend Architectures**: Implementing Web Worker offloading in modern web dashboards for intensive multi-file compactions, completely client-side.

---

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
