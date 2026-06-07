import * as vscode from 'vscode';
import { LeanContextEngine } from '../../src/leancontext/leancontext_engine';
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

async function buildContextString(uris: vscode.Uri[], options: any, progressCallback?: (msg: string) => void): Promise<{ xmlOutput: string, rawXmlOutput: string, auditSummary: string, processedCount: number, savingsPercent: string, savings: number, totalOrigTokens: number, totalOptTokens: number, folderStats: Map<string, number> }> {
  const engine = new LeanContextEngine(options);
  let xmlOutput = "";
  let rawXmlOutput = "";
  let totalOrigTokens = 0;
  let totalOptTokens = 0;
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
      
      const optCode = engine.optimize(rawCode, lang).output;
      const origTokens = encode(rawCode).length;
      const optTokens = encode(optCode).length;
      
      if (totalOrigTokens + origTokens > 500000) {
        if (progressCallback) progressCallback('Workspace packaging reached the 500k token limit. Output has been truncated.');
        break;
      }

      totalOrigTokens += origTokens;
      totalOptTokens += optTokens;
      
      const relativePath = vscode.workspace.asRelativePath(uri, false);
      const dirPath = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '/';
      
      folderStats.set(dirPath, (folderStats.get(dirPath) || 0) + optTokens);
      
      xmlOutput += `<file path="${relativePath}">\n${optCode}\n</file>\n\n`;
      rawXmlOutput += `<file path="${relativePath}">\n${rawCode}\n</file>\n\n`;
      processedCount++;
      
      if (progressCallback) progressCallback(`Applying LeanContext to file ${processedCount} of ${uris.length}...`);
    } catch (e) {
      // Skip unreadable files
    }
  }

  const savings = totalOrigTokens - totalOptTokens;
  const savingsPercent = totalOrigTokens > 0 ? ((savings / totalOrigTokens) * 100).toFixed(1) : "0.0";

  const origUsage = ((totalOrigTokens / 128000) * 100).toFixed(1);
  const optUsage = ((totalOptTokens / 128000) * 100).toFixed(1);

  let topFolders = '';
  const sortedFolders = Array.from(folderStats.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  sortedFolders.forEach(f => {
    topFolders += `- \`${f[0]}\` (~${f[1].toLocaleString()} tokens)\n`;
  });

  const auditSummary = `# LeanContext Audit Summary

**Files Processed:** ${processedCount}

## ⚡ Context Window Usage (128k Model)
- **Before:** ${origUsage}%
- **After:** ${optUsage}%

## 📊 Token Statistics
- **Original Tokens:** ${totalOrigTokens.toLocaleString()}
- **Sent Tokens:** ${totalOptTokens.toLocaleString()}
- **Saved Tokens:** ${savings.toLocaleString()} (${savingsPercent}%)

## 📁 Largest Folders Sent
${topFolders || "N/A"}

## 🧹 Automatically Removed
- ✓ Comments & Docstrings
- ✓ Blank lines & formatting
- ✓ Dead code
`;

  return { 
    xmlOutput: xmlOutput.trim(), 
    rawXmlOutput: rawXmlOutput.trim(), 
    auditSummary,
    processedCount, 
    savingsPercent, 
    savings, 
    totalOrigTokens, 
    totalOptTokens, 
    folderStats 
  };
}

export function activate(context: vscode.ExtensionContext) {
  let lastGeneratedPackage_original = "";
  let lastGeneratedPackage_optimized = "";
  let lastGeneratedPackage_summary = "";
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
        response.markdown('❌ I need an active file open to apply LeanContext, or use `/workspace` / `/folder`.');
        return;
      }
      uris.push(editor.document.uri);
    }

    if (uris.length === 0) {
      response.markdown('❌ No supported files found to analyze.');
      return;
    }

    response.progress(`Applying LeanContext to ${uris.length} file${uris.length === 1 ? '' : 's'}...`);
    
    const result = await buildContextString(uris, options, (msg) => response.progress(msg));
    lastGeneratedPackage_original = result.rawXmlOutput;
    lastGeneratedPackage_optimized = result.xmlOutput;
    lastGeneratedPackage_summary = result.auditSummary;

    const copilotPrompt = `You are a helpful coding assistant. The user has asked the following question about their code.
The code provided below has been automatically optimized with LeanContext (comments and dead code removed) to save tokens.

User Question: ${userPrompt}

--- OPTIMIZED CODE CONTEXT (LeanContext) ---
${result.xmlOutput}
--------------------------------------------
Please answer their question based on this optimized code.`;

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
      
      response.button({
        command: request.command === 'workspace' || request.command === 'folder' 
          ? 'leancontext.previewPackage' 
          : 'leancontext.previewOptimized',
        title: request.command === 'workspace' || request.command === 'folder' 
          ? 'Audit LeanContext' 
          : 'View Optimized Code'
      });
    } catch (err: any) {
      response.markdown(`\n\n❌ Error communicating with Copilot: ${err.message}`);
    }
  });

  participant.iconPath = new vscode.ThemeIcon('zap');

  const previewProvider = new (class implements vscode.TextDocumentContentProvider {
    private contentMap = new Map<string, string>();
    provideTextDocumentContent(uri: vscode.Uri): string {
      return this.contentMap.get(uri.toString()) || 'Error loading optimized content.';
    }
    setContent(uri: vscode.Uri, content: string) {
      this.contentMap.set(uri.toString(), content);
    }
  })();
  const providerReg = vscode.workspace.registerTextDocumentContentProvider('leancontext', previewProvider);

  const previewCommand = vscode.commands.registerCommand('leancontext.previewOptimized', async () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const engineForPreview = new LeanContextEngine({ stripLineComments: true, stripBlockComments: true, stripDocComments: true, stripDeadCode: true, normalizeNewlines: true, stripTrailingWhitespace: true, preserveTodos: false });
    const optCode = engineForPreview.optimize(editor.document.getText(), editor.document.languageId.includes('javascript') || editor.document.languageId.includes('typescript') ? 'typescript' : 'python').output;
    const originalUri = editor.document.uri;
    const optimizedUri = vscode.Uri.parse(`leancontext:${originalUri.path}.optimized`);
    previewProvider.setContent(optimizedUri, optCode);
    await vscode.commands.executeCommand('vscode.diff', originalUri, optimizedUri, `Original ↔ Optimized Context`);
  });

  const previewPackageCmd = vscode.commands.registerCommand('leancontext.previewPackage', async () => {
    if (!lastGeneratedPackage_optimized || !lastGeneratedPackage_original) {
      vscode.window.showInformationMessage("No context package found in memory.");
      return;
    }
    
    // Open Audit Summary
    const summaryUri = vscode.Uri.parse(`leancontext:Audit-Summary.md`);
    previewProvider.setContent(summaryUri, lastGeneratedPackage_summary);
    await vscode.commands.executeCommand('markdown.showPreview', summaryUri);

    // Open Diff beside it
    const origUri = vscode.Uri.parse(`leancontext:Raw-Context.xml`);
    const minUri = vscode.Uri.parse(`leancontext:LLM-Context.xml`);
    previewProvider.setContent(origUri, lastGeneratedPackage_original);
    previewProvider.setContent(minUri, lastGeneratedPackage_optimized);
    await vscode.commands.executeCommand('vscode.diff', origUri, minUri, `Raw Context ↔ LLM Context`, { viewColumn: vscode.ViewColumn.Beside });
  });

  context.subscriptions.push(participant, providerReg, previewCommand, previewPackageCmd);
}

export function deactivate() {}
