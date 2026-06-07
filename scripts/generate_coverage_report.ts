import * as fs from 'fs';
import * as path from 'path';

const BENCHMARKS_DIR = path.join(__dirname, '..', 'benchmarks_real');
const REPOS = ['domain-driven-hexagon', 'nestjs-boilerplate', 'nestjs-prisma-starter', 'nestjs-realworld', 'ghostfolio'];

interface RepoCoverage {
    routes: number;
    services: number;
    entities: number;
    middleware: number;
}

function getGraphCounts(repoDir: string): RepoCoverage {
    const graphPath = path.join(repoDir, 'source', 'architecture_graph.json');
    if (!fs.existsSync(graphPath)) {
        return { routes: 0, services: 0, entities: 0, middleware: 0 };
    }
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    const counts = { routes: 0, services: 0, entities: 0, middleware: 0 };
    for (const node of graph.nodes) {
        if (node.type === 'route') counts.routes++;
        else if (node.type === 'service') counts.services++;
        else if (node.type === 'entity') counts.entities++;
        else if (node.type === 'middleware') counts.middleware++;
    }
    return counts;
}

const report: Record<string, RepoCoverage> = {};
for (const repo of REPOS) {
    const repoDir = path.join(BENCHMARKS_DIR, repo);
    report[repo] = getGraphCounts(repoDir);
}

const reportPath = path.join(BENCHMARKS_DIR, 'coverage_report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`Generated coverage_report.json`);
console.table(report);
