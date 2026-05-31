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

  const inputFile = path.resolve(args[0]);
  const outputFile = path.resolve(args[1]);

  console.log(`Loading and compiling file: ${inputFile}`);
  if (!fs.existsSync(inputFile)) {
    console.error(`Error: File does not exist at ${inputFile}`);
    process.exit(1);
  }

  try {
    const compiler = new CGECompiler([inputFile]);
    const cgeOutput = compiler.compile(inputFile);

    // Ensure output directory exists
    const outDir = path.dirname(outputFile);
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(outputFile, cgeOutput, "utf-8");
    console.log(`Successfully compiled! Written to: ${outputFile}`);

    // Compute Compression Stats
    const originalText = fs.readFileSync(inputFile, "utf-8");
    const origChars = originalText.length;
    const origLines = originalText.split("\n").length;
    const origWords = originalText.split(/\s+/).length;
    const origTokens = Math.ceil(origChars / 4);

    const compChars = cgeOutput.length;
    const compLines = cgeOutput.split("\n").length;
    const compWords = cgeOutput.split(/\s+/).length;
    const compTokens = Math.ceil(compChars / 4);

    console.log("\n============================================================");
    console.log("CGE COMPILATION STATS REPORT");
    console.log("============================================================");
    console.log(`Original Code:    ${origLines} lines | ${origWords} words | ${origChars} chars | ~${origTokens} tokens`);
    console.log(`Compressed (CGE): ${compLines} lines | ${compWords} words | ${compChars} chars | ~${compTokens} tokens`);
    console.log("------------------------------------------------------------");
    console.log(`Line Reduction:   ${(origLines / compLines).toFixed(1)}x smaller (${origLines - compLines} lines saved)`);
    console.log(`Token Savings:     ~${(origTokens / compTokens).toFixed(1)}x smaller (~${origTokens - compTokens} tokens saved)`);
    console.log("============================================================");

  } catch (err: any) {
    console.error("Compilation failed with error:");
    console.error(err);
    process.exit(1);
  }
}

run();
