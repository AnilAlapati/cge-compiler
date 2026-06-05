import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || ""
});

const modelsToTest = [
  "claude-3-5-haiku-latest",
  "claude-3-5-sonnet-latest",
  "claude-3-haiku-latest",
  "claude-4-haiku-latest"
];

async function testModels() {
  console.log("🔍 Diagnosing Anthropic API Key Model Access...\n");
  
  let workingModel = null;

  for (const model of modelsToTest) {
    try {
      process.stdout.write(`Testing ${model}... `);
      const msg = await anthropic.messages.create({
        model: model,
        max_tokens: 10,
        messages: [{ role: "user", content: "Say 'hello'" }]
      });
      console.log(`✅ Success! Response: ${(msg.content[0] as any).text}`);
      if (!workingModel) workingModel = model;
    } catch (err: any) {
      if (err.status === 404) {
        console.log(`❌ 404 Not Found (Deprecated or No Access)`);
      } else {
        console.log(`❌ Error: ${err.message}`);
      }
    }
  }

  console.log(`\n➡️ Recommended working model: ${workingModel || "None found. Key may be invalid."}`);
}

testModels();
