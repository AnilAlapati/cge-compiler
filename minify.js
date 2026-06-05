document.addEventListener('DOMContentLoaded', () => {
  const codeInput = document.getElementById('code-input');
  const codeOutput = document.getElementById('code-output');
  const rawTokensSpan = document.getElementById('raw-tokens');
  const minifiedTokensSpan = document.getElementById('minified-tokens');
  const savingsPercentSpan = document.getElementById('savings-percent');
  const cliHint = document.getElementById('cli-hint');

  const optDeadCode = document.getElementById('opt-dead-code');
  const optJsdoc = document.getElementById('opt-jsdoc');
  const copyBtn = document.getElementById('copy-btn');

  const queriesSlider = document.getElementById('queries-slider');
  const tokensSlider = document.getElementById('tokens-slider');
  const queriesVal = document.getElementById('queries-val');
  const tokensVal = document.getElementById('tokens-val');
  const dollarSavings = document.getElementById('dollar-savings');

  // Simple token estimator (same logic used in CLI for consistency)
  const estimateTokens = (text) => Math.ceil(text.length / 3.5);

  const updateMinification = () => {
    const rawCode = codeInput.value;
    if (!rawCode.trim()) {
      codeOutput.value = '';
      rawTokensSpan.textContent = '0';
      minifiedTokensSpan.textContent = '0';
      savingsPercentSpan.textContent = '0%';
      return;
    }

    const rawTokens = estimateTokens(rawCode);
    rawTokensSpan.textContent = rawTokens.toLocaleString();

    // Determine options based on checkboxes
    const stripDocComments = optJsdoc.checked;
    const stripDeadCode = optDeadCode.checked;
    const stripLineComments = optDeadCode.checked; // bundle simple comments with dead code
    const stripBlockComments = optDeadCode.checked;

    // Update CLI Hint
    if (stripDocComments) {
      cliHint.textContent = '@minify /rj';
    } else {
      cliHint.textContent = '@minify /rc';
    }

    if (window.MinifyEngine) {
      const engine = new window.MinifyEngine({
        stripLineComments,
        stripBlockComments,
        stripDocComments,
        stripDeadCode,
        normalizeNewlines: true,
        stripTrailingWhitespace: true,
        preserveTodos: !stripDocComments
      });

      try {
        const result = engine.minify(rawCode, 'typescript'); // default to TS for playground
        codeOutput.value = result.output;
        
        const minTokens = estimateTokens(result.output);
        minifiedTokensSpan.textContent = minTokens.toLocaleString();

        const savedTokens = rawTokens - minTokens;
        const pct = rawTokens > 0 ? ((savedTokens / rawTokens) * 100).toFixed(1) : 0;
        savingsPercentSpan.textContent = `${pct}%`;
        
        updateCalculator(pct);
      } catch (err) {
        console.error("Minification error", err);
      }
    } else {
      codeOutput.value = "Error: MinifyEngine not loaded. Run `npm run build` to generate dist/minify_engine.js";
    }
  };

  const updateCalculator = (savingsPercentage = 0) => {
    const queries = parseInt(queriesSlider.value, 10);
    const tokens = parseInt(tokensSlider.value, 10);
    
    queriesVal.textContent = queries;
    tokensVal.textContent = tokens >= 1000 ? (tokens/1000) + 'k' : tokens;
    
    // Cost calculation:
    // Model: GPT-4o / Claude 3.5 Sonnet = ~$5.00 per 1M input tokens
    // Saved Tokens per query = tokens * (savingsPercentage / 100)
    // Saved Tokens per day = Saved Tokens per query * queries
    // Saved Tokens per month = Saved Tokens per day * 30
    // Total Dollar Savings = (Saved Tokens per month / 1,000,000) * 5.00
    
    let pct = parseFloat(savingsPercentage);
    if (isNaN(pct) || pct <= 0) {
      pct = 25; // Default demo savings if empty
    }

    const savedTokensPerQuery = tokens * (pct / 100);
    const savedTokensPerMonth = savedTokensPerQuery * queries * 30;
    const dollarsSaved = (savedTokensPerMonth / 1_000_000) * 5.00;

    dollarSavings.textContent = dollarsSaved.toFixed(2);
  };

  // Event Listeners
  codeInput.addEventListener('input', updateMinification);
  optDeadCode.addEventListener('change', updateMinification);
  optJsdoc.addEventListener('change', updateMinification);

  queriesSlider.addEventListener('input', () => updateCalculator(parseFloat(savingsPercentSpan.textContent)));
  tokensSlider.addEventListener('input', () => updateCalculator(parseFloat(savingsPercentSpan.textContent)));

  copyBtn.addEventListener('click', () => {
    if (codeOutput.value) {
      navigator.clipboard.writeText(codeOutput.value);
      const originalText = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => copyBtn.textContent = originalText, 2000);
    }
  });

  // Initial Run
  updateMinification();
});
