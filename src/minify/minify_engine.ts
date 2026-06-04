import { CommentStripper, CommentStripperOptions } from './comment_stripper';
import { DeadCodeDetector, DeadCodeDetectorOptions } from './dead_code_detector';
import { WhitespaceNormalizer, WhitespaceNormalizerOptions } from './whitespace_normalizer';
import { TokenEstimator } from './token_estimator';

export interface MinifyOptions extends CommentStripperOptions, DeadCodeDetectorOptions, WhitespaceNormalizerOptions {}

export interface MinifyResult {
  output: string;
  originalTokens: number;
  minifiedTokens: number;
  savings: {
    totalTokensSaved: number;
    percentSaved: number;
  };
}

export class MinifyEngine {
  private commentStripper: CommentStripper;
  private deadCodeDetector: DeadCodeDetector;
  private whitespaceNormalizer: WhitespaceNormalizer;
  private tokenEstimator: TokenEstimator;

  constructor(options?: Partial<MinifyOptions>) {
    this.commentStripper = new CommentStripper(options);
    this.deadCodeDetector = new DeadCodeDetector(options);
    this.whitespaceNormalizer = new WhitespaceNormalizer(options);
    this.tokenEstimator = new TokenEstimator();
  }

  public minify(code: string, language: string): MinifyResult {
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

    const minifiedTokens = this.tokenEstimator.estimate(finalOutput);
    const totalTokensSaved = originalTokens - minifiedTokens;
    const percentSaved = originalTokens > 0 ? (totalTokensSaved / originalTokens) * 100 : 0;

    return {
      output: finalOutput,
      originalTokens,
      minifiedTokens,
      savings: {
        totalTokensSaved,
        percentSaved: Number(percentSaved.toFixed(2)),
      }
    };
  }
}
