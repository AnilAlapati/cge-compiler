# LeanContext

**LeanContext** is a VS Code Chat Participant that invisibly strips noise (comments, JSDoc, dead code) from your files or workspace before sending them to GitHub Copilot. 

Stop wasting your AI context window on boilerplate comments and blank lines. **LeanContext reduces token usage by ~20-30% per file** without losing any of the code's reasoning, structure, or functionality.

## Features

- **The `@lc` Chat Participant:** Talk to Copilot exactly like you normally do, just start your prompt with `@lc`.
- **Zero Friction:** No need to copy/paste or manually delete comments. It all happens instantly behind the scenes.
- **Accurate Token Math:** Powered by `gpt-tokenizer`, know exactly how many tokens you saved on every request.
- **Visual Proof & Decoupled Audit:** Review context changes based on your query scope:
  - **Single File Mode:** Click `[View Optimized Code]` at the bottom of the response to open a native VS Code **Split Diff** comparing your original code and the optimized context.
  - **Workspace & Folder Mode:** Click `[Audit LeanContext]` to launch a **Dual-Pane Inspector** side-by-side. The left pane shows a Markdown summary (Context Window Usage % reduction, token savings, and top folders), while the right pane displays the raw XML context vs optimized XML context diff.

## Slash Commands (Granular Control)

By default, `@lc` aggressively strips inline comments, block comments, JSDoc, and disabled code. If you need Copilot to see your docs or comments, or want to send entire subfolders or workspaces, use these slash commands:

- `@lc /all` (Default): Strips everything from the active file.
- `@lc /comments`: Strips ONLY regular comments (preserves JSDoc).
- `@lc /docs`: Strips ONLY JSDoc and docstrings.
- `@lc /deadcode`: Strips ONLY commented-out disabled code.
- `@lc /workspace`: Packages the entire workspace (ignoring build folders like `node_modules` or `dist`), applies optimization in-place, and feeds it to Copilot. Safe-guarded by a 500-file and 500k-token limit.
- `@lc /folder [relative-path] [prompt]`: Packages a specific subdirectory in your workspace and applies optimization.

## Usage Example

1. Open a messy, comment-heavy file in your editor.
2. Open the GitHub Copilot Chat panel.
3. Type: `@lc /all Can you review this code for me?`
4. Watch the tokens melt away.

To package and audit an entire folder:
1. Open the Copilot Chat panel.
2. Type: `@lc /folder src/auth Explain how authentication is handled.`
3. Click the `[Audit LeanContext]` button at the bottom of the response to see the token metrics and code diff side-by-side.

## Privacy & Security

LeanContext optimizes your code locally on your machine using blazing-fast regular expressions before securely forwarding it to the official `vscode.lm` Copilot API. Your data never leaves your editor except to go directly to your configured Copilot model.
