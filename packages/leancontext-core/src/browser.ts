import { LeanContextEngine, LeanContextOptions, LeanContextResult } from './leancontext_engine';

// Expose the LeanContextEngine to the global window object for browser usage
(window as any).LeanContextEngine = LeanContextEngine;
