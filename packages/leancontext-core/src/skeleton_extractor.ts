/**
 * SkeletonExtractor — V1
 *
 * Extracts the architectural skeleton of TypeScript/JavaScript code.
 * Keeps: imports, exports, class/interface/type declarations, function signatures.
 * Removes: function/method bodies (content between { }).
 *
 * Approach: line-by-line brace-depth counter. No AST, no dependencies.
 *
 * Languages supported in V1: typescript, javascript (and tsx/jsx variants).
 * For all other languages, the input is returned unchanged.
 */

const SUPPORTED_LANGS = new Set(['typescript', 'javascript', 'ts', 'js', 'tsx', 'jsx']);

// Lines that should always be kept verbatim (never treated as body start)
const KEEP_PATTERNS = [
  /^\s*import\b/,
  /^\s*export\s+(?:type\s+)?(?:interface|enum|type)\b/,
  /^\s*(?:export\s+)?interface\b/,
  /^\s*(?:export\s+)?type\s+\w+\s*=/,
  /^\s*(?:export\s+)?enum\b/,
  /^\s*(?:export\s+)?(?:abstract\s+)?class\b/,
  /^\s*(?:\/\*\*|\/\/|#)/,  // comments — let comment_stripper handle them
  /^\s*@\w+/,               // decorators
];

// Lines that indicate the start of a function/method body to be stripped
// Must end with `{` (optionally with trailing whitespace/comment)
const BODY_START_PATTERNS = [
  // method/function ending with {
  /\)\s*(?::\s*[\w<>[\]|&.,\s?]+)?\s*\{[\s\t]*(\/\/.*)?$/,
  // arrow function body: => {
  /=>\s*\{[\s\t]*(\/\/.*)?$/,
  // constructor(...) {
  /constructor\s*\([^)]*\)\s*\{[\s\t]*(\/\/.*)?$/,
  // getter/setter: get foo() {
  /(?:get|set)\s+\w+\s*\([^)]*\)\s*\{[\s\t]*(\/\/.*)?$/,
];

// Lines that start an inline block we want to collapse (class/if/try etc.)
// but are NOT function signatures — we keep these
const STRUCTURAL_PATTERNS = [
  /^\s*(?:if|else|for|while|switch|try|catch|finally|do)\b/,
  /^\s*\}\s*(?:else|catch|finally)\b/,
];

function isBodyStart(line: string): boolean {
  // Must have an opening brace
  if (!line.includes('{')) return false;

  // Skip structural keywords — we never strip their bodies
  for (const p of STRUCTURAL_PATTERNS) {
    if (p.test(line)) return false;
  }

  // Skip always-keep lines
  for (const p of KEEP_PATTERNS) {
    if (p.test(line)) return false;
  }

  // Match actual function/method signature patterns
  for (const p of BODY_START_PATTERNS) {
    if (p.test(line)) return true;
  }

  return false;
}

/**
 * Extracts the signature portion of a body-start line (removes the trailing `{`).
 * e.g. "  async createUser(dto: CreateUserDto): Promise<User> {" → "  async createUser(dto: CreateUserDto): Promise<User>"
 */
function extractSignature(line: string): string {
  // Remove the trailing { and any trailing comment after it
  return line.replace(/\s*\{[\s\t]*(\/\/.*)?$/, '').trimEnd();
}

export class SkeletonExtractor {
  /**
   * Extract skeleton from code. Returns the input unchanged for unsupported languages.
   */
  public extract(code: string, language: string): string {
    if (!SUPPORTED_LANGS.has(language.toLowerCase())) {
      return code;
    }

    const lines = code.split('\n');
    const output: string[] = [];

    let depth = 0;          // brace depth
    let skipping = false;   // are we inside a body we're stripping?
    let skipDepth = 0;      // depth at which stripping started

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Count braces in this line (respecting strings is hard without a full parser;
      // for V1 we count raw braces — this works correctly for the vast majority of real code)
      const openCount = (line.match(/\{/g) || []).length;
      const closeCount = (line.match(/\}/g) || []).length;

      if (skipping) {
        depth += openCount - closeCount;
        if (depth <= skipDepth) {
          // We've reached the end of the body
          skipping = false;
          // Emit the closing brace indented to match the original
          const indent = line.match(/^(\s*)/)?.[1] ?? '';
          output.push(`${indent}}`);
        }
        // While skipping, emit nothing else
        continue;
      }

      // Not currently skipping — check if this line starts a body to strip
      if (isBodyStart(line)) {
        const sig = extractSignature(line);
        output.push(sig);
        skipDepth = depth;
        depth += openCount - closeCount;

        // If the body is opened AND closed on the same line (e.g. `get x() { return this._x; }`)
        // — treat it as a one-liner and skip nothing
        if (depth <= skipDepth) {
          // Same-line close — just emit the signature without body
          output[output.length - 1] = sig;
          continue;
        }

        skipping = true;
        continue;
      }

      // Normal line — emit as-is
      output.push(line);
      depth += openCount - closeCount;
    }

    return output.join('\n');
  }
}
