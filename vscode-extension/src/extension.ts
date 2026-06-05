import * as vscode from 'vscode';
import { MinifyEngine } from '../../src/minify/minify_engine';
import { encode } from 'gpt-tokenizer';

export function activate(context: vscode.ExtensionContext) {
  const participant = vscode.chat.createChatParticipant('leancontext.participant', async (request, context, response, token) => {
    
    // Determine engine options based on slash command
    const options = {
      stripLineComments: true,
      stripBlockComments: true,
      stripDocComments: true,
      stripDeadCode: true,
      normalizeNewlines: true,
      stripTrailingWhitespace: true,
      preserveTodos: false
    };

    if (request.command === 'comments') {
      options.stripDocComments = false;
      options.stripDeadCode = false;
    } else if (request.command === 'docs') {
      options.stripLineComments = false;
      options.stripBlockComments = false;
      options.stripDeadCode = false;
    } else if (request.command === 'deadcode') {
      options.stripLineComments = false;
      options.stripBlockComments = false;
      options.stripDocComments = false;
    }

    const engine = new MinifyEngine(options);
    
    // 1. Get the active editor file to minify
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      response.markdown('❌ I need an active file open to minify and analyze.');
      return;
    }

    response.progress('Minifying active file...');

    const document = editor.document;
    const rawCode = document.getText();
    const languageId = document.languageId;
    
    // 2. Minify the code
    const minifyResult = engine.minify(rawCode, languageId.includes('javascript') || languageId.includes('typescript') ? 'typescript' : 'python');
    const minCode = minifyResult.output;

    // 3. Compute token savings
    const rawTokens = encode(rawCode).length;
    const minTokens = encode(minCode).length;
    const savings = rawTokens - minTokens;
    const savingsPercent = rawTokens > 0 ? ((savings / rawTokens) * 100).toFixed(1) : "0.0";

    // 4. Construct the prompt for Copilot
    const copilotPrompt = `You are a helpful coding assistant. The user has asked the following question about their code.
The code provided below has been automatically minified (comments and dead code removed) to save tokens. It is functionally identical to their actual code.

User Question: ${request.prompt}

--- MINIFIED CODE [${document.fileName}] ---
\`\`\`${languageId}
${minCode}
\`\`\`
--------------------------------------------
Please answer their question based on this minified code.`;

    // 5. Select Copilot chat model
    let models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
    if (models.length === 0) {
      models = await vscode.lm.selectChatModels({ vendor: 'copilot' }); // Fallback to any Copilot model
    }
    if (models.length === 0) {
      models = await vscode.lm.selectChatModels({}); // Ultimate fallback: any LM available
    }

    const model = models[0];
    if (!model) {
      response.markdown('❌ Could not find ANY language model. Please ensure GitHub Copilot is installed, logged in, and active.');
      return;
    }

    response.progress('Sending optimized context to Copilot...');

    // 6. Send request to the model
    try {
      const messages = [
        vscode.LanguageModelChatMessage.User(copilotPrompt)
      ];

      const chatResponse = await model.sendRequest(messages, {}, token);

      // 7. Stream response back to the user
      for await (const chunk of chatResponse.text) {
        response.markdown(chunk);
      }

      // 8. Append the savings signature
      response.markdown(`\n\n---\n*⚡ LeanContext: Saved ${savingsPercent}% (~${savings} tokens) on this request.*`);
      
      // 9. Add a native button to view the diff
      response.button({
        command: 'leancontext.previewOptimized',
        title: 'View Minified Code'
      });

    } catch (err: any) {
      response.markdown(`\n\n❌ Error communicating with Copilot: ${err.message}`);
    }
  });

  participant.iconPath = new vscode.ThemeIcon('zap');

  // --- Add the Preview Provider for the Clickable Link ---
  const previewProvider = new (class implements vscode.TextDocumentContentProvider {
    private contentMap = new Map<string, string>();
    provideTextDocumentContent(uri: vscode.Uri): string {
      return this.contentMap.get(uri.toString()) || 'Error loading minified content.';
    }
    setContent(uri: vscode.Uri, content: string) {
      this.contentMap.set(uri.toString(), content);
    }
  })();
  const providerReg = vscode.workspace.registerTextDocumentContentProvider('leancontext', previewProvider);

  const previewCommand = vscode.commands.registerCommand('leancontext.previewOptimized', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    // Run minify again just for the preview
    const options = { stripLineComments: true, stripBlockComments: true, stripDocComments: true, stripDeadCode: true, normalizeNewlines: true, stripTrailingWhitespace: true, preserveTodos: false };
    const engineForPreview = new MinifyEngine(options);
    const minCode = engineForPreview.minify(editor.document.getText(), editor.document.languageId.includes('javascript') || editor.document.languageId.includes('typescript') ? 'typescript' : 'python').output;

    const originalUri = editor.document.uri;
    const minifiedUri = vscode.Uri.parse(`leancontext:${originalUri.path}.minified`);
    previewProvider.setContent(minifiedUri, minCode);

    await vscode.commands.executeCommand('vscode.diff', originalUri, minifiedUri, `Original ↔ Minified Context`);
  });

  context.subscriptions.push(participant, providerReg, previewCommand);
}

export function deactivate() {}
