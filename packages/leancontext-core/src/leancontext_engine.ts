import { CommentStripper, CommentStripperOptions } from './comment_stripper';
import { DeadCodeDetector, DeadCodeDetectorOptions } from './dead_code_detector';
import { WhitespaceNormalizer, WhitespaceNormalizerOptions } from './whitespace_normalizer';
import { TokenEstimator } from './token_estimator';

export interface LeanContextOptions extends CommentStripperOptions, DeadCodeDetectorOptions, WhitespaceNormalizerOptions {}

export interface LeanContextResult {
  output: string;
  originalTokens: number;
  optimizedTokens: number;
  savings: {
    totalTokensSaved: number;
    percentSaved: number;
  };
}

export class LeanContextEngine {
  private commentStripper: CommentStripper;
  private deadCodeDetector: DeadCodeDetector;
  private whitespaceNormalizer: WhitespaceNormalizer;
  private tokenEstimator: TokenEstimator;

  constructor(options?: Partial<LeanContextOptions>) {
    this.commentStripper = new CommentStripper(options);
    this.deadCodeDetector = new DeadCodeDetector(options);
    this.whitespaceNormalizer = new WhitespaceNormalizer(options);
    this.tokenEstimator = new TokenEstimator();
  }

  public optimize(code: string, language: string): LeanContextResult {
    const originalTokens = this.tokenEstimator.estimate(code);

    // 1. Strip comments (docstrings, line comments, block comments based on options)
    let processed = this.commentStripper.strip(code, language);

    // 2. Strip dead code (commented-out blocks of code that slipped through or if comments were disabled but we still want dead code gone)
    // Actually, DeadCodeDetector works on line comments, so if CommentStripper removed all comments, this does nothing.
    // However, if we preserve some comments, we can still strip dead code. 
    // To make this work best, DeadCodeDetector should run BEFORE CommentStripper.
    // Let's swap the order!
    
    let pass1 = this.deadCodeDetector.process(code);
    let pass2 = this.commentStripper.strip(pass1, language);

    // 3. Normalize whitespace
    let finalOutput = this.whitespaceNormalizer.normalize(pass2);

    const optimizedTokens = this.tokenEstimator.estimate(finalOutput);
    const totalTokensSaved = originalTokens - optimizedTokens;
    const percentSaved = originalTokens > 0 ? (totalTokensSaved / originalTokens) * 100 : 0;

    return {
      output: finalOutput,
      originalTokens,
      optimizedTokens,
      savings: {
        totalTokensSaved,
        percentSaved: Number(percentSaved.toFixed(2)),
      }
    };
  }
}

export interface ContextStats {
  files: number;
  originalTokens: number;
  minifiedTokens: number;
  savedTokens: number;
  savingsPercent: number;
}

export function processFile(content: string, lang: string, options?: Partial<LeanContextOptions>): LeanContextResult {
  const engine = new LeanContextEngine(options);
  return engine.optimize(content, lang);
}

export function processFiles(files: { path: string; content: string; lang: string }[], options?: Partial<LeanContextOptions>): { context: string; stats: ContextStats } {
  let context = "";
  let totalFiles = 0;
  let totalOrigTokens = 0;
  let totalOptTokens = 0;

  const engine = new LeanContextEngine(options);

  for (const file of files) {
    const result = engine.optimize(file.content, file.lang);
    context += `<file path="${file.path}">\n${result.output}\n</file>\n\n`;
    totalFiles++;
    totalOrigTokens += result.originalTokens;
    totalOptTokens += result.optimizedTokens;
  }

  const savedTokens = totalOrigTokens - totalOptTokens;
  const savingsPercent = totalOrigTokens > 0 ? Number(((savedTokens / totalOrigTokens) * 100).toFixed(1)) : 0;

  return {
    context: context.trim(),
    stats: {
      files: totalFiles,
      originalTokens: totalOrigTokens,
      minifiedTokens: totalOptTokens,
      savedTokens,
      savingsPercent
    }
  };
}

export function buildXmlPackage(files: { path: string; optimizedContent: string }[]): string {
  let result = "";
  for (const file of files) {
    result += `<file path="${file.path}">\n${file.optimizedContent}\n</file>\n\n`;
  }
  return result.trim();
}
