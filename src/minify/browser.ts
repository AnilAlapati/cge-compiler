import { MinifyEngine, MinifyOptions, MinifyResult } from './minify_engine';

// Expose the MinifyEngine to the global window object for browser usage
(window as any).MinifyEngine = MinifyEngine;
