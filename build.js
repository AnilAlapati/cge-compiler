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

// 2. Copy HTML files
if (fs.existsSync(path.join(__dirname, 'index.html'))) {
  fs.copyFileSync(path.join(__dirname, 'index.html'), path.join(distDir, 'index.html'));
}
if (fs.existsSync(path.join(__dirname, 'cge.html'))) {
  fs.copyFileSync(path.join(__dirname, 'cge.html'), path.join(distDir, 'cge.html'));
}
console.log('✓ HTML files copied.');

// 3. Copy and compress CSS files
const compressCss = (filename) => {
  if (!fs.existsSync(path.join(__dirname, filename))) return;
  const css = fs.readFileSync(path.join(__dirname, filename), 'utf-8');
  const minifiedCss = css
    .replace(/\/\*[\s\S]*?\*\//g, '') // remove comments
    .replace(/\s+/g, ' ') // collapse whitespaces
    .replace(/\s*([\{\}:;,])\s*/g, '$1') // trim whitespace around selectors
    .trim();
  fs.writeFileSync(path.join(distDir, filename), minifiedCss, 'utf-8');
  console.log(`✓ ${filename} compressed & copied.`);
};

compressCss('playground.css');
compressCss('leancontext.css');

// 4. Minify JS files using Terser CLI
const minifyJs = (filename) => {
  if (!fs.existsSync(path.join(__dirname, filename))) return;
  console.log(`📦 Minifying ${filename}...`);
  execSync(`npx terser ${filename} --compress --mangle -o dist/${filename}`, { stdio: 'inherit' });
};

minifyJs('playground.js');
minifyJs('leancontext.js');
minifyJs('compiler_worker.js');

console.log('🎉 Build complete! Deploy the contents of the "dist" directory to Vercel.');
