# LeanContext — Code Review v1

**Date / Time:** 2026-06-10 10:01:29 IST
**Branch:** `feature/LeanContext_MCP_V1` (HEAD `67754f7`)
**Reviewer:** Claude (Opus 4.8)
**Scope:** `packages/leancontext-core`, `packages/leancontext-mcp`, `packages/leancontext-vscode`
**Method:** Gathered minified context via the `leancontext_context` MCP tool (`scope=folder`) on `packages/` and `src/`, then read the underlying TypeScript source directly. Bugs marked **VERIFIED** were reproduced with standalone Node scripts.

---

## 1. High-Level Architectural Assessment

LeanContext is a small, well-factored token-reduction pipeline split into three packages:

- **`leancontext-core`** — the engine. A 3-stage pipeline (`DeadCodeDetector` → `CommentStripper` → `WhitespaceNormalizer`) orchestrated by `LeanContextEngine.optimize()`, plus a `TokenEstimator` and an import-following `assembly.ts`.
- **`leancontext-mcp`** — an MCP stdio server exposing `leancontext_context` and `leancontext_stats`, with its own `file_discovery` walker and extension→language map.
- **`leancontext-vscode`** — a Chat Participant that packages the active file / folder / workspace and forwards optimized context to Copilot, with diff/audit preview.

**Strengths**

- Clean separation of concerns; each optimization stage is an independent, individually-toggleable class with a typed options interface merged via `LeanContextOptions`.
- Sensible monorepo layout with a shared core consumed by both the MCP server and the VS Code extension.
- The MCP server correctly logs to `stderr` (stdout is reserved for the protocol) and bounds discovery at `maxFiles=500`.
- The VS Code extension already uses a *real* tokenizer (`gpt-tokenizer`), and bounds work by both file count and a 500k-token ceiling.

**Weaknesses (architectural, detailed below)**

1. **Comment stripping is regex/state-machine based and only truly supports two grammars** (C-style and Python), yet the language maps route **8+ languages** plus Markdown/CSS/HTML/JSON through it. Several of those are silently corrupted (§3.2).
2. **Two different token-counting implementations** — a `length / 3.5` heuristic in core vs. real BPE in the extension — so the "savings" numbers the MCP tool *instructs the model to report to the user* are only rough estimates and disagree with the extension's figures (§3.6).
3. **No path sandboxing in the MCP server** — `path` is resolved and read with no confinement to a project root, enabling arbitrary file disclosure (§3.7).
4. **Module-level mutable cache** in `assembly.ts` makes the assembler stateful across calls — incorrect for a long-lived server process (§3.4).
5. **No unit tests inside the packages.** The repo root has many ad-hoc `test_*.js` scripts, but the core's fragile string-machine logic — exactly the kind of code that needs a regression suite — has none.

Overall: a promising, cleanly-structured tool whose *core competency (stripping)* is currently its least robust layer, and whose server surface needs security hardening before it is pointed at untrusted inputs.

---

## 2. Verified Bugs (reproduced)

### 2.1 🔴 HIGH — Python docstrings are corrupted into invalid syntax (default code path)
**File:** `comment_stripper.ts`, `stripPython()` lines 216–248.

When a triple-quoted string is found and `stripDocComments === false` (the **default**, and the path the MCP server uses), the branch sets `inString`/`stringChar` and appends the quotes **but never `continue`s or advances `i`**. Execution falls through to the single-quote handler (line 242), which overwrites `stringChar` with a single `"` and appends another quote.

```
INPUT:   def f():
             """This is a docstring."""
             return 42

OUTPUT:  def f():
             """"""This is a docstring."""   <-- 6 quotes, invalid Python
             return 42
```

**Impact:** Any Python file containing a docstring is emitted as syntactically invalid code through the default MCP pipeline — actively *harmful* to the downstream LLM, not just lossy. **VERIFIED.**

**Fix:** add `i += 3; continue;` at the end of the `!stripDocComments` branch (mirroring the `else` branch which correctly `continue`s).

### 2.2 🔴 HIGH — `//` inside `https://` (and CSS `url()`) eats the rest of the line
**File:** `comment_stripper.ts`, `stripCStyle()` line 111; **language routing:** `lang_map.ts` / `file_discovery.ts`.

`.md` → `markdown`, `.css` → `css`, `.html` → `html`, `.json` → `javascript` are all routed to `stripCStyle`, which treats **any** `//` as a line comment with no string/context guard outside quotes.

```
MARKDOWN: "See https://example.com/docs for info"  ->  "See https:"
CSS     : "a { background: url(http://cdn…/x.png); }" -> "a { background: url(http:"
```

**Impact:** Markdown, CSS and HTML content is silently truncated at the first `//`; HTML `<!-- -->` comments are never handled at all. These file types should not go through the C-style stripper. **VERIFIED.**

**Fix:** Don't route Markdown/CSS/HTML through `stripCStyle`. Either give them dedicated handling (CSS = `/* */` only; HTML = `<!-- -->`; Markdown = pass through or strip nothing) or exclude them from optimization and emit raw.

### 2.3 🟠 MEDIUM — Dead-code detector deletes legitimate prose comments
**File:** `dead_code_detector.ts`, `isLikelyCode()` + `codePatterns`.

The detector runs on raw lines and matches prefixes like `/^\s*return\b/`, `/^\s*if\s*\(/`. Ordinary explanatory comments that begin with those words are classified as "commented-out code" and dropped:

```
INPUT:   // return the user to the login page on failure
         // if (the cache is cold) we warm it lazily
         function foo(){}

OUTPUT:  function foo(){}     <-- both comments silently deleted
```

**Impact:** Silent loss of real, meaningful comments — exactly the documentation an LLM benefits from. **VERIFIED.**

**Fix:** Require stronger evidence before deletion (e.g. balanced brackets/terminators, multiple consecutive matching lines via the already-tracked `consecutiveCommentedCodeLines`, presence of `;`/`{`/`(` *and* an identifier), and skip if the comment reads like a sentence (trailing prose, no operators).

---

## 3. Additional Issues & Fragile Code (by inspection)

### 3.1 Comment stripper — edge cases
- **`inDocComment` is dead state** (lines 40, 97–98, 122–123): assigned but never read; decisions are made from the comment-string prefix in `shouldPreserveComment`. Remove it.
- **Empty block comment `/**/` breaks the machine** (line 121): `code[i+2] === '*'` misreads `/`,`*`,`*`,`/` as a doc-comment opener, skips to the final `/`, and never finds a `*/` terminator — swallowing the remainder of the file.
- **Nested template literals break** (line 132): backtick strings are treated as flat; an inner `` ` `` inside `${ … }` closes the outer template prematurely. `${}` interpolations are not parsed.
- **Regex detection misses keyword-led regexes** (lines 141–153): the preceding-char heuristic doesn't recognize `return /re/`, `typeof`, `case`, `in`, `of`, etc. (they end in an alphanumeric char), so those regexes are treated as division; and `/` inside a regex character class (`/[/]/`) closes the regex early.
- **Ruby is silently unsupported:** `.rb` → `ruby` falls into `stripCStyle`, so Ruby `#` line comments and `=begin/=end` blocks are never stripped (only the dead-code detector catches some `#` lines).

### 3.2 Language coverage is broader than the engine supports
`file_discovery.ts` / `lang_map.ts` accept `java, cs, php, rb, json, css, html, md` and map every non-Python language to the C-style machine. Only TS/JS/C/C++/Go/Rust are genuinely C-style-comment compatible. Markdown/CSS/HTML/Ruby are mishandled (§2.2, §3.1). Recommend an explicit allow-list of *optimizable* languages and raw pass-through for the rest.

### 3.3 `DeadCodeDetector.process()` is language-blind
It treats any line starting with `#` as a comment regardless of language. For C/C++/C# this collides with the preprocessor (`#define`, `#include`, `#region`, `#pragma`); a directive that matches a `codePatterns` entry could be deleted. It is also **not string-aware**, so a `//`- or `#`-leading line *inside a multi-line string/docstring* can be removed. Pass `language` in and skip preprocessor lines.

### 3.4 `assembly.ts` — stale module-level cache
`tsConfigPathsCache` / `tsConfigPathsLoaded` (lines 56–57) are module globals set on first call and **never reset**. In the long-lived MCP server, the first project's `tsconfig` `paths` are cached and incorrectly applied to every subsequent `assembleContext` call for a *different* `rootDir`. Make the cache per-invocation (or key it by `rootDir`).

Also in `assembly.ts`: `extractImports` is not string/comment-aware (will match `import` inside strings), and there is no per-file size cap when reading content into memory.

### 3.5 XML packaging is unescaped — boundary spoofing / prompt injection
`leancontext_engine.ts` (`processFiles`, `buildXmlPackage`) and the MCP `raw` path build `<file path="${path}">${content}</file>` with **no escaping**. A file whose content contains `</file>` followed by a forged `<file path="…">` can spoof file boundaries in the assembled context (a prompt-injection vector), and a path containing `"` breaks the attribute. Escape `path` (attribute) and either escape content or wrap it unambiguously (e.g. fenced markers + length, or CDATA-style delimiters).

### 3.6 Divergent token accounting
Core's `TokenEstimator` uses `ceil(length / 3.5)`; the extension uses real `gpt-tokenizer`. The MCP tool description *mandates* surfacing the savings stats to the user, but those numbers come from the rough heuristic and won't match reality (or the extension). Unify on a real tokenizer in core, or clearly label the MCP figures as estimates.

### 3.7 🔴 Security — MCP server has no path sandboxing (arbitrary file read)
`leancontext-mcp/src/index.ts` resolves `args.path` against cwd or accepts an absolute path with **no confinement**. A client can request `path: "/etc/…"`, `path: "../../…"`, or `scope: "assembly"` with crafted `../../../` relative imports, and the server will read and return file contents (any of the broad `VALID_EXTENSIONS`, incl. `.json`). This is information disclosure. Add a configurable workspace root and reject/clamp any resolved path that escapes it (`path.relative(root, resolved)` must not start with `..` and must not be absolute).

### 3.8 Security — no `.gitignore` / secrets filtering, symlink traversal
- `file_discovery.ts` packages **all** matching files including `config.json`, `credentials.json`, etc. (`.json` is in the allow-list) — these can be shipped to an external model. Respect `.gitignore` and skip sensitive filename patterns.
- `fs.statSync` follows symlinks; a directory symlink (or cycle) is traversed until `maxFiles` is hit. Use `lstat`/`realpath` and stay within the root.

### 3.9 VS Code extension
- **Wrong stripper for non-JS/TS in preview** (`extension.ts:292`): `languageId.includes('javascript'|'typescript') ? 'typescript' : 'python'` — a Rust/Go/C++ file previewed is run through the **Python** state machine. Map the real language instead.
- The 500-file limit and ignored-folder list are **duplicated** across `extension.ts`, `file_discovery.ts`, and `assembly.ts`. Centralize in core.
- `gatherFiles` ext parse via `lastIndexOf('.')` is brittle for dotless/`Makefile`-style names (works by accident). Prefer `path.extname`.

### 3.10 MCP API gaps
- `leancontext_context` exposes `scope: "assembly"` but `leancontext_stats` does not — inconsistent surface.
- No way to pass stripping options (e.g. `stripDocComments`) through the MCP tool; it always uses core defaults — which, combined with §2.1, means the server's default path is the one that corrupts Python docstrings.

---

## 4. Recommendations for Future Features

**Correctness / robustness (do first)**
1. Fix §2.1, §2.2, §2.3 — they cause silent data loss or invalid output on the default path.
2. Add a real unit-test suite to `leancontext-core` with a corpus per language (docstrings, regexes, template literals, URLs in MD/CSS, preprocessor directives) to lock down the string machine.
3. Replace per-language regex machines with **tree-sitter** (or per-language lexers). It already has robust grammars for all the languages in the map and would eliminate the entire class of string/comment/regex edge cases — this is the single highest-leverage architectural change.

**Security / safety**
4. Workspace-root sandbox for the MCP server (§3.7), `.gitignore`/secrets filtering (§3.8), and XML escaping (§3.5).
5. Per-file and total size caps with explicit truncation reporting in core (the extension does this; core/MCP don't).

**Product features**
6. Optional **signature-only / skeleton mode** (keep declarations, drop bodies) for very large repos — far bigger savings than comment stripping.
7. **Import-graph relevance ranking** in `assembly.ts` (depth + reference frequency) so the most-imported files are prioritized when hitting token ceilings.
8. **Caching keyed by file mtime/hash** so re-packaging an unchanged workspace is instant.
9. Honor a `.leancontextignore` and expose stripping options through the MCP tool (§3.10).
10. Unify token counting on a real tokenizer and report estimate vs. exact consistently across MCP and extension (§3.6).

---

### Verification appendix
- §2.1 reproduced: triple-quote `!stripDocComments` branch lacks `i += 3; continue;` → 6-quote output.
- §2.2 reproduced: `stripCStyle("See https://…")` → `"See https:"`; CSS `url(http://…)` → `url(http:`.
- §2.3 reproduced: prose comments beginning `return …` / `if (…)` deleted by `isLikelyCode`.
