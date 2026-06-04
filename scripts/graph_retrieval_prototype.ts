import * as fs from 'fs';
import * as path from 'path';

const REPO = 'ghostfolio';
const BENCHMARKS_DIR = path.join(__dirname, '..', 'benchmarks_real');
const REPO_DIR = path.join(BENCHMARKS_DIR, REPO);
const GRAPH_FILE = path.join(REPO_DIR, 'source', 'architecture_graph.json');

function getKeywords(question: string): string[] {
    // A simple heuristic keyword extractor (ignore common English words and question words)
    const ignoreList = new Set(['what', 'how', 'which', 'who', 'where', 'when', 'why', 'are', 'is', 'the', 'in', 'and', 'or', 'to', 'from', 'does', 'do', 'did', 'system', 'use', 'used', 'by', 'of', 'for', 'with', 'on', 'at']);
    const words = question.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
    return words.filter(w => w.length > 2 && !ignoreList.has(w));
}

function runRetrieval(question: string) {
    if (!fs.existsSync(GRAPH_FILE)) {
        console.error("Missing architecture_graph.json");
        return;
    }

    const graph = JSON.parse(fs.readFileSync(GRAPH_FILE, 'utf8'));
    const keywords = getKeywords(question);
    
    // 1. Keyword match against nodes
    const scoredNodes = graph.nodes.map((node: any) => {
        let score = 0;
        const label = node.label.toLowerCase();
        for (const kw of keywords) {
            if (label.includes(kw)) score += 2;
        }
        return { node, score };
    }).filter((n: any) => n.score > 0);

    scoredNodes.sort((a: any, b: any) => b.score - a.score);
    const topNodes = scoredNodes.slice(0, 5).map((n: any) => n.node);

    // 2. Find connected files
    const relevantFileIds = new Set<string>();
    for (const node of topNodes) {
        if (node.type === 'file') {
            relevantFileIds.add(node.id);
        } else {
            // Find edges connecting this node to a file
            for (const edge of graph.edges) {
                if (edge.source === node.id && edge.target.startsWith('file:')) {
                    relevantFileIds.add(edge.target);
                }
                if (edge.target === node.id && edge.source.startsWith('file:')) {
                    relevantFileIds.add(edge.source);
                }
            }
        }
    }

    // 3. Resolve file names
    const filePaths = Array.from(relevantFileIds).map(id => {
        const fileNode = graph.nodes.find((n: any) => n.id === id);
        return fileNode ? fileNode.label : id.replace('file:', '');
    });

    console.log(`Question: ${question}`);
    console.log(`Keywords: ${keywords.join(', ')}`);
    console.log(`Top Matched Nodes: ${topNodes.map((n: any) => n.label).join(', ')}`);
    console.log(`Relevant Files (${filePaths.length}):`);
    filePaths.slice(0, 10).forEach(f => console.log(`  - ${f}`));
    console.log();
}

// Test on a few questions
runRetrieval("How is portfolio performance calculated?");
runRetrieval("Which services depend on market data?");
runRetrieval("How are jobs scheduled?");
