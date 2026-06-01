import dotenv from "dotenv";
import { OpenAI } from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";
import { CGECompiler } from "./cge_compiler";

// Load keys securely from .env (ignored in Git)
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "dummy",
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "dummy");

// The hierarchy of models, strictly prioritizing cheapest models first.
const MODEL_TIERS = [
  { provider: "gemini", model: "gemini-1.5-flash" },
  { provider: "openai", model: "gpt-4o-mini" },
  { provider: "openai", model: "gpt-4o" } // Expensive, only used if cheap models completely fail
];

/**
 * Call the specified LLM API with the prompt.
 */
async function callLLM(prompt: string, provider: string, model: string): Promise<string> {
  console.log(`   [Network] Querying ${provider} (${model})...`);
  
  if (provider === "openai") {
    const response = await openai.chat.completions.create({
      model: model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.1, // Low temperature for deterministic code generation
    });
    return response.choices[0].message.content || "";
  } 
  
  if (provider === "gemini") {
    const geminiModel = genAI.getGenerativeModel({ model: model });
    const result = await geminiModel.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1 },
    });
    return result.response.text();
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

/**
 * A basic Node.js implementation of the CGE AST Diff Engine.
 * For now, this uses regex identifier extraction to simulate the AST-differ.
 */
function extractIdentifiers(code: string): Set<string> {
  const identifiers = new Set<string>();
  
  // Extract function names: function foo(...) or def foo(...) or fn foo(...)
  const fnMatches = code.matchAll(/(?:function|def|fn)\s+([a-zA-Z0-9_]+)\s*[\(\:]/g);
  for (const match of fnMatches) identifiers.add(match[1]);
  
  // Extract arrow functions/variables: const foo = or let foo =
  const varMatches = code.matchAll(/(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=/g);
  for (const match of varMatches) identifiers.add(match[1]);
  
  // Extract interfaces/classes/structs/enums/types
  const classMatches = code.matchAll(/(?:class|interface|struct|enum|type)\s+([a-zA-Z0-9_]+)/g);
  for (const match of classMatches) identifiers.add(match[1]);

  return identifiers;
}

interface BenchmarkResult {
  fileName: string;
  originalSize: number;
  compressedSize: number;
  ratio: string;
  successfulModel: string;
  loopsNeeded: number;
  success: boolean;
}

/**
 * Run the Active Decompression Feedback (ADF) loop for a single file.
 */
async function runFidelityLoop(
  originalCode: string, 
  cgeCode: string, 
  fileName: string
): Promise<BenchmarkResult> {
  console.log(`\n==================================================`);
  console.log(`🚀 Starting CLNR Benchmark for: ${fileName}`);
  console.log(`==================================================`);

  const originalIdentifiers = extractIdentifiers(originalCode);
  console.log(`🔍 Original Identifiers detected: [${Array.from(originalIdentifiers).join(", ")}]`);
  
  // Try each model tier, from cheapest to most expensive
  for (const tier of MODEL_TIERS) {
    console.log(`\n[Stage] Testing on ${tier.provider} -> ${tier.model}`);
    
    let currentPrompt = `Act as an expert compiler. Below is a code block translated into Cognitive Graph Encoding (CGE) loss-less shorthand notation.
Decompress this CGE shorthand back into fully working, standard source code. 

CRITICAL REQUIREMENTS:
1. Do NOT wrap in markdown code fences or explain anything, just return the raw code.
2. STRICTLY preserve the original programming constructs. 
   - If the CGE block defines a class (e.g. under OPS: or STATE: matching a class name), you MUST reconstruct it as a class with its member variables and methods.
   - If the CGE block defines an interface or type, reconstruct it exactly.
   - Match all exported variables, classes, hooks, and function signatures.

CGE Code:
${cgeCode}`;

    let success = false;
    const MAX_LOOPS = 2; // Allow the model 2 attempts to fix its own mistakes
    let loop = 1;
    
    for (; loop <= MAX_LOOPS; loop++) {
      console.log(`   [Loop ${loop}/${MAX_LOOPS}] Requesting decompression...`);
      
      try {
        const reconstructedCode = await callLLM(currentPrompt, tier.provider, tier.model);
        
        // Clean markdown blocks if LLM still returned them
        const cleanCode = reconstructedCode.replace(/```[a-zA-Z]*\n/g, "").replace(/```/g, "").trim();
        
        // Run AST Diff Engine simulation
        const reconstructedIdentifiers = extractIdentifiers(cleanCode);
        const missing = Array.from(originalIdentifiers).filter(id => !reconstructedIdentifiers.has(id));
        const extra = Array.from(reconstructedIdentifiers).filter(id => !originalIdentifiers.has(id));

        if (missing.length === 0) {
          console.log(`   ✅ SUCCESS: 100% Structural Fidelity Match achieved on loop ${loop}!`);
          success = true;
          break; // Stop looping, we got it perfectly!
        } else {
          console.log(`   ❌ MISMATCH: Missing essential identifiers: [${missing.join(", ")}]`);
          console.log(`   --- DEBUG: Reconstructed Identifiers: [${Array.from(reconstructedIdentifiers).join(", ")}]`);
          console.log(`   --- DEBUG: Raw LLM Output ---\n${cleanCode}\n-------------------------`);
          
          // Generate Correction Patch
          const patches = [];
          for (const m of missing) {
            patches.push(`[PATCH: Missing identifier '${m}'. Ensure it is implemented strictly as '${m}']`);
          }
          
          console.log(`   🩹 Generated ${patches.length} Correction Patches. Feeding back to LLM...`);
          
          // Append patches to the prompt for the next loop
          currentPrompt += `\n\n[SYSTEM ERROR - AST MISMATCH DETECTED IN YOUR LAST RESPONSE]\nPlease regenerate the code and apply the following constraints:\n${patches.join('\n')}`;
        }
      } catch (err: any) {
        console.error(`   ⚠️ API Error: ${err.message}`);
        break; // Break the inner loop on API failure
      }
    }
    
    if (success) {
      // If the cheap model succeeded, bypass expensive tiers
      console.log(`\n🎉 Test completed successfully on budget model (${tier.model}). Bypassing expensive tiers.`);
      return {
        fileName,
        originalSize: originalCode.length,
        compressedSize: cgeCode.length,
        ratio: (originalCode.length / cgeCode.length).toFixed(2) + "x",
        successfulModel: tier.model,
        loopsNeeded: loop,
        success: true
      };
    } else {
      console.log(`\n⚠️ Model ${tier.model} failed to converge after ${MAX_LOOPS} loops. Escalating to next tier...`);
    }
  }

  console.log(`\n💀 FATAL: All models failed to achieve 100% fidelity.`);
  return {
    fileName,
    originalSize: originalCode.length,
    compressedSize: cgeCode.length,
    ratio: (originalCode.length / cgeCode.length).toFixed(2) + "x",
    successfulModel: "None (Failed)",
    loopsNeeded: 0,
    success: false
  };
}

// Main suite execution
async function main() {
  const testFilesDir = path.resolve("./test_files");
  if (!fs.existsSync(testFilesDir)) {
    console.error(`Error: test_files directory does not exist at ${testFilesDir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(testFilesDir).filter(f => {
    const ext = path.extname(f).toLowerCase();
    return [".ts", ".py", ".rs"].includes(ext);
  });

  if (files.length === 0) {
    console.log("No test files found in test_files/ directory.");
    return;
  }

  console.log(`Found ${files.length} test files to run through CGE -> CLNR evaluation loop.`);
  const compiler = new CGECompiler();
  const results: BenchmarkResult[] = [];

  for (const f of files) {
    const filePath = path.join(testFilesDir, f);
    const originalCode = fs.readFileSync(filePath, "utf-8");
    
    // Compile using the live modular CGE compiler!
    const cgeCode = compiler.compile(filePath);
    
    const result = await runFidelityLoop(originalCode, cgeCode, f);
    results.push(result);
  }

  // Generate CSV Report
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const resultsDir = path.resolve("./test_results");
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir, { recursive: true });
  }

  const csvPath = path.join(resultsDir, `batch_run_${timestamp}.csv`);
  let csvContent = "File Name,Original Chars,CGE Chars,Compression Ratio,Successful Model,Loops Needed,Success Status\n";
  for (const r of results) {
    csvContent += `"${r.fileName}",${r.originalSize},${r.compressedSize},"${r.ratio}","${r.successfulModel}",${r.loopsNeeded},${r.success}\n`;
  }

  fs.writeFileSync(csvPath, csvContent, "utf-8");
  console.log(`\n==================================================`);
  console.log(`📊 EVALUATION COMPLETED SUCCESSFULLY!`);
  console.log(`CSV Report generated at: ${csvPath}`);
  console.log(`==================================================\n`);
  
  console.table(results);
}

main().catch(console.error);
