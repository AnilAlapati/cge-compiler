const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const distDir = path.join(__dirname, 'dist');

// 1. Clean and recreate dist/
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir);

console.log('⚡ Starting build & minification process...');

// 2. Copy index.html
fs.copyFileSync(
  path.join(__dirname, 'index.html'),
  path.join(distDir, 'index.html')
);
console.log('✓ index.html copied.');

// 3. Copy playground.css (or simple compression by removing whitespace)
const css = fs.readFileSync(path.join(__dirname, 'playground.css'), 'utf-8');
const minifiedCss = css
  .replace(/\/\*[\s\S]*?\*\//g, '') // remove comments
  .replace(/\s+/g, ' ') // collapse whitespaces
  .replace(/\s*([\{\}:;,])\s*/g, '$1') // trim whitespace around selectors
  .trim();
fs.writeFileSync(path.join(distDir, 'playground.css'), minifiedCss, 'utf-8');
console.log('✓ playground.css compressed & copied.');

// 4. Minify JS files using Terser CLI
console.log('📦 Minifying playground.js...');
execSync('npx terser playground.js --compress --mangle -o dist/playground.js', { stdio: 'inherit' });

console.log('📦 Minifying compiler_worker.js...');
execSync('npx terser compiler_worker.js --compress --mangle -o dist/compiler_worker.js', { stdio: 'inherit' });

console.log('🎉 Build complete! Deploy the contents of the "dist" directory to Vercel.');
