import * as fs from 'fs';
import * as path from 'path';
import { LeanContextEngine } from '../src/leancontext/leancontext_engine';

/**
 * Creates a LeanContext mirror of a repository for agentic testing (e.g. Claude Code).
 * It copies the source repository to a destination directory, then recursively optimizes
 * all supported files in-place.
 */

const engine = new LeanContextEngine({
  stripLineComments: true,
  stripBlockComments: true,
  stripDocComments: true, // Aggressive mode by default for testing
  stripDeadCode: true,
  normalizeNewlines: true,
  stripTrailingWhitespace: true,
  preserveTodos: false
});

const SUPPORTED_EXTS = ['.ts', '.js', '.jsx', '.tsx', '.py', '.java', '.cpp', '.c', '.rs'];

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []): string[] {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    // Skip node_modules, .git, and build directories
    if (file === 'node_modules' || file === '.git' || file === 'dist' || file === 'build') {
      return;
    }
    
    if (fs.statSync(fullPath).isDirectory()) {
      arrayOfFiles = getAllFiles(fullPath, arrayOfFiles);
    } else {
      if (SUPPORTED_EXTS.includes(path.extname(fullPath))) {
        arrayOfFiles.push(fullPath);
      }
    }
  });

  return arrayOfFiles;
}

function createLeanContextWorkspace(sourceDir: string, destDir: string) {
  if (!fs.existsSync(sourceDir)) {
    console.error(`Source directory ${sourceDir} does not exist.`);
    process.exit(1);
  }

  console.log(`[1/3] Copying workspace from ${sourceDir} to ${destDir}...`);
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }
  
  // Node >= 16 supports cpSync
  fs.cpSync(sourceDir, destDir, { recursive: true });

  console.log(`[2/3] Scanning for supported files...`);
  const filesToOptimize = getAllFiles(destDir);
  console.log(`Found ${filesToOptimize.length} files to optimize.`);

  let totalRawTokens = 0;
  let totalOptTokens = 0;

  console.log(`[3/3] Optimizing files in place...`);
  filesToOptimize.forEach((file) => {
    const content = fs.readFileSync(file, 'utf-8');
    const ext = path.extname(file).replace('.', '');
    
    // Rough estimate logic for reporting
    const rawTokens = Math.ceil(content.length / 3.5);
    totalRawTokens += rawTokens;

    let language = 'typescript';
    if (ext === 'py') language = 'python';
    else if (ext === 'java') language = 'java';
    else if (ext === 'rs') language = 'rust';

    try {
      const result = engine.optimize(content, language);
      fs.writeFileSync(file, result.output, 'utf-8');
      totalOptTokens += Math.ceil(result.output.length / 3.5);
    } catch (err) {
      console.warn(`Warning: Could not optimize ${file}:`, err);
    }
  });

  const savings = totalRawTokens > 0 ? ((totalRawTokens - totalOptTokens) / totalRawTokens * 100).toFixed(1) : '0';

  console.log(`\n✅ LeanContext Workspace Created at ${destDir}`);
  console.log(`--------------------------------------------------`);
  console.log(`Files Processed  : ${filesToOptimize.length}`);
  console.log(`Raw Tokens       : ~${totalRawTokens.toLocaleString()}`);
  console.log(`Optimized Tokens : ~${totalOptTokens.toLocaleString()}`);
  console.log(`Total Savings    : ${savings}%`);
  console.log(`--------------------------------------------------`);
  console.log(`\nYou can now run 'cd ${destDir} && claude' to test agentic performance.`);
}

// CLI Execution
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    console.error("Usage: ts-node scripts/create_leancontext_workspace.ts <source_repo_dir> <destination_dir>");
    process.exit(1);
  }

  const source = path.resolve(args[0]);
  const dest = path.resolve(args[1]);

  createLeanContextWorkspace(source, dest);
}
