# LeanContext MCP Validation & Bugfix Report

## Overview
This document summarizes the validation testing of the LeanContext MCP Server (`leancontext-mcp`) via Claude Code, and the critical parser bugs that were discovered and fixed during the process.

## MCP Validation Tests
The MCP server was successfully tested against the following scopes using Claude Code:
1. **Single File (`scope=file`)**: Accurately minified individual files and returned token savings.
2. **Folder (`scope=folder`)**: Successfully walked directories, ignoring `node_modules` and `dist`, and batched files without crashing the `stdio` stream.
3. **Assembly (`scope=assembly`)**: Successfully parsed imports and generated dependency graphs starting from a folder root (with an intentionally hardcoded depth of 1 to prevent token explosion).

## Critical Bugs Found & Fixed

### 1. Regex Literal Mangling
**Symptom:** Regex literals containing comment-like syntax (e.g., `/\/\*[\s\S]*?\*\//g`) were being mangled by the engine.
**Root Cause:** The `CommentStripper` lacked a state to track when it was inside a regex literal, causing it to blindly strip `/*` and `//` characters even if they were part of a regex.
**Fix:** Introduced an `inRegex` state machine. When the parser encounters a `/`, it looks backward to determine if the preceding non-whitespace character is a valid regex prefix (e.g., `=`, `(`, `,`). If so, it preserves the entire regex literal intact.

### 2. The "Ghost String" Truncation Leak
**Symptom:** Lines of code (like `if (trimmed.startsWith('//'))`) were being mysteriously truncated to `if (trimmed.startsWith('`.
**Root Cause:** The `CommentStripper` backward lookaround was scanning the *original unminified source string* instead of the *stripped result string*. 
- A stripped comment like `// Imports/Exports` would leave an `s` in the original string buffer.
- When evaluating if a `/` started a regex, the parser saw the `s` from the stripped comment and falsely assumed it was *not* a regex.
- Failing to enter regex mode caused the parser to misinterpret a `'` inside the regex as the start of a massive string literal.
- This "ghost string" stayed open until it hit the very next `'` character in the file (which happened to be inside the `startsWith('//')` check), terminating the string and allowing the subsequent `//` to trigger a catastrophic line comment deletion.
**Fix:** Updated the backward lookaround logic to scan the `result` array (which only contains post-strip characters). This ensures stripped comments no longer poison the parser's state evaluation.

### 3. LLM Token Stats Suppression
**Symptom:** Claude Code would occasionally omit the token savings statistics from its conversational output if the user asked a narrow question.
**Fix:** Injected a `CRITICAL` instruction directly into the MCP `leancontext_context` tool description:
> `"CRITICAL: You MUST always begin your response to the user by summarizing the token savings statistics provided in the 'stats' object..."`
This forces autonomous LLM clients to prioritize surfacing the token reduction ROI to the user.

## Deployment Status
- Fixes applied to `feature/MCP_v1`.
- Fixes backported to `feature/LeanContext_v1`.
- VS Code Extension bumped and packaged as `v0.2.4`.
- Source code successfully pushed to the new `LeanContext` GitHub repository.
