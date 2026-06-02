# Frequently Asked Questions (Engineering & Product)

This document addresses common technical and architectural questions regarding the design, implementation, and evaluation of the CGE Compiler.

---

## 1. How is success measured? (Evaluation Framework)

When an AI agent searches `.cge` files instead of raw `.ts` files, how do we know it actually helps? We evaluate CGE using the following metrics:

1. **Token Compression Ratio**: The raw mathematical reduction in token footprint (typically 55-86%).
2. **Task Success Rate**: Given a standard repository and a set of instructions (e.g., "Find the bug in the auth flow"), what percentage of the time does the LLM successfully complete the task with only `.cge` files versus raw source code?
3. **Closed-Loop Neural Reconstruction (CLNR) Score (`96.8% Average`)**: We take raw source code, compile it to CGE, and then prompt an LLM to rewrite the original source code using *only* the CGE. We then run a deep AST diff between the original and the AI-reconstructed code. The 96.8% score indicates that across our benchmark suite, 96.8% of structural logic nodes (loops, conditionals, state assignments) were perfectly reconstructed by the LLM, proving that CGE retains the critical cognitive architecture.

---

## 2. Is Regex really doing language detection?

Yes, the initial language detection and lightweight structural extraction in our client-side web application utilizes a **pure, lightning-fast regex heuristic engine**.

**Why not Tree-sitter?**
Tree-sitter is the industry standard for robust parsing, but it requires compiling WebAssembly bindings to run in the browser. For our immediate goal—a zero-dependency, instant-load, client-side web application—WASM introduced too much overhead and build complexity. Our regex engine operates in `<1ms` and correctly identifies language structures in ~95% of standard codebases. 

*Note: For the CLI agent tool, transitioning to a full Tree-sitter backend is on the roadmap to handle highly complex edge cases.*

---

## 3. How does C++ support work?

C++ parsing is notoriously difficult due to preprocessor macros (`#define`, `#ifdef`) and complex template metaprogramming. 

Currently, CGE uses a **Heuristic Extraction Parser** for C++. It does not run a full compiler frontend (like Clang). Instead, it scans for deterministic structural boundaries: classes, structs, method signatures, and standard includes. 
* **Supported**: Standard class hierarchies, method signatures, basic types.
* **Ignored**: Complex macro expansions, template metaprogramming heavily relying on SFINAE. 

---

## 4. How are imports handled?

A common question is whether dependency information survives. 

**Yes, it does.** Multi-line and destructured imports:
```ts
import {
  A,
  B as Banana,
  C
} from "foo";
```
Are flattened into dense context maps at the top of the CGE file:
```text
IMPORTS:
  foo: {A, Banana, C}
```
This ensures the LLM knows exactly where `Banana` originated from without spending tokens on whitespace and import syntax.

---

## 5. How are comments treated?

Comments present an interesting edge case. Some comments are useless boilerplate (`// increment count`), while others are critical (`// SECURITY: never expose token`).

**Current Policy:** By default, CGE aggressively strips standard comments and JSDoc to maximize token savings. The logic is that well-written code, when structurally extracted, should be self-documenting to an LLM.

**Future Roadmap:** We plan to introduce a "Pragma Preservation" flag that will retain comments prefixed with specific critical tags (e.g., `// TODO:`, `// FIXME:`, `// SECURITY:`).

---

## 6. How much information is actually lost? (Edge Cases)

We claim "near-zero" logic loss for standard structural logic. However, certain advanced language features intentionally become opaque to maximize compression:

* **Optional Chaining & Nullish Coalescing**: `const fn = users?.find(x => x.id === id)?.profile?.email;` will be preserved as a direct property access path, but the specific null-checks might be flattened depending on the parser depth.
* **React Hooks (`useEffect`)**: `useEffect` blocks are treated as standard `PRIVATE` operations. The dependency array is retained, but deeply nested closure logic may be summarized.
* **Class Decorators**: `@Injectable()` or `@Entity` are preserved as metadata flags on the type definition, but dynamic runtime decorator logic is stripped.
* **Advanced Generics**: Highly complex conditional types (`T extends U ? X : Y`) are often simplified to `any` or `T` to prevent syntax explosion.

Ultimately, CGE is designed to optimize *architectural comprehension* and *context limits*, not to serve as a perfectly reversible decompiler for every obscure edge case.
