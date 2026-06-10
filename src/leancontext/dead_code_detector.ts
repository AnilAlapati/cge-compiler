export interface DeadCodeDetectorOptions {
  stripDeadCode: boolean;
}

export class DeadCodeDetector {
  private options: DeadCodeDetectorOptions;

  // Patterns that strongly suggest a line of text is actually source code
  private codePatterns = [
    // Assignments and declarations
    /^(?:const|let|var)\s+\w+\s*=/,
    /^\s*\w+\s*=\s*.+;?$/,
    /^\s*this\.\w+\s*=/,
    
    // Control flow
    /^\s*if\s*\(/,
    /^\s*for\s*\(/,
    /^\s*while\s*\(/,
    /^\s*switch\s*\(/,
    
    // Function declarations
    /^\s*function\s+\w+\s*\(/,
    /^\s*async\s+function\s*\w*\s*\(/,
    /^\s*const\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/,
    
    // Class definitions
    /^\s*class\s+\w+\s*(?:\{|extends|implements)/,
    
    // Imports/Exports
    /^\s*import\s+.*from\s+['"]/,
    /^\s*export\s+(?:const|let|var|class|interface|type|function)/,
    
    // HTML/JSX tags
    /^\s*<[a-zA-Z]+/,
    
    // Structural syntax alone (usually part of a larger commented block)
    /^\s*};\s*$/,
    /^\s*}\s*$/,
    /^\s*\];\s*$/,
  ];

  constructor(options?: Partial<DeadCodeDetectorOptions>) {
    this.options = {
      stripDeadCode: true,
      ...options,
    };
  }

  public process(code: string): string {
    if (!this.options.stripDeadCode) {
      return code;
    }

    const lines = code.split('\n');
    const result: string[] = [];
    
    let consecutiveCommentedCodeLines = 0;

    for (const line of lines) {
      const trimmed = line.trim();

      // We only analyze single-line comments for dead code
      // (Block comments containing code should ideally be caught by block comment stripper)
      if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
        const commentContent = trimmed.substring(trimmed.startsWith('//') ? 2 : 1).trim();
        
        if (this.isLikelyCode(commentContent)) {
          consecutiveCommentedCodeLines++;
          // Skip pushing this line
          continue;
        } else {
          // If we had a block of code and suddenly hit a regular comment, we reset
          consecutiveCommentedCodeLines = 0;
          result.push(line);
        }
      } else {
        consecutiveCommentedCodeLines = 0;
        result.push(line);
      }
    }

    return result.join('\n');
  }

  private isLikelyCode(text: string): boolean {
    if (text.length < 3) return false;
    
    // If it ends with a semicolon and has some code-like characters, it's probably code
    if (text.endsWith(';') && /[a-zA-Z0-9]/.test(text)) {
      return true;
    }

    // Check against common structural patterns
    for (const pattern of this.codePatterns) {
      if (pattern.test(text)) {
        return true;
      }
    }

    return false;
  }
}
