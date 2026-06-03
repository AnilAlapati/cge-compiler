import * as fs from 'fs';
import * as path from 'path';
import { TypeScriptParserPhase2 } from './typescript_parser_phase2';
import { PythonParserPhase2 } from './python_parser_phase2';

export interface GraphNode {
    id: string;
    type: 'file' | 'route' | 'entity' | 'service' | 'middleware';
    label: string;
    metadata?: Record<string, string>;
}

export interface GraphEdge {
    source: string;
    target: string;
    type: 'has_route' | 'depends_on' | 'relates_to' | 'uses_middleware';
    label?: string | undefined;
}

export interface ArchitectureGraph {
    generatedAt: string;
    rootDir: string;
    nodes: GraphNode[];
    edges: GraphEdge[];
}

export class ArchitectureMapGeneratorPhase2 {
    private tsParser = new TypeScriptParserPhase2();
    private pyParser = new PythonParserPhase2();

    public async generate(rootDir: string, outputFile: string = 'ARCHITECTURE_phase2.md'): Promise<void> {
        console.log(`Starting Phase 2 Architecture Mapping on: ${rootDir}`);
        const files = this.walkDir(rootDir);
        
        let topology: string[] = [];
        let routesMap: string[] = [];
        let permissionsMap: string[] = [];
        let dependenciesMap: string[] = [];
        let middlewareMap: string[] = [];
        let entityRelationsMap: string[] = [];

        for (const file of files) {
            if (file.includes('node_modules') || file.includes('.git') || file.includes('/dist/') || file.includes('.spec.ts') || file.includes('.spec.js')) continue;

            const ext = path.extname(file).toLowerCase();
            const relPath = path.relative(rootDir, file);
            
            try {
                const code = fs.readFileSync(file, 'utf-8');
                let parsed: any = null;

                if (['.ts', '.js', '.tsx', '.jsx'].includes(ext)) {
                    parsed = this.tsParser.parse(code, file);
                } else if (ext === '.py') {
                    parsed = this.pyParser.parse(code, file);
                }

                if (parsed) {
                    topology.push(`- **${relPath}**: Exports ${parsed.exports.join(', ') || 'None'}`);
                    
                    if (parsed.routes && parsed.routes.length > 0) {
                        parsed.routes.forEach((r: string) => routesMap.push(`- [${relPath}] ${r}`));
                    }
                    if (parsed.permissions && parsed.permissions.length > 0) {
                        parsed.permissions.forEach((p: string) => permissionsMap.push(`- [${relPath}] ${p}`));
                    }
                    if (parsed.dependencies && parsed.dependencies.length > 0) {
                        parsed.dependencies.forEach((d: string) => dependenciesMap.push(`- [${relPath}] ${d}`));
                    }
                    if (parsed.middleware && parsed.middleware.length > 0) {
                        parsed.middleware.forEach((m: string) => middlewareMap.push(`- [${relPath}] ${m}`));
                    }
                    if (parsed.entityRelations && parsed.entityRelations.length > 0) {
                        parsed.entityRelations.forEach((er: string) => entityRelationsMap.push(er));
                    }
                }
            } catch (err) {
                console.error(`Error parsing ${relPath}: ${err}`);
            }
        }

        const markdown = this.formatMarkdown(topology, routesMap, permissionsMap, dependenciesMap, middlewareMap, entityRelationsMap);
        fs.writeFileSync(path.join(rootDir, outputFile), markdown);
        console.log(`Successfully generated ${outputFile}`);

        // Also write graph.json for visualization/RAG/agent-navigation use-cases
        const graph = this.buildGraph(rootDir, routesMap, dependenciesMap, entityRelationsMap, middlewareMap);
        const graphPath = path.join(rootDir, 'architecture_graph.json');
        fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));
        console.log(`Successfully generated architecture_graph.json (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);
    }

    /**
     * Builds a typed graph representation from the parsed architecture data.
     * Nodes: files, routes, entity relations, services, middleware.
     * Edges: has_route, depends_on, relates_to, uses_middleware.
     */
    private buildGraph(
        rootDir: string,
        routesMap: string[],
        dependenciesMap: string[],
        entityRelationsMap: string[],
        middlewareMap: string[]
    ): ArchitectureGraph {
        const nodes: GraphNode[] = [];
        const edges: GraphEdge[] = [];
        const nodeIds = new Set<string>();

        const addNode = (node: GraphNode) => {
            if (!nodeIds.has(node.id)) {
                nodes.push(node);
                nodeIds.add(node.id);
            }
        };

        // Parse routes: "- [src/foo.ts] GET /users"
        for (const entry of routesMap) {
            const match = entry.match(/^- \[(.+?)\] (.+)$/);
            if (!match) continue;
            const filePath = match[1]!;
            const routeLabel = match[2]!;
            const fileId = `file:${filePath}`;
            const routeId = `route:${routeLabel}`;
            addNode({ id: fileId, type: 'file', label: filePath });
            addNode({ id: routeId, type: 'route', label: routeLabel });
            edges.push({ source: fileId, target: routeId, type: 'has_route', label: routeLabel });
        }

        // Parse dependencies: "- [src/foo.ts] FooService"
        for (const entry of dependenciesMap) {
            const match = entry.match(/^- \[(.+?)\] (.+)$/);
            if (!match) continue;
            const filePath = match[1]!;
            const depLabel = match[2]!;
            const fileId = `file:${filePath}`;
            const serviceId = `service:${depLabel}`;
            addNode({ id: fileId, type: 'file', label: filePath });
            addNode({ id: serviceId, type: 'service', label: depLabel });
            edges.push({ source: fileId, target: serviceId, type: 'depends_on', label: depLabel });
        }

        // Parse entity relations: "EntityA -[RelType]-> EntityB (property)"
        // e.g. "ArticleEntity -[ManyToOne]-> UserEntity (author)"
        for (const entry of entityRelationsMap) {
            const match = entry.match(/^(.+?) -\[(.+?)\]-> (.+?) \((.+?)\)$/);
            if (!match) continue;
            const sourceEntity = match[1]!.trim();
            const relType = match[2]!;
            const targetEntity = match[3]!.trim();
            const property = match[4]!;
            const sourceId = `entity:${sourceEntity}`;
            const targetId = `entity:${targetEntity}`;
            addNode({ id: sourceId, type: 'entity', label: sourceEntity });
            addNode({ id: targetId, type: 'entity', label: targetEntity });
            edges.push({
                source: sourceId,
                target: targetId,
                type: 'relates_to',
                label: `${relType} (${property})`
            });
        }

        // Parse middleware: "- [src/foo.ts] SomeMiddleware forRoutes /path"
        for (const entry of middlewareMap) {
            const match = entry.match(/^- \[(.+?)\] (.+)$/);
            if (!match) continue;
            const filePath = match[1]!;
            const middlewareLabel = match[2]!;
            const fileId = `file:${filePath}`;
            const mwId = `middleware:${middlewareLabel}`;
            addNode({ id: fileId, type: 'file', label: filePath });
            addNode({ id: mwId, type: 'middleware', label: middlewareLabel });
            edges.push({ source: fileId, target: mwId, type: 'uses_middleware', label: middlewareLabel });
        }

        return {
            generatedAt: new Date().toISOString(),
            rootDir,
            nodes,
            edges
        };
    }

    private formatMarkdown(
        topology: string[],
        routes: string[],
        permissions: string[],
        dependencies: string[],
        middleware: string[],
        entityRelations: string[]
    ): string {
        return `# Project Architecture Map (Phase 2)

## 1. Directory Topology
${topology.join('\n')}

## 2. Request Routing & Authentication Flow
${routes.length > 0 ? routes.join('\n') : '*No routes detected*'}

## 3. Middleware Chain
${middleware.length > 0 ? middleware.join('\n') : '*No global middleware detected*'}

## 4. Permissions & Role Policies
${permissions.length > 0 ? permissions.join('\n') : '*No explicit permissions/guards detected*'}

## 5. Dependency Injection & Services
${dependencies.length > 0 ? dependencies.join('\n') : '*No explicit DI detected*'}

## 6. Database & Entity Relations
${entityRelations.length > 0 ? entityRelations.map(er => `- ${er}`).join('\n') : '*No database relations detected*'}
`;
    }

    private walkDir(dir: string, fileList: string[] = []): string[] {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const stat = fs.statSync(path.join(dir, file));
            if (stat.isDirectory()) {
                this.walkDir(path.join(dir, file), fileList);
            } else {
                fileList.push(path.join(dir, file));
            }
        }
        return fileList;
    }
}
