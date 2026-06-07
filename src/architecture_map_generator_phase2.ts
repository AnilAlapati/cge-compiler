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
        let methodsMap: string[] = [];
        let eventEmissionsMap: string[] = [];
        let eventListenersMap: string[] = [];
        let cronJobsMap: string[] = [];
        let callsMap: string[] = [];
        let classPropertiesMap: string[] = [];

        for (const file of files) {
            if (file.includes('node_modules') || file.includes('.git') || file.includes('/dist/') || file.includes('.spec.ts') || file.includes('.spec.js') || file.includes('/apps/client/') || file.includes('/client/')) continue;

            const ext = path.extname(file).toLowerCase();
            const relPath = path.relative(rootDir, file);
            
            try {
                const code = fs.readFileSync(file, 'utf-8');
                let parsed: any = null;

                if (['.ts', '.js', '.tsx', '.jsx'].includes(ext)) {
                    parsed = this.tsParser.parse(code, file);
                } else if (ext === '.py') {
                    parsed = this.pyParser.parse(code, file);
                } else if (ext === '.prisma') {
                    const prismaRelations = this.parsePrisma(code);
                    if (prismaRelations.length > 0) {
                        parsed = { entityRelations: prismaRelations, exports: [], routes: [], permissions: [], dependencies: [], middleware: [], methods: [], eventEmissions: [], eventListeners: [], cronJobs: [], calls: [] };
                    }
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
                    if (parsed.methods && parsed.methods.length > 0) {
                        parsed.methods.forEach((m: string) => methodsMap.push(`- [${relPath}] ${m}`));
                    }
                    if (parsed.eventEmissions && parsed.eventEmissions.length > 0) {
                        parsed.eventEmissions.forEach((e: string) => eventEmissionsMap.push(`- [${relPath}] ${e}`));
                    }
                    if (parsed.eventListeners && parsed.eventListeners.length > 0) {
                        parsed.eventListeners.forEach((l: string) => eventListenersMap.push(`- [${relPath}] ${l}`));
                    }
                    if (parsed.cronJobs && parsed.cronJobs.length > 0) {
                        parsed.cronJobs.forEach((cj: string) => cronJobsMap.push(`- [${relPath}] ${cj}`));
                    }
                    if (parsed.calls && parsed.calls.length > 0) {
                        parsed.calls.forEach((c: string) => callsMap.push(`- [${relPath}] ${c}`));
                    }
                    if (parsed.classProperties && parsed.classProperties.length > 0) {
                        parsed.classProperties.forEach((cp: string) => classPropertiesMap.push(`- [${relPath}] ${cp}`));
                    }
                }
            } catch (err) {
                console.error(`Error parsing ${relPath}: ${err}`);
            }
        }

        const markdown = this.formatMarkdown(topology, routesMap, permissionsMap, dependenciesMap, middlewareMap, entityRelationsMap, methodsMap, cronJobsMap, eventListenersMap, eventEmissionsMap, callsMap, classPropertiesMap);
        fs.writeFileSync(path.join(rootDir, outputFile), markdown);
        console.log(`Successfully generated ${outputFile}`);

        // Also write graph.json for visualization/RAG/agent-navigation use-cases
        const graph = this.buildGraph(rootDir, routesMap, dependenciesMap, entityRelationsMap, middlewareMap, methodsMap, cronJobsMap, eventListenersMap, eventEmissionsMap, callsMap);
        const graphPath = path.join(rootDir, 'architecture_graph.json');
        fs.writeFileSync(graphPath, JSON.stringify(graph, null, 2));
        console.log(`Successfully generated architecture_graph.json (${graph.nodes.length} nodes, ${graph.edges.length} edges)`);
    }

    private parsePrisma(code: string): string[] {
        const relations: string[] = [];
        let currentModel = '';
        const lines = code.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            const modelMatch = trimmed.match(/^model\s+([A-Za-z0-9_]+)\s*\{/);
            if (modelMatch) {
                currentModel = modelMatch[1]!;
                continue;
            }
            if (trimmed === '}') {
                currentModel = '';
                continue;
            }
            if (currentModel) {
                // If type is capitalized and not standard, treat as relation
                const fieldMatch = trimmed.match(/^([A-Za-z0-9_]+)\s+([A-Z][A-Za-z0-9_]*)(\[\])?\s*(.*)/);
                if (fieldMatch) {
                    const fieldName = fieldMatch[1]!;
                    const fieldType = fieldMatch[2]!;
                    const isArray = !!fieldMatch[3];
                    const rest = fieldMatch[4] || '';
                    
                    const standardTypes = ['String', 'Int', 'Boolean', 'DateTime', 'Json', 'Float', 'Decimal', 'Bytes', 'BigInt'];
                    if (!standardTypes.includes(fieldType)) {
                        const relType = isArray ? 'OneToMany' : (rest.includes('@relation') ? 'ManyToOne' : 'OneToOne');
                        relations.push(`${currentModel} -[${relType}]-> ${fieldType} (${fieldName})`);
                    }
                }
            }
        }
        return relations;
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
        middlewareMap: string[],
        methodsMap: string[],
        cronJobsMap: string[],
        eventListenersMap: string[],
        eventEmissionsMap: string[],
        callsMap: string[]
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

        // Phase 5 Graph Additions:
        
        // Parse methods: "- [src/foo.ts] ClassName.methodName(params): ReturnType"
        for (const entry of methodsMap) {
            const match = entry.match(/^- \[(.+?)\] (.+?)\.(.+?)\(/);
            if (!match) continue;
            const filePath = match[1]!;
            const className = match[2]!;
            const methodName = match[3]!;
            const methodId = `method:${className}.${methodName}`;
            const fileId = `file:${filePath}`;
            addNode({ id: methodId, type: 'service', label: `${className}.${methodName}` });
            edges.push({ source: fileId, target: methodId, type: 'depends_on', label: 'defines' });
        }

        // Parse callsMap: "- [src/foo.ts] ClassName.methodName -[calls]-> TargetClass.calledMethod"
        for (const entry of callsMap) {
            const match = entry.match(/^- \[(.+?)\] (.+?)\.(.+?) -\[calls\]-> (.+?)\.(.+)$/);
            if (!match) continue;
            const sourceClass = match[2]!;
            const sourceMethod = match[3]!;
            const targetClass = match[4]!;
            const targetMethod = match[5]!;

            const sourceId = `method:${sourceClass}.${sourceMethod}`;
            const targetId = `method:${targetClass}.${targetMethod}`;

            addNode({ id: sourceId, type: 'service', label: `${sourceClass}.${sourceMethod}` });
            addNode({ id: targetId, type: 'service', label: `${targetClass}.${targetMethod}` });
            edges.push({ source: sourceId, target: targetId, type: 'depends_on', label: 'calls' });
        }

        // Parse eventEmissionsMap: "- [src/foo.ts] ClassName.methodName -[emits]-> Event(eventName)"
        for (const entry of eventEmissionsMap) {
            const match = entry.match(/^- \[(.+?)\] (.+?)\.(.+?) -\[emits\]-> Event\((.+?)\)$/);
            if (!match) continue;
            const className = match[2]!;
            const methodName = match[3]!;
            const eventName = match[4]!;

            const methodId = `method:${className}.${methodName}`;
            const eventId = `event:${eventName}`;

            addNode({ id: methodId, type: 'service', label: `${className}.${methodName}` });
            addNode({ id: eventId, type: 'entity', label: `Event: ${eventName}` });
            edges.push({ source: methodId, target: eventId, type: 'depends_on', label: 'emits' });
        }

        // Parse eventListenersMap: "- [src/foo.ts] ClassName.methodName [On event: eventName]"
        for (const entry of eventListenersMap) {
            const match = entry.match(/^- \[(.+?)\] (.+?)\.(.+?) \[On event: (.+?)\]$/);
            if (!match) continue;
            const className = match[2]!;
            const methodName = match[3]!;
            const eventName = match[4]!.trim();

            const methodId = `method:${className}.${methodName}`;
            const eventId = `event:${eventName}`;

            addNode({ id: methodId, type: 'service', label: `${className}.${methodName}` });
            addNode({ id: eventId, type: 'entity', label: `Event: ${eventName}` });
            edges.push({ source: eventId, target: methodId, type: 'depends_on', label: 'listens' });
        }

        // Parse cronJobsMap: "- [src/foo.ts] ClassName.methodName [On schedule: schedule]"
        for (const entry of cronJobsMap) {
            const match = entry.match(/^- \[(.+?)\] (.+?)\.(.+?) \[On schedule: (.+?)\]$/);
            if (!match) continue;
            const className = match[2]!;
            const methodName = match[3]!;
            const schedule = match[4]!;

            const methodId = `method:${className}.${methodName}`;
            const cronId = `cron:${className}.${methodName}`;

            addNode({ id: methodId, type: 'service', label: `${className}.${methodName}` });
            addNode({ id: cronId, type: 'middleware', label: `Cron: ${schedule}` });
            edges.push({ source: cronId, target: methodId, type: 'depends_on', label: 'triggers' });
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
        entityRelations: string[],
        methods: string[],
        cronJobs: string[],
        eventListeners: string[],
        eventEmissions: string[],
        calls: string[],
        classProperties: string[]
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

## 7. Class Methods & Operations
${methods.length > 0 ? methods.join('\n') : '*No public method signatures detected*'}

## 8. Behavioral Workflows & Event Flows
### Scheduled Jobs (Cron)
${cronJobs.length > 0 ? cronJobs.join('\n') : '*No scheduled cron jobs detected*'}

### Event Listeners (OnEvent)
${eventListeners.length > 0 ? eventListeners.join('\n') : '*No event listeners detected*'}

### Event Emissions
${eventEmissions.length > 0 ? eventEmissions.join('\n') : '*No event emissions detected*'}

### Inter-Service Calls
${calls.length > 0 ? calls.join('\n') : '*No inter-service method calls detected*'}

## 9. Class Properties & Validation
${classProperties.length > 0 ? classProperties.join('\n') : '*No class properties detected*'}
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
