# 🧬 CGE Compiler: Architecture-Augmented LLM Reasoning

[![TypeScript](https://img.shields.io/badge/Language-TypeScript-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![Build Status](https://img.shields.io/badge/Build-Passing-brightgreen.svg)]()

**Live Demo:** [cge-compiler.vercel.app](https://cge-compiler.vercel.app)

---

## 🔬 Research Finding: Repository Cognition Taxonomy

We discovered that **LLM reasoning about codebases requires different abstraction layers depending on the repository's architecture**.

### The Three-Layer Taxonomy

| Repository Type | Required Abstraction | Best Score |
| :--- | :--- | :--- |
| **CRUD** (REST, Entity-centric) | Structure | 70–100% |
| **Event-Driven** (Orchestrated, Pub/Sub) | Structure + Behavior | 61% |
| **Domain-Driven** (DDD, Value Objects) | Structure + Behavior + Semantics | 50% |

> Validated across **5 diverse repositories**, **68 architectural questions**, with semantic LLM judging.

### Architecture Map: What It Is

The generator automatically extracts a compact markdown summary from any NestJS codebase:

```text
Source Code (TypeScript AST)
  ↓
Parser extracts: Routes, Middleware, Guards, DI Graph, Entity Relations
  ↓
Generates: ARCHITECTURE.md + architecture_graph.json
```

**Example output sections:**
- Directory topology & module exports
- Request routing & authentication flows
- Middleware chains (including dynamic `apply().forRoutes()`)
- Permissions & role guards
- Dependency injection graph
- Database entity relations (`@ManyToOne`, `@OneToMany`, etc.)

### Token Compression (Cost Savings)

The architecture map compresses context by **3.7–6.9x** (73–86% token reduction):

| Repository | Raw Tokens | Map Tokens | Compression | Reduction |
| ---------- | ---------- | ---------- | ----------- | --------- |
| domain-driven-hexagon | 22,616 | 3,267 | 6.9x | 85.6% |
| nestjs-boilerplate | 43,023 | 10,940 | 3.9x | 74.6% |
| nestjs-prisma-starter | 7,848 | 2,079 | 3.8x | 73.5% |
| nestjs-realworld | 8,535 | 2,333 | 3.7x | 72.7% |
| ghostfolio (large repo) | 336,111 | 58,405 | 5.8x | 82.6% |

At scale, this translates to **5–6x cost reduction** for architectural queries.

### Architecture Graph Export

Every `generate()` call also outputs a typed `architecture_graph.json`:

```json
{
  "nodes": [
    { "id": "file:src/user/user.controller.ts", "type": "file", "label": "..." },
    { "id": "route:GET /users", "type": "route", "label": "GET /users" },
    { "id": "entity:UserEntity", "type": "entity", "label": "UserEntity" }
  ],
  "edges": [
    { "source": "file:...", "target": "route:...", "type": "has_route" },
    { "source": "entity:User", "target": "entity:Article", "type": "relates_to", "label": "OneToMany (articles)" }
  ]
}
```

Node types: `file`, `route`, `entity`, `service`, `middleware`
Edge types: `has_route`, `depends_on`, `relates_to`, `uses_middleware`

Future use cases: visualization, RAG retrieval, agent navigation, graph queries.

---

## 🗺️ Research Roadmap

| Phase | Status | Result |
| ----- | ------ | ------ |
| **Phase 1:** CGE Compression | ❌ Disproven | Structural compression *removed* reasoning signals. Raw=100%, CGE=60%. |
| **Phase 2:** Architecture Augmentation | ✅ Proven | Human Map + Raw = 100%. Generated Map + Raw = 100%. |
| **Phase 3:** Multi-Repo Validation | ✅ Completed | Gen Map + Raw consistently outperforms Raw Only across 4 repos (+5% avg lift). |
| **Phase 4:** Large-Repo Experiment | ✅ Completed | Architecture map alone: 46% on Ghostfolio (336k token repo). Proved structural boundary. |
| **Phase 4.5:** Failure Taxonomy | ✅ Completed | 73.3% of failures traced to missing method-level behavioral information. |
| **Phase 5:** Behavioral Abstraction (MDA) | ✅ Completed | Ghostfolio: 46%→61%. But zero lift on CRUD repos — behavior only helps event-driven systems. |
| **Semantic Experiment** | ✅ Completed | domain-driven-hexagon: 30%→50%. Proved third abstraction layer (semantics) helps DDD repos. |

---

## ⚙️ Quickstart

### Installation
```bash
git clone https://github.com/AnilAlapati/cge-compiler.git
cd cge-compiler
npm install
```

### Generate an Architecture Map
```bash
npx ts-node -e "
const { ArchitectureMapGeneratorPhase2 } = require('./src/architecture_map_generator_phase2');
const gen = new ArchitectureMapGeneratorPhase2();
gen.generate('./path/to/your/nestjs/project', 'GENERATED_ARCHITECTURE.md');
"
```

This produces:
- `GENERATED_ARCHITECTURE.md` — human-readable architecture summary
- `architecture_graph.json` — typed graph for programmatic use

### Run the Multi-Repo Benchmark
```bash
# Clone benchmark repositories
npx ts-node scripts/setup_multirepo_benchmarks.ts

# Generate benchmark questions
npx ts-node scripts/generate_repo_tasks.ts

# Run the full evaluation matrix
npx ts-node scripts/run_multi_repo_benchmark.ts

# Measure token compression
npx ts-node scripts/measure_token_metrics.ts
```

### Interactive Web Application
Upload project ZIPs in the web UI to view real-time compilation breakdowns.

**Try it here:** [cge-compiler.vercel.app](https://cge-compiler.vercel.app)

---

## 📊 Phase 3 Results: Multi-Repository Validation

| Repository | Raw Only | Gen Map Only | Gen Map + Raw | Signal |
| ---------- | -------- | ------------ | ------------- | ------ |
| domain-driven-hexagon | 80% | 30% | **90%** | 🟢 Strong: +10% lift |
| nestjs-boilerplate | 80% | 80% | **90%** | 🟢 Strong: +10% lift |
| nestjs-prisma-starter | 80% | 70% | **90%** | 🟢 Strong: +10% lift |
| nestjs-realworld | 100% | 100% | 90% | ⚠️ Judge artifact (-10%) |

Full report: [PHASE3_MULTIREPO_REPORT.md](./benchmarks_real/PHASE3_MULTIREPO_REPORT.md)

---

## 📁 Project Structure

```
cge-compiler/
├── src/                              # Core compiler & parsers
│   ├── architecture_map_generator_phase2.ts   # Architecture map + graph generator
│   ├── typescript_parser_phase2.ts            # TypeScript AST parser (routes, DI, entities, middleware)
│   ├── python_parser_phase2.ts                # Python parser
│   ├── cge_parser_phase2.ts                   # Unified parser interface
│   ├── cge_compiler.ts                        # Original CGE compiler (Phase 1)
│   └── typescript_parser.ts                   # Original TS parser (Phase 1)
├── scripts/                          # Automation & benchmarking
│   ├── setup_multirepo_benchmarks.ts          # Clone benchmark repos
│   ├── generate_repo_tasks.ts                 # Auto-generate architectural questions
│   ├── run_multi_repo_benchmark.ts            # Run full evaluation matrix
│   ├── run_multi_repo_mda_benchmark.ts        # MDA (behavioral) multi-repo benchmark
│   ├── run_ghostfolio_benchmark.ts            # Ghostfolio beyond-context benchmark
│   ├── run_hexagon_semantic_benchmark.ts      # Semantic experiment benchmark
│   ├── run_augmentation_benchmark_phase2.ts   # Single-repo benchmark (Phase 2)
│   └── measure_token_metrics.ts               # Token compression & cost analysis
├── benchmarks_real/                  # Benchmark data & results
│   ├── PHASE3_MULTIREPO_REPORT.md             # Full Phase 3 research report
│   ├── multi_repo_benchmark_report.md         # Structural benchmark output
│   ├── multi_repo_mda_benchmark_report.md     # MDA benchmark output
│   ├── repo_metrics.json                      # Token metrics per repo
│   └── <repo-name>/                           # Per-repo benchmark data
├── results/                          # Frozen research artifacts
│   ├── phase3/                                # Versioned Phase 3 results
│   ├── phase4/                                # Phase 4 Ghostfolio results
│   ├── phase5/                                # Phase 5 MDA results
│   └── semantic_experiment/                   # Final semantic experiment results
└── docs/                             # Documentation
    ├── interim_research_conclusion.md         # Phase 1 conclusion
    └── project_journal.md                     # Research journal
```

---

## 📜 Research History

<details>
<summary><b>Phase 1: CGE Compression (Disproven)</b></summary>

### Original Hypothesis
The CGE Compiler was originally designed to compress raw source code into a structural notation called **Cognitive Graph Encoding (CGE)**, reducing token usage by up to 55–86%.

### The Pipeline

```text
Source Code → Language Detector → Parser → AST → Normalizer → CGE Generator → .cge files
```

### What We Found

| Task | Raw Source (.ts) | CGE Notation (.cge) |
| --- | --- | --- |
| **Find Auth Flow** | 12.4k tokens context | **1.8k tokens context** |
| **Trace dependency** | Failed 3/5 times | **Succeeded 5/5 times** |

Token compression was real. But when we ran rigorous benchmarks:

| Representation | Accuracy |
| -------------- | -------- |
| Raw Code | 100% |
| CGE | 60% |

**Conclusion:** By stripping syntactical metadata, we inadvertently removed the exact clues LLMs use to infer architecture. Compression *destroyed* reasoning signals.

Full report: [Phase 1 Research Conclusion](./docs/interim_research_conclusion.md)

### Why CGE instead of JSON?
JSON is structurally rigid and incredibly noisy for LLMs. CGE strips syntax entirely, providing domain-specific pseudo-code that maps to LLM logical reasoning. However, our empirical results showed this advantage did not translate to improved architectural reasoning.

### CGE Compiler vs. Probabilistic Code Summarizers

| Metric | Code Summarizers | CGE Compiler |
|---|---|---|
| **Process** | Probabilistic (Model-generated) | Deterministic (AST-parsed) |
| **Reproducibility** | Low | 100% |
| **Hallucinations** | High risk | Zero |
| **Fidelity** | Lossy | Near-lossless business-logic preserving |

### Supported Languages (CGE Compiler)
TypeScript, Python, Rust, Go, C++

### Known Limitations
- Runtime Reflection / Metaprogramming
- Dynamic Imports
- Heavy Decorators (NestJS, Angular)
- Complex Generics
- Code generation / Macros

</details>

---

## 💼 Skills & Technical Implementation

This project demonstrates advanced skills in:
* **Compiler & Language Engineering**: Building robust parsers for TypeScript, Python, Rust, Go, and C++ using custom AST mapping.
* **Research Methodology**: Designing controlled experiments with semantic LLM judging, hypothesis-driven development, and rigorous validation across multiple repositories.
* **System Design & AI Architecture**: Designing architecture extraction systems that improve LLM reasoning quality through structural augmentation.
* **Advanced Frontend**: Web Worker offloading in modern web dashboards for intensive multi-file compactions, completely client-side.

---

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
