import { CGECompiler } from "./cge_compiler";
import * as fs from "fs";
import * as path from "path";

/**
 * Runner to execute the CGE Compiler on test files.
 */
function run() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("Usage: node cge_compiler_runner.js <inputFile> <outputFile>");
    process.exit(1);
  }

  const inputFile = path.resolve(args[0] as string);
  const outputFile = path.resolve(args[1] as string);

  console.log(`Loading and compiling file: ${inputFile}`);
  if (!fs.existsSync(inputFile)) {
    console.error(`Error: File does not exist at ${inputFile}`);
    process.exit(1);
  }

  const inputStats = fs.statSync(inputFile);
  const filesToCompile: string[] = [];

  function walkDir(dir: string) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
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
    console.log(`Scanning directory: ${inputFile}`);
    walkDir(inputFile);
  } else {
    filesToCompile.push(inputFile);
  }

  if (filesToCompile.length === 0) {
    console.error("No supported files found to compile.");
    process.exit(1);
  }

  try {
    const compiler = new CGECompiler(filesToCompile);
    let combinedOutput = "";
    let totalOrigChars = 0;
    let totalOrigLines = 0;
    let totalOrigWords = 0;

    for (const file of filesToCompile) {
      const cgeOutput = compiler.compile(file);
      combinedOutput += `// --- File: ${path.relative(process.cwd(), file)} ---\n` + cgeOutput + "\n\n";

      const originalText = fs.readFileSync(file, "utf-8");
      totalOrigChars += originalText.length;
      totalOrigLines += originalText.split("\n").length;
      totalOrigWords += originalText.split(/\s+/).length;
    }

    // Ensure output directory exists
    const outDir = path.dirname(outputFile);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(outputFile, combinedOutput, "utf-8");
    console.log(`Successfully compiled ${filesToCompile.length} files! Written to: ${outputFile}`);

    // Compute Compression Stats
    const origTokens = Math.ceil(totalOrigChars / 4);

    const compChars = combinedOutput.length;
    const compLines = combinedOutput.split("\n").length;
    const compWords = combinedOutput.split(/\s+/).length;
    const compTokens = Math.ceil(compChars / 4);

    console.log("\n============================================================");
    console.log("CGE COMPILATION STATS REPORT");
    console.log("============================================================");
    console.log(`Original Code:    ${totalOrigLines} lines | ${totalOrigWords} words | ${totalOrigChars} chars | ~${origTokens} tokens`);
    console.log(`Compressed (CGE): ${compLines} lines | ${compWords} words | ${compChars} chars | ~${compTokens} tokens`);
    console.log("------------------------------------------------------------");
    console.log(`Line Reduction:   ${(totalOrigLines / compLines).toFixed(1)}x smaller (${totalOrigLines - compLines} lines saved)`);
    console.log(`Token Savings:     ~${(origTokens / compTokens).toFixed(1)}x smaller (~${origTokens - compTokens} tokens saved)`);
    console.log("============================================================");

  } catch (err: any) {
    console.error("Compilation failed with error:");
    console.error(err);
    process.exit(1);
  }
}

run();
