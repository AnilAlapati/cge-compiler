const fs = require('fs');

function autoDetectLanguage(code) {
  if (!code || code.trim().length < 10) return null;
  
  const hasPython = /\bdef\b|\belif\b|:\s*\n\s+/.test(code) && !/[{}]/.test(code.substring(0, 50));
  const hasRust = /\bfn\b|\bimpl\b|\bpub\s+(?:struct|fn|enum)\b/.test(code);
  const hasGo = /\bfunc\b|\bpackage\b|\bchan\b/.test(code);
  const hasCpp = /#include|\bstd::\b|\bint\s+main\s*\(/.test(code);
  const hasTS = /\binterface\b|\bexport\b/.test(code);
  
  let matches = 0;
  let detected = null;
  
  if (hasPython) { matches++; detected = "python"; }
  if (hasRust) { matches++; detected = "rust"; }
  if (hasGo) { matches++; detected = "go"; }
  if (hasCpp) { matches++; detected = "cpp"; }
  if (hasTS) { matches++; detected = "typescript"; }

  return matches === 1 ? detected : null;
}

// Generate test data
const testCases = [];

// TypeScript/JavaScript examples (50)
for (let i = 0; i < 20; i++) testCases.push({ lang: "typescript", code: `export const func${i} = () => {};` });
for (let i = 0; i < 15; i++) testCases.push({ lang: "typescript", code: `interface User${i} { id: string; }` });
for (let i = 0; i < 15; i++) testCases.push({ lang: "typescript", code: `let ambiguous_ts_var_${i} = 0; // Too short/ambiguous` });

// Python examples (50)
for (let i = 0; i < 20; i++) testCases.push({ lang: "python", code: `def process_data_${i}(self):\n    return True` });
for (let i = 0; i < 15; i++) testCases.push({ lang: "python", code: `class DataModel_${i}:\n    id = 1` });
for (let i = 0; i < 15; i++) testCases.push({ lang: "python", code: `ambiguous_py_var_${i} = 0 # Too short/ambiguous` });

// Rust examples (50)
for (let i = 0; i < 20; i++) testCases.push({ lang: "rust", code: `pub fn get_user_${i}() -> bool { true }` });
for (let i = 0; i < 15; i++) testCases.push({ lang: "rust", code: `impl User${i} { fn new() {} }` });
for (let i = 0; i < 15; i++) testCases.push({ lang: "rust", code: `let mut ambiguous_rs_var_${i} = 0; // Too short/ambiguous` });

// Go examples (50)
for (let i = 0; i < 20; i++) testCases.push({ lang: "go", code: `func HandleRequest_${i}() error { return nil }` });
for (let i = 0; i < 15; i++) testCases.push({ lang: "go", code: `package main\nimport "fmt"\nfunc main() {}` });
for (let i = 0; i < 15; i++) testCases.push({ lang: "go", code: `ambiguous_go_var_${i} := 0 // Too short/ambiguous` });

// C++ examples (50)
for (let i = 0; i < 20; i++) testCases.push({ lang: "cpp", code: `#include <iostream>\nint main() { return 0; }` });
for (let i = 0; i < 15; i++) testCases.push({ lang: "cpp", code: `std::string getName_${i}() { return ""; }` });
for (let i = 0; i < 15; i++) testCases.push({ lang: "cpp", code: `int ambiguous_cpp_var_${i} = 0; // Too short/ambiguous` });


// Run Evaluation
const results = {
  total: testCases.length,
  correct: 0,
  ambiguous: 0,
  misclassified: 0,
  details: []
};

testCases.forEach(tc => {
  const detected = autoDetectLanguage(tc.code);
  if (detected === tc.lang) {
    results.correct++;
  } else if (detected === null) {
    results.ambiguous++;
  } else {
    results.misclassified++;
    results.details.push(`MISMATCH: Expected ${tc.lang}, Got ${detected} -> Code: ${tc.code}`);
  }
});

console.log(JSON.stringify(results, null, 2));
