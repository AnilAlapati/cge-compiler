/**
 * measure_token_metrics.ts
 *
 * Measures token counts, compression ratios, and estimated API cost per repository.
 * Does NOT make any LLM calls — purely local measurement.
 *
 * Cost model: gpt-4o-mini @ $0.15 / 1M input tokens (as of June 2026)
 * Outputs: benchmarks_real/repo_metrics.json and a markdown table.
 */

import * as fs from 'fs';
import * as path from 'path';

const BENCHMARKS_DIR = path.join(__dirname, '..', 'benchmarks_real');

// Cost per million input tokens for gpt-4o-mini
const COST_PER_MILLION_TOKENS = 0.15;

// Rough approximation: 1 token ≈ 4 chars (OpenAI standard estimate for English/code)
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function formatNumber(n: number): string {
    return n.toLocaleString('en-US');
}

function formatCost(n: number): string {
    if (n < 0.01) return `$${n.toFixed(5)}`;
    return `$${n.toFixed(4)}`;
}

function getSourceText(sourceDir: string): string {
    let text = '';
    if (!fs.existsSync(sourceDir)) return text;

    const walk = (d: string) => {
        const files = fs.readdirSync(d);
        for (const file of files) {
            const fullPath = path.join(d, file);
            if (fs.statSync(fullPath).isDirectory()) {
                const name = path.basename(fullPath);
                if (['node_modules', 'dist', 'build', 'client', 'frontend', 'test', 'e2e'].includes(name) || name.startsWith('.')) continue;
                walk(fullPath);
            } else if (fullPath.endsWith('.ts') && !fullPath.includes('.spec.ts') && !fullPath.includes('.test.ts') && !fullPath.endsWith('.d.ts')) {
                text += fs.readFileSync(fullPath, 'utf8') + '\n';
            }
        }
    };
    walk(sourceDir);
    return text;
}

interface RepoMetrics {
    repo: string;
    rawTokens: number;
    mapTokens: number;
    rawPlusMapTokens: number;
    compressionRatio: number;
    tokenReductionPercent: number;
    costRawPerQuery: number;
    costMapPerQuery: number;
    costSavingPerQuery: number;
    costSaving100Queries: number;
    mapFileExists: boolean;
    rawCharacters: number;
    mapCharacters: number;
}

function main() {
    const repos = fs.readdirSync(BENCHMARKS_DIR, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .filter(n => !['express-real', 'flask-real'].includes(n));

    const metrics: RepoMetrics[] = [];

    console.log('Measuring token metrics...\n');

    for (const repo of repos) {
        const repoDir = path.join(BENCHMARKS_DIR, repo);
        const sourceDir = path.join(repoDir, 'source');
        const mapPath = path.join(sourceDir, 'GENERATED_ARCHITECTURE.md');

        process.stdout.write(`  Processing ${repo}... `);

        const rawText = getSourceText(sourceDir);
        const rawTokens = estimateTokens(rawText);
        const rawChars = rawText.length;

        const mapExists = fs.existsSync(mapPath);
        const mapText = mapExists ? fs.readFileSync(mapPath, 'utf8') : '';
        const mapTokens = estimateTokens(mapText);
        const mapChars = mapText.length;

        const rawPlusMapTokens = rawTokens + mapTokens;
        const compressionRatio = rawTokens > 0 ? rawTokens / (mapTokens || 1) : 0;
        const tokenReductionPercent = rawTokens > 0 ? ((rawTokens - mapTokens) / rawTokens) * 100 : 0;

        const costPerMillionTokens = COST_PER_MILLION_TOKENS;
        const costRawPerQuery = (rawTokens / 1_000_000) * costPerMillionTokens;
        const costMapPerQuery = (mapTokens / 1_000_000) * costPerMillionTokens;
        const costSavingPerQuery = costRawPerQuery - costMapPerQuery;
        const costSaving100Queries = costSavingPerQuery * 100;

        const m: RepoMetrics = {
            repo,
            rawTokens,
            mapTokens,
            rawPlusMapTokens,
            compressionRatio: parseFloat(compressionRatio.toFixed(1)),
            tokenReductionPercent: parseFloat(tokenReductionPercent.toFixed(1)),
            costRawPerQuery: parseFloat(costRawPerQuery.toFixed(6)),
            costMapPerQuery: parseFloat(costMapPerQuery.toFixed(6)),
            costSavingPerQuery: parseFloat(costSavingPerQuery.toFixed(6)),
            costSaving100Queries: parseFloat(costSaving100Queries.toFixed(4)),
            mapFileExists: mapExists,
            rawCharacters: rawChars,
            mapCharacters: mapChars,
        };

        metrics.push(m);
        console.log(`done (${formatNumber(rawTokens)} raw tokens → ${formatNumber(mapTokens)} map tokens)`);
    }

    // Write JSON output
    const jsonPath = path.join(BENCHMARKS_DIR, 'repo_metrics.json');
    fs.writeFileSync(jsonPath, JSON.stringify(metrics, null, 2));
    console.log(`\nWrote ${jsonPath}`);

    // Build Markdown table
    let md = `# Repository Token & Cost Metrics\n\n`;
    md += `> Cost model: gpt-4o-mini @ $${COST_PER_MILLION_TOKENS}/1M input tokens. Token estimate: 1 token ≈ 4 chars.\n\n`;
    md += `## Context Compression\n\n`;
    md += `| Repository | Raw Tokens | Map Tokens | Raw+Map Tokens | Compression | Reduction |\n`;
    md += `| ---------- | ---------- | ---------- | -------------- | ----------- | --------- |\n`;
    for (const m of metrics) {
        const mapStr = m.mapFileExists ? formatNumber(m.mapTokens) : '*(no map)*';
        md += `| ${m.repo} | ${formatNumber(m.rawTokens)} | ${mapStr} | ${formatNumber(m.rawPlusMapTokens)} | ${m.compressionRatio}x | ${m.tokenReductionPercent}% |\n`;
    }

    md += `\n## Cost Per Query (Single Question)\n\n`;
    md += `| Repository | Cost (Raw) | Cost (Map Only) | Saving/Query | Saving/100 Queries |\n`;
    md += `| ---------- | ---------- | --------------- | ------------ | ------------------ |\n`;
    for (const m of metrics) {
        md += `| ${m.repo} | ${formatCost(m.costRawPerQuery)} | ${formatCost(m.costMapPerQuery)} | ${formatCost(m.costSavingPerQuery)} | ${formatCost(m.costSaving100Queries)} |\n`;
    }

    md += `\n## Key Takeaways\n\n`;
    const valid = metrics.filter(m => m.mapFileExists && m.mapTokens > 0);
    if (valid.length > 0) {
        const avgReduction = valid.reduce((s, m) => s + m.tokenReductionPercent, 0) / valid.length;
        const avgCompression = valid.reduce((s, m) => s + m.compressionRatio, 0) / valid.length;
        md += `- Average token reduction across repos: **${avgReduction.toFixed(1)}%**\n`;
        md += `- Average compression ratio: **${avgCompression.toFixed(1)}x**\n`;
        md += `- A map-only agent query costs roughly **${(avgReduction).toFixed(0)}% less** than a raw code query.\n`;
    }

    const mdPath = path.join(BENCHMARKS_DIR, 'token_metrics_report.md');
    fs.writeFileSync(mdPath, md);
    console.log(`Wrote ${mdPath}`);

    // Print summary table to stdout
    console.log('\n--- Summary ---\n');
    console.log(`${'Repo'.padEnd(30)} ${'Raw Tokens'.padStart(12)} ${'Map Tokens'.padStart(12)} ${'Compression'.padStart(12)} ${'Reduction'.padStart(10)}`);
    console.log('-'.repeat(80));
    for (const m of metrics) {
        const mapStr = m.mapFileExists ? formatNumber(m.mapTokens).padStart(12) : '*(no map)*'.padStart(12);
        console.log(`${m.repo.padEnd(30)} ${formatNumber(m.rawTokens).padStart(12)} ${mapStr} ${(m.compressionRatio + 'x').padStart(12)} ${(m.tokenReductionPercent + '%').padStart(10)}`);
    }
}

main();
