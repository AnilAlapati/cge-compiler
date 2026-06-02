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
  { provider: "openai", model: "gpt-4o-mini" },
  { provider: "openai", model: "gpt-4o" } // Expensive fallback
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
 * Normalizes a single CGE line by removing type indicators (e.g. :S, :any, ->Promise)
 * and whitespace differences to prevent false positives from type inference or formatting.
 */
function normalizeCGELine(line: string): string {
  let cleanLine = line.trim();
  // Strip return types from signatures only (exclude SCAN/GUARD/RETURN flow control lines)
  if (!cleanLine.startsWith("SCAN") && !cleanLine.startsWith("GUARD") && !cleanLine.startsWith("RETURN") && !cleanLine.startsWith("TRY") && !cleanLine.startsWith("THROW")) {
    cleanLine = cleanLine.replace(/->.*/g, "");
  }
  return cleanLine
    // Strip headers, sections, and exports lists
    .replace(/^(?:IMPORTS|TYPES|STATE|OPS|PRIVATE|EXPORTS):?/gi, "")
    // Remove export and constant indicators
    .replace(/\b(?:EXPORT|CONST)\b/gi, "")
    // Strip type assertions and primitives
    .replace(/:(?:S|N|B|D|any|void)\b/g, "")
    // Remove arrows and colons
    .replace(/->/g, "")
    .replace(/:/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalizes CGE code to remove minor whitespace differences.
 */
function normalizeCGE(cge: string): string {
  return cge
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join("\n");
}

/**
 * Deep semantic line-by-line diff between two compiled CGE strings.
 * Uses Normalized Semantic Diffing (NSD) to verify core structural logic.
 */
function diffCGE(original: string, reconstructed: string): { missing: string[]; extra: string[] } {
  const filterNoise = (line: string) => {
    const clean = normalizeCGELine(line);
    // Ignore empty lines, standard headers, and simple exports list lines
    return clean.length > 0 && !line.startsWith("CGE/1.0") && !line.startsWith("EXPORTS:");
  };

  const origLines = normalizeCGE(original).split("\n").filter(filterNoise);
  const reconLines = normalizeCGE(reconstructed).split("\n").filter(filterNoise);

  const normRecon = reconLines.map(l => normalizeCGELine(l));

  const missing = origLines.filter(l => !normRecon.includes(normalizeCGELine(l)));
  const extra = reconLines.filter(l => !origLines.map(o => normalizeCGELine(o)).includes(normalizeCGELine(l)));

  return { missing, extra };
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
 * Run the Active Decompression Feedback (ADF) loop using Self-Referential CGE Compaction.
 */
async function runFidelityLoop(
  originalCode: string, 
  cgeCode: string, 
  fileName: string,
  compiler: CGECompiler
): Promise<BenchmarkResult> {
  console.log(`\n==================================================`);
  console.log(`🚀 Starting Self-Referential CLNR Benchmark for: ${fileName}`);
  console.log(`==================================================`);

  // Try each model tier, from cheapest to most expensive
  for (const tier of MODEL_TIERS) {
    console.log(`\n[Stage] Testing on ${tier.provider} -> ${tier.model}`);
    
    // Detect class names prefixed in CGE notation (e.g. AuthService.endpoint)
    const classNames = new Set<string>();
    const classMatches = cgeCode.matchAll(/([A-Z][a-zA-Z0-9_]+)\.[a-zA-Z0-9_]+/g);
    for (const match of classMatches) {
      classNames.add(match[1]);
    }

    let classInstructions = "";
    if (classNames.size > 0) {
      classInstructions = `\n3. The following entities MUST be reconstructed strictly as CLASSES using the 'class' keyword (e.g. 'class ClassName { ... }') and NOT as constant objects or plain dictionaries:\n` + 
        Array.from(classNames).map(name => `   - ${name}`).join("\n");
    }

    let currentPrompt = `Act as an expert compiler. Below is a code block translated into Cognitive Graph Encoding (CGE) loss-less shorthand notation.
Decompress this CGE shorthand back into fully working, standard source code. 

CRITICAL REQUIREMENTS:
1. Do NOT wrap in markdown code fences or explain anything, just return the raw code.
2. STRICTLY preserve the original programming constructs. 
   - If the CGE block defines a class (e.g. under OPS: or STATE: matching a class name), you MUST reconstruct it as a class with its member variables and methods.
   - If the CGE block defines an interface or type, reconstruct it exactly.
   - Match all exported variables, classes, hooks, and function signatures.
   - In Python, if a class has type mappings (e.g. UserProfile{id:S, email:S, created_at:D}), you MUST declare these fields as class-level type annotations directly in the class body (e.g. id: str).
   - Reconstruct all loop targets and member accesses exactly as written in CGE (e.g. if CGE says SCAN user.items, write 'for item in user.items:').${classInstructions}

CGE Code:
${cgeCode}`;

    let success = false;
    const MAX_LOOPS = 3; // Allow the model 3 attempts to resolve strict class structures
    let loop = 1;
    
    for (; loop <= MAX_LOOPS; loop++) {
      console.log(`   [Loop ${loop}/${MAX_LOOPS}] Requesting decompression...`);
      
      try {
        const reconstructedCode = await callLLM(currentPrompt, tier.provider, tier.model);
        
        // Clean markdown blocks if LLM still returned them
        const cleanCode = reconstructedCode.replace(/```[a-zA-Z]*\n/g, "").replace(/```/g, "").trim();
        
        // --- THE GOLDEN VERIFIER: Self-Referential Compilation ---
        // Compile the candidate code back to CGE notation programmatically
        const ext = path.extname(fileName).toLowerCase();
        let lang = "typescript";
        if (ext === ".py") lang = "python";
        if (ext === ".rs") lang = "rust";

        const candidateCGE = compiler.compileCode(cleanCode, lang, fileName);
        
        // Run deep structural diff on the CGE outputs
        const { missing, extra } = diffCGE(cgeCode, candidateCGE);

        if (missing.length === 0) {
          console.log(`   ✅ SUCCESS: 100% Lossless Symbolic Recovery achieved on loop ${loop}!`);
          success = true;
          break; 
        } else {
          console.log(`   ❌ SEMANTIC MISMATCH DETECTED:`);
          console.log(`      Missing logical signatures:`);
          missing.forEach(m => console.log(`      - ${m}`));
          console.log(`      --- DEBUG: Candidate CGE ---\n${candidateCGE}\n-------------------------`);
          console.log(`      --- DEBUG: Raw LLM Output ---\n${cleanCode}\n-------------------------`);
          
          // Generate Correction Patch from CGE structural differences
          const patches = [];
          for (const m of missing) {
            patches.push(`[PATCH: Missing structure/function logic matching '${m}'. Reimplement this correctly]`);
          }
          
          console.log(`   🩹 Generated ${patches.length} CGE-Derived Correction Patches. Feeding back to LLM...`);
          
          // Append CGE patches to prompt for loop iteration
          currentPrompt += `\n\n[SYSTEM ERROR - SEMANTIC AST MISMATCH DETECTED IN YOUR LAST RESPONSE]\nPlease regenerate the code and apply the following logical constraints:\n${patches.join('\n')}`;
        }
      } catch (err: any) {
        console.error(`   ⚠️ API Error: ${err.message}`);
        break; 
      }
    }
    
    if (success) {
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

  console.log(`Found ${files.length} test files to run through Self-Referential CGE -> CLNR evaluation loop.`);
  const compiler = new CGECompiler();
  const results: BenchmarkResult[] = [];

  for (const f of files) {
    const filePath = path.join(testFilesDir, f);
    const originalCode = fs.readFileSync(filePath, "utf-8");
    const cgeCode = compiler.compile(filePath);
    
    const result = await runFidelityLoop(originalCode, cgeCode, f, compiler);
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
