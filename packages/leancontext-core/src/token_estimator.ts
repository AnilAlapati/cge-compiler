export class TokenEstimator {
  // A rough heuristic for English/Code tokenization
  // GPT-4 tokenizes code at roughly 3.2 - 3.8 characters per token.
  private readonly CHARS_PER_TOKEN = 3.5;

  public estimate(code: string): number {
    return Math.ceil(code.length / this.CHARS_PER_TOKEN);
  }
}
