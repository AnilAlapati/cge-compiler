import * as fs from 'fs';
import { MinifyEngine } from './src/minify/minify_engine';

const engine = new MinifyEngine({ stripDocComments: true });
const raw = fs.readFileSync('benchmarks_real/nestjs-realworld/source/src/article/article.controller.ts', 'utf8');
const result = engine.minify(raw, 'typescript');
console.log("RAW LENGTH:", raw.length);
console.log("MINIFIED LENGTH:", result.output.length);
console.log("--- RAW ---\n" + raw.substring(0, 300) + "...");
console.log("--- MINIFIED ---\n" + result.output.substring(0, 300) + "...");
