import * as vscode from 'vscode';
import { MinifyEngine } from '../../src/minify/minify_engine';
import { encode } from 'gpt-tokenizer';

const IGNORED_FOLDERS = ['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'target', 'out', 'vendor'];
const VALID_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.cpp', '.h', '.hpp', '.cs', '.php', '.rb', '.md', '.json', '.css', '.html'];
const extensionToLanguage: Record<string, string> = {
  "ts": "typescript", "tsx": "typescript", "js": "javascript", "jsx": "javascript",
  "py": "python", "rs": "rust", "go": "go", "cpp": "cpp", "h": "cpp", "hpp": "cpp",
  "cs": "csharp", "php": "php", "rb": "ruby", "md": "markdown", "json": "json", "css": "css", "html": "html"
};

async function gatherFiles(uri: vscode.Uri, filePaths: vscode.Uri[]) {
  if (filePaths.length >= 500) return;
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if ((stat.type & vscode.FileType.Directory) !== 0) {
      const entries = await vscode.workspace.fs.readDirectory(uri);
      for (const [name, type] of entries) {
        if (IGNORED_FOLDERS.includes(name)) continue;
        await gatherFiles(vscode.Uri.joinPath(uri, name), filePaths);
        if (filePaths.length >= 500) return;
      }
    } else if ((stat.type & vscode.FileType.File) !== 0) {
      const ext = uri.path.substring(uri.path.lastIndexOf('.')).toLowerCase();
      if (VALID_EXTENSIONS.includes(ext)) {
        filePaths.push(uri);
      }
    }
  } catch (e) {
    // Ignore stat errors (e.g., permission denied, broken symlinks)
  }
}

async function buildContextString(uris: vscode.Uri[], options: any, progressCallback?: (msg: string) => void): Promise<{ xmlOutput: string, processedCount: number, savingsPercent: string, savings: number, totalOrigTokens: number, totalMinTokens: number, folderStats: Map<string, number> }> {
  const engine = new MinifyEngine(options);
  let xmlOutput = "";
  let totalOrigTokens = 0;
  let totalMinTokens = 0;
  let processedCount = 0;
  
  const folderStats = new Map<string, number>();

  for (let i = 0; i < uris.length; i++) {
    if (processedCount >= 500) break; // Hard limit on files
    if (totalOrigTokens >= 500000) break; // Hard limit on tokens

    const uri = uris[i];
    try {
      const rawCodeArr = await vscode.workspace.fs.readFile(uri);
      const rawCode = new TextDecoder().decode(rawCodeArr);
      
      const ext = uri.path.split('.').pop()?.toLowerCase() || '';
      const lang = extensionToLanguage[ext] || "javascript";
      
      const minCode = engine.minify(rawCode, lang).output;
      const origTokens = encode(rawCode).length;
      const minTokens = encode(minCode).length;
      
      if (totalOrigTokens + origTokens > 500000) {
        if (progressCallback) progressCallback('Workspace packaging reached the 500k token limit. Output has been truncated.');
        break;
      }

      totalOrigTokens += origTokens;
      totalMinTokens += minTokens;
      
      const relativePath = vscode.workspace.asRelativePath(uri, false);
      const dirPath = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '/';
      
      folderStats.set(dirPath, (folderStats.get(dirPath) || 0) + minTokens);
      
      xmlOutput += `<file path="${relativePath}">\n${minCode}\n</file>\n\n`;
      processedCount++;
      
      if (progressCallback) progressCallback(`Minifying file ${processedCount} of ${uris.length}...`);
    } catch (e) {
      // Skip unreadable files
    }
  }

  const savings = totalOrigTokens - totalMinTokens;
  const savingsPercent = totalOrigTokens > 0 ? ((savings / totalOrigTokens) * 100).toFixed(1) : "0.0";

  return { xmlOutput: xmlOutput.trim(), processedCount, savingsPercent, savings, totalOrigTokens, totalMinTokens, folderStats };
}

async function packageContext(uris: vscode.Uri[], title: string) {
  if (uris.length === 0) {
    vscode.window.showWarningMessage(`No supported files found to package for ${title}.`);
    return;
  }

  const options = { stripLineComments: true, stripBlockComments: true, stripDocComments: true, stripDeadCode: true, normalizeNewlines: true, stripTrailingWhitespace: true, preserveTodos: false };
  
  let result: any = null;
  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Packaging ${title}...`,
    cancellable: false
  }, async (progress) => {
    result = await buildContextString(uris, options, (msg) => progress.report({ message: msg }));
  });

  const header = `<!--
LeanContext Package
Files: ${result.processedCount}
Original Tokens: ${result.totalOrigTokens.toLocaleString()}
Minified Tokens: ${result.totalMinTokens.toLocaleString()}
Saved: ${result.savingsPercent}%
-->\n\n`;

  const finalPayload = header + result.xmlOutput;

  const previewMessage = `Files Found: ${result.processedCount}\n\nOriginal Tokens: ${result.totalOrigTokens.toLocaleString()}\nMinified Tokens: ${result.totalMinTokens.toLocaleString()}\n\nSavings: ${result.savingsPercent}%`;

  const selection = await vscode.window.showInformationMessage(
    previewMessage,
    { modal: true },
    'Copy Package'
  );

  if (selection === 'Copy Package') {
    await vscode.env.clipboard.writeText(finalPayload);
    vscode.window.showInformationMessage(`✅ Copied Context Package (${result.processedCount} files)`);
  }
}

export function activate(context: vscode.ExtensionContext) {
  const participant = vscode.chat.createChatParticipant('leancontext.participant', async (request, context, response, token) => {
    const options = { stripLineComments: true, stripBlockComments: true, stripDocComments: true, stripDeadCode: true, normalizeNewlines: true, stripTrailingWhitespace: true, preserveTodos: false };

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

    let userPrompt = request.prompt;
    const uris: vscode.Uri[] = [];
    
    if (request.command === 'workspace') {
      const folders = vscode.workspace.workspaceFolders;
      if (!folders) {
        response.markdown('❌ No workspace is open to package.');
        return;
      }
      response.progress('Gathering workspace files...');
      for (const folder of folders) {
        await gatherFiles(folder.uri, uris);
      }
    } else if (request.command === 'folder') {
      const words = userPrompt.split(/\s+/);
      let foundUri: vscode.Uri | null = null;
      let matchedWord = '';

      const folders = vscode.workspace.workspaceFolders;
      if (!folders) {
        response.markdown('❌ No workspace is open to resolve paths.');
        return;
      }

      for (const word of words) {
        if (!word) continue;
        
        let targetUri: vscode.Uri;
        if (word.startsWith('/')) {
          targetUri = vscode.Uri.file(word);
        } else {
          targetUri = vscode.Uri.joinPath(folders[0].uri, word);
        }
        
        try {
          const stat = await vscode.workspace.fs.stat(targetUri);
          if ((stat.type & vscode.FileType.Directory) !== 0) {
            foundUri = targetUri;
            matchedWord = word;
            break;
          }
        } catch (e) {
          // Ignore, just not a valid path
        }
      }

      if (!foundUri) {
        response.markdown('❌ Could not find a valid folder path in your prompt.');
        return;
      }

      userPrompt = userPrompt.replace(matchedWord, '').trim();
      response.progress(`Gathering files in ${matchedWord}...`);
      await gatherFiles(foundUri, uris);

    } else {
      // Default / active file mode
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        response.markdown('❌ I need an active file open to minify, or use `/workspace` / `/folder`.');
        return;
      }
      uris.push(editor.document.uri);
    }

    if (uris.length === 0) {
      response.markdown('❌ No supported files found to analyze.');
      return;
    }

    response.progress(`Minifying ${uris.length} file${uris.length === 1 ? '' : 's'}...`);
    
    const result = await buildContextString(uris, options, (msg) => response.progress(msg));

    const copilotPrompt = `You are a helpful coding assistant. The user has asked the following question about their code.
The code provided below has been automatically minified (comments and dead code removed) to save tokens.

User Question: ${userPrompt}

--- MINIFIED CODE CONTEXT ---
${result.xmlOutput}
--------------------------------------------
Please answer their question based on this minified code.`;

    let models = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4o' });
    if (models.length === 0) models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
    if (models.length === 0) models = await vscode.lm.selectChatModels({});

    const model = models[0];
    if (!model) {
      response.markdown('❌ Could not find ANY language model. Please ensure GitHub Copilot is installed and active.');
      return;
    }

    response.progress('Sending optimized context to Copilot...');

    try {
      const messages = [vscode.LanguageModelChatMessage.User(copilotPrompt)];
      const chatResponse = await model.sendRequest(messages, {}, token);

      for await (const chunk of chatResponse.text) {
        response.markdown(chunk);
      }

      response.markdown(`\n\n---\n*⚡ LeanContext: Saved ${result.savingsPercent}% (~${result.savings.toLocaleString()} tokens) across ${result.processedCount} files on this request.*`);
      
      if (request.command !== 'workspace' && request.command !== 'folder') {
        response.button({
          command: 'leancontext.previewOptimized',
          title: 'View Minified Code'
        });
      }
    } catch (err: any) {
      response.markdown(`\n\n❌ Error communicating with Copilot: ${err.message}`);
    }
  });

  participant.iconPath = new vscode.ThemeIcon('zap');

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
    const engineForPreview = new MinifyEngine({ stripLineComments: true, stripBlockComments: true, stripDocComments: true, stripDeadCode: true, normalizeNewlines: true, stripTrailingWhitespace: true, preserveTodos: false });
    const minCode = engineForPreview.minify(editor.document.getText(), editor.document.languageId.includes('javascript') || editor.document.languageId.includes('typescript') ? 'typescript' : 'python').output;
    const originalUri = editor.document.uri;
    const minifiedUri = vscode.Uri.parse(`leancontext:${originalUri.path}.minified`);
    previewProvider.setContent(minifiedUri, minCode);
    await vscode.commands.executeCommand('vscode.diff', originalUri, minifiedUri, `Original ↔ Minified Context`);
  });

  const copyCurrentFileCmd = vscode.commands.registerCommand('leancontext.copyCurrentFile', async (uri?: vscode.Uri) => {
    let targetUri = uri || vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) { vscode.window.showErrorMessage("No file selected."); return; }
    const filePaths: vscode.Uri[] = [];
    await gatherFiles(targetUri, filePaths);
    await packageContext(filePaths, "Current File");
  });

  const copyFolderCmd = vscode.commands.registerCommand('leancontext.copyFolder', async (uri?: vscode.Uri) => {
    if (!uri) { vscode.window.showErrorMessage("Please right-click a folder in the Explorer to use this command."); return; }
    const filePaths: vscode.Uri[] = [];
    await gatherFiles(uri, filePaths);
    await packageContext(filePaths, "Folder");
  });

  const copyWorkspaceCmd = vscode.commands.registerCommand('leancontext.copyWorkspace', async () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { vscode.window.showErrorMessage("No workspace open."); return; }
    const filePaths: vscode.Uri[] = [];
    for (const folder of folders) await gatherFiles(folder.uri, filePaths);
    await packageContext(filePaths, "Workspace");
  });

  context.subscriptions.push(participant, providerReg, previewCommand, copyCurrentFileCmd, copyFolderCmd, copyWorkspaceCmd);
}

export function deactivate() {}
