# LeanContext (formerly AI Minify)

**LeanContext** is a VS Code Chat Participant that invisibly strips noise (comments, JSDoc, dead code) from your files before sending them to GitHub Copilot. 

Stop wasting your AI context window on boilerplate comments. **LeanContext reduces token usage by ~20-30% per file** without losing any of the code's reasoning or functionality.

## Features

- **The `@lc` Chat Participant:** Talk to Copilot exactly like you normally do, just start your prompt with `@lc`.
- **Zero Friction:** No need to copy/paste or manually delete comments. It all happens instantly behind the scenes.
- **Visual Proof:** Click the `[View Minified Code]` button at the bottom of any response to see a native Split Diff showing exactly what was removed.
- **Accurate Token Math:** Powered by `gpt-tokenizer`, know exactly how many tokens you saved on every request.

## Slash Commands (Granular Control)

By default, `@lc` aggressively strips inline comments, block comments, JSDoc, and disabled code. If you need Copilot to see your docs or comments, use these slash commands:

- `@lc /all` (Default): Strips everything.
- `@lc /comments`: Strips ONLY regular comments (preserves JSDoc).
- `@lc /docs`: Strips ONLY JSDoc and docstrings.
- `@lc /deadcode`: Strips ONLY commented-out disabled code.

## Usage Example

1. Open a messy, comment-heavy file in your editor.
2. Open the GitHub Copilot Chat panel.
3. Type: `@lc /all Can you review this code for me?`
4. Watch the tokens melt away.

## Privacy & Security

LeanContext minifies your code locally on your machine using blazing-fast Regular Expressions before securely forwarding it to the official `vscode.lm` Copilot API. Your data never leaves your editor except to go directly to your configured Copilot model.
