import * as fs from 'fs';
import { LeanContextEngine } from './src/leancontext/leancontext_engine';

const engine = new LeanContextEngine({ stripDocComments: true });
const raw = fs.readFileSync('benchmarks_real/nestjs-realworld/source/src/article/article.controller.ts', 'utf8');
const result = engine.optimize(raw, 'typescript');
console.log("RAW LENGTH:", raw.length);
console.log("OPTIMIZED LENGTH:", result.output.length);
console.log("--- RAW ---\n" + raw.substring(0, 300) + "...");
console.log("--- OPTIMIZED ---\n" + result.output.substring(0, 300) + "...");
