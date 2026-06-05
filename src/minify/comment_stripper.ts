export interface CommentStripperOptions {
  stripLineComments: boolean;
  stripBlockComments: boolean;
  stripDocComments: boolean;
  preserveTodos: boolean;
}

export class CommentStripper {
  private options: CommentStripperOptions;

  constructor(options?: Partial<CommentStripperOptions>) {
    this.options = {
      stripLineComments: true,
      stripBlockComments: true,
      stripDocComments: false,
      preserveTodos: true,
      ...options,
    };
  }

  public strip(code: string, language: string): string {
    // For now, we use a robust state-machine approach for C-style languages (TS, JS, C++, Go, Rust)
    // Python requires a different state machine for # and """ """.
    
    if (['python', 'py'].includes(language.toLowerCase())) {
      return this.stripPython(code);
    }
    
    return this.stripCStyle(code);
  }

  private stripCStyle(code: string): string {
    let result = '';
    let i = 0;
    
    let inString = false;
    let stringChar = '';
    let inLineComment = false;
    let inBlockComment = false;
    let inDocComment = false;
    
    // To preserve TODOs
    let currentComment = '';

    while (i < code.length) {
      const char = code[i];
      const nextChar = code[i + 1];

      if (inString) {
        result += char;
        if (char === '\\') {
          result += nextChar || '';
          i += 2;
          continue;
        }
        if (char === stringChar) {
          inString = false;
        }
        i++;
        continue;
      }

      if (inLineComment) {
        currentComment += char;
        if (char === '\n') {
          inLineComment = false;
          if (this.shouldPreserveComment(currentComment)) {
            result += currentComment;
          } else {
            result += '\n'; // Keep the newline to not break syntax
          }
          currentComment = '';
        }
        i++;
        continue;
      }

      if (inBlockComment) {
        currentComment += char;
        if (char === '*' && nextChar === '/') {
          currentComment += '/';
          inBlockComment = false;
          inDocComment = false;
          if (this.shouldPreserveComment(currentComment)) {
            result += currentComment;
          }
          currentComment = '';
          i += 2;
          continue;
        }
        i++;
        continue;
      }

      // Check for comments start
      if (char === '/' && nextChar === '/') {
        inLineComment = true;
        currentComment = '//';
        i += 2;
        continue;
      }

      if (char === '/' && nextChar === '*') {
        inBlockComment = true;
        currentComment = '/*';
        if (code[i + 2] === '*') {
          inDocComment = true;
          currentComment = '/**';
          i += 3;
          continue;
        }
        i += 2;
        continue;
      }

      // Check for string start
      if (char === '"' || char === "'" || char === '`') {
        inString = true;
        stringChar = char;
        result += char;
        i++;
        continue;
      }

      result += char;
      i++;
    }

    return result;
  }

  private stripPython(code: string): string {
    let result = '';
    let i = 0;
    
    let inString = false;
    let stringChar = '';
    let inLineComment = false;
    
    let currentComment = '';

    while (i < code.length) {
      const char = code[i];
      const nextChar = code[i + 1];
      const thirdChar = code[i + 2];

      if (inLineComment) {
        currentComment += char;
        if (char === '\n') {
          inLineComment = false;
          if (this.shouldPreserveComment(currentComment)) {
            result += currentComment;
          } else {
            result += '\n';
          }
          currentComment = '';
        }
        i++;
        continue;
      }

      if (inString) {
        result += char;
        if (char === '\\') {
          result += nextChar || '';
          i += 2;
          continue;
        }
        
        // Handle closing triple quotes
        if (stringChar === '"""' || stringChar === "'''") {
          if (char === stringChar.charAt(0) && nextChar === stringChar.charAt(0) && thirdChar === stringChar.charAt(0)) {
            result += char + char; // Add the other two
            inString = false;
            i += 3;
            continue;
          }
        } else if (char === stringChar) {
          inString = false;
        }
        i++;
        continue;
      }

      // Check for triple quotes (docstrings)
      if ((char === '"' || char === "'") && nextChar === char && thirdChar === char) {
        if (!this.options.stripDocComments) {
          inString = true;
          stringChar = char + char + char;
          result += stringChar;
        } else {
          // If we are stripping docstrings, we need to skip until the next triple quote
          let j = i + 3;
          let foundEnd = false;
          while (j < code.length) {
            if (code[j] === char && code[j+1] === char && code[j+2] === char) {
              j += 3;
              foundEnd = true;
              break;
            }
            if (code[j] === '\\') j++; // Skip escaped
            j++;
          }
          if (foundEnd) {
            i = j;
            continue;
          }
        }
      }

      // Check for string start
      if (char === '"' || char === "'") {
        inString = true;
        stringChar = char;
        result += char;
        i++;
        continue;
      }

      // Check for comment start
      if (char === '#') {
        inLineComment = true;
        currentComment = '#';
        i++;
        continue;
      }

      result += char;
      i++;
    }

    return result;
  }

  private shouldPreserveComment(comment: string): boolean {
    if (comment.startsWith('/**') && !this.options.stripDocComments) {
      return true;
    }
    
    if (this.options.preserveTodos) {
      const upper = comment.toUpperCase();
      if (upper.includes('TODO:') || upper.includes('FIXME:') || upper.includes('HACK:')) {
        return true;
      }
    }
    
    return false;
  }
}
