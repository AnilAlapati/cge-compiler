import { CGECompiler } from "../cge_compiler";
import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";

/**
 * CLI Tool to compile directories/files and pipe the CGE output directly to the clipboard.
 */
function run() {
  const args = process.argv.slice(2);
  const targetDir = args.length > 0 ? path.resolve(args[0] as string) : process.cwd();

  console.log(`Scanning target: ${targetDir}`);
  if (!fs.existsSync(targetDir)) {
    console.error(`Error: Target does not exist at ${targetDir}`);
    process.exit(1);
  }

  const inputStats = fs.statSync(targetDir);
  const filesToCompile: string[] = [];
  const skipPatterns = ['node_modules', '.git', 'dist', 'build', '.next'];

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
    let combinedOutput = "";

    for (const file of filesToCompile) {
      const cgeOutput = compiler.compile(file);
      combinedOutput += `// --- File: ${path.relative(process.cwd(), file)} ---\n` + cgeOutput + "\n\n";
    }

    // Pipe to clipboard
    const isMac = process.platform === "darwin";
    const isWin = process.platform === "win32";
    let cmd = "";
    let cmdArgs: string[] = [];

    if (isMac) {
      cmd = "pbcopy";
    } else if (isWin) {
      cmd = "clip";
    } else {
      cmd = "xclip";
      cmdArgs = ["-selection", "clipboard"];
    }

    const child = spawnSync(cmd, cmdArgs, {
      input: combinedOutput,
      encoding: "utf-8"
    });

    if (child.error) {
      console.error("Failed to copy to clipboard:", child.error.message);
      console.log("\nOutput:\n", combinedOutput);
    } else {
      console.log(`✅ Successfully compiled ${filesToCompile.length} files!`);
      console.log(`📋 CGE Output (${combinedOutput.length} characters) has been copied to your clipboard.`);
      console.log(`You can now paste it directly into ChatGPT, Claude, or any LLM.`);
    }

  } catch (err: any) {
    console.error("Compilation failed with error:");
    console.error(err);
    process.exit(1);
  }
}

run();
