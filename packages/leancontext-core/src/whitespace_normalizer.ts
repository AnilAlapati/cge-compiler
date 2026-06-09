export interface WhitespaceNormalizerOptions {
  normalizeNewlines: boolean;
  stripTrailingWhitespace: boolean;
}

export class WhitespaceNormalizer {
  private options: WhitespaceNormalizerOptions;

  constructor(options?: Partial<WhitespaceNormalizerOptions>) {
    this.options = {
      normalizeNewlines: true,
      stripTrailingWhitespace: true,
      ...options,
    };
  }

  public normalize(code: string): string {
    let result = code;

    if (this.options.stripTrailingWhitespace) {
      // Remove trailing whitespace from each line
      result = result.replace(/[ \t]+$/gm, '');
    }

    if (this.options.normalizeNewlines) {
      // Collapse 3 or more consecutive newlines into exactly 2 newlines (1 blank line)
      result = result.replace(/\n{3,}/g, '\n\n');
    }

    return result.trim() + '\n';
  }
}
