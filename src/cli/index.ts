#!/usr/bin/env node
import { CGECompiler } from "../cge_compiler";
import * as fs from "fs";
import * as path from "path";

function run() {
  const args = process.argv.slice(2);
  const command = args[0] || 'build';
  const targetDir = args.length > 1 ? path.resolve(args[1]) : process.cwd();

  if (command !== 'build') {
    console.error(`Unknown command: ${command}`);
    console.log("Usage: cge-cli build [directory]");
    process.exit(1);
  }

  console.log(`Scanning repository: ${targetDir}`);
  if (!fs.existsSync(targetDir)) {
    console.error(`Error: Target does not exist at ${targetDir}`);
    process.exit(1);
  }

  const inputStats = fs.statSync(targetDir);
  const filesToCompile: string[] = [];
  const skipPatterns = ['node_modules', '.git', 'dist', 'build', '.next', '.cge'];

  function walkDir(dir: string) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (skipPatterns.includes(file)) continue;
      
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        walkDir(fullPath);
      } else {
        const ext = path.extname(fullPath).toLowerCase();
        if ([".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".cpp", ".h", ".hpp"].includes(ext)) {
          filesToCompile.push(fullPath);
        }
      }
    }
  }

  if (inputStats.isDirectory()) {
    walkDir(targetDir);
  } else {
    filesToCompile.push(targetDir);
  }

  if (filesToCompile.length === 0) {
    console.error("No supported files found to compile.");
    process.exit(1);
  }

  try {
    const compiler = new CGECompiler(filesToCompile);
    const outputDir = path.join(targetDir, '.cge');

    // Create the .cge directory
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    let compiledCount = 0;

    for (const file of filesToCompile) {
      const cgeOutput = compiler.compile(file);
      
      // Calculate relative path to maintain directory structure
      const relativePath = path.relative(targetDir, file);
      const cgeFilePath = path.join(outputDir, relativePath + '.cge');
      
      // Ensure the subdirectory exists
      const cgeFileDir = path.dirname(cgeFilePath);
      if (!fs.existsSync(cgeFileDir)) {
        fs.mkdirSync(cgeFileDir, { recursive: true });
      }

      fs.writeFileSync(cgeFilePath, cgeOutput, 'utf-8');
      compiledCount++;
    }

    const promptText = `When exploring this repository, do not grep or cat the raw source code files. Instead, navigate to the .cge/ directory and use grep there. You will receive completely flattened, dense structural mappings of the entire application, saving your context window.`;
    fs.writeFileSync(path.join(outputDir, 'AGENT_PROMPT.txt'), promptText, 'utf-8');

    console.log(`✅ Successfully compiled ${compiledCount} files!`);
    console.log(`📂 Flattened index generated at: ${outputDir}`);
    console.log(`🤖 Your codebase is now ready to be navigated by AI agents!`);
    console.log(`\n💡 To get the most out of your AI Agent, paste this prompt into your chat or .cursorrules file:`);
    console.log(`----------------------------------------------------------------------`);
    console.log(`"${promptText}"`);
    console.log(`----------------------------------------------------------------------\n`);

  } catch (err: any) {
    console.error("Compilation failed with error:");
    console.error(err);
    process.exit(1);
  }
}

run();
