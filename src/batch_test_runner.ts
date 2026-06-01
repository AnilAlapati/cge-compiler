import dotenv from "dotenv";
import { OpenAI } from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs";
import path from "path";

// Load keys securely from .env (ignored in Git)
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// The hierarchy of models, strictly prioritizing cheapest models first.
const MODEL_TIERS = [
  { provider: "gemini", model: "gemini-1.5-flash-latest" },
  { provider: "openai", model: "gpt-4o-mini" },
  { provider: "openai", model: "gpt-4o" } // Expensive, only used if cheap models completely fail
];

/**
 * Call the specified LLM API with the prompt.
 */
async function callLLM(prompt: string, provider: string, model: string): Promise<string> {
  console.log(`[Network] Calling ${provider} (${model})...`);
  
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
 * For now, this uses a simplified regex identifier extraction to simulate the client-side parser.
 */
function extractIdentifiers(code: string): Set<string> {
  const identifiers = new Set<string>();
  
  // Extract function names: function foo(...)
  const fnMatches = code.matchAll(/function\s+([a-zA-Z0-9_]+)\s*\(/g);
  for (const match of fnMatches) identifiers.add(match[1]);
  
  // Extract arrow functions/variables: const foo =
  const varMatches = code.matchAll(/(?:const|let|var)\s+([a-zA-Z0-9_]+)\s*=/g);
  for (const match of varMatches) identifiers.add(match[1]);
  
  // Extract interfaces/classes
  const classMatches = code.matchAll(/(?:class|interface)\s+([a-zA-Z0-9_]+)/g);
  for (const match of classMatches) identifiers.add(match[1]);

  return identifiers;
}

/**
 * Run the Active Decompression Feedback (ADF) loop for a single file.
 */
async function runFidelityLoop(originalCode: string, cgeCode: string, fileName: string) {
  console.log(`\n==================================================`);
  console.log(`🚀 Starting CLNR Benchmark for: ${fileName}`);
  console.log(`==================================================`);

  const originalIdentifiers = extractIdentifiers(originalCode);
  
  // Try each model tier, from cheapest to most expensive
  for (const tier of MODEL_TIERS) {
    console.log(`\n[Stage] Testing on ${tier.provider} -> ${tier.model}`);
    
    let currentPrompt = `Act as an expert compiler. Below is a code block translated into Cognitive Graph Encoding (CGE) loss-less shorthand notation.
Decompress this CGE shorthand back into fully working, standard source code. Do NOT wrap in markdown blocks, just return the raw code.

CGE Code:
${cgeCode}`;

    let success = false;
    const MAX_LOOPS = 2; // Allow the model 2 attempts to fix its own mistakes
    
    for (let loop = 1; loop <= MAX_LOOPS; loop++) {
      console.log(`   [Loop ${loop}/${MAX_LOOPS}] Querying model...`);
      
      try {
        const reconstructedCode = await callLLM(currentPrompt, tier.provider, tier.model);
        
        // Run AST Diff Engine
        const reconstructedIdentifiers = extractIdentifiers(reconstructedCode);
        const missing = Array.from(originalIdentifiers).filter(id => !reconstructedIdentifiers.has(id));
        const extra = Array.from(reconstructedIdentifiers).filter(id => !originalIdentifiers.has(id));

        if (missing.length === 0 && extra.length === 0) {
          console.log(`   ✅ SUCCESS: 100% Structural Fidelity Match achieved on loop ${loop}!`);
          success = true;
          break; // Stop looping, we got it perfectly!
        } else {
          console.log(`   ❌ MISMATCH: ${missing.length} missing, ${extra.length} hallucinated.`);
          
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
      // If the cheap model succeeded, we DO NOT call the expensive model!
      console.log(`\n🎉 Test completely successfully on budget model (${tier.model}). Bypassing expensive tiers.`);
      return;
    } else {
      console.log(`\n⚠️ Model ${tier.model} failed to converge after ${MAX_LOOPS} loops. Escalating to next tier...`);
    }
  }

  console.log(`\n💀 FATAL: All models failed to achieve 100% fidelity.`);
}

// Example usage execution
async function main() {
  // Read a dummy file for now, or you can integrate with the actual test_results folder
  const dummyOriginal = `
    const POSTS_COLLECTION = "posts";
    export const createPost = async (postData) => {
      return "123";
    };
    export const getPosts = async (userId) => {
      return [];
    };
  `;
  const dummyCGE = `
    STATE: CONST POSTS_COLLECTION = "posts"
    OPS: EXPORT createPost(postData): Promise<S>
    OPS: EXPORT getPosts(userId?): Promise<Post[]>
  `;

  await runFidelityLoop(dummyOriginal, dummyCGE, "test_file.ts");
}

main().catch(console.error);
