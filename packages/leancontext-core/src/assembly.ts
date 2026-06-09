import * as fs from 'fs';
import * as path from 'path';

export interface AssemblyOptions {
  depth?: number;
  rootDir?: string;
  extensions?: string[];
}

interface DiscoveredFile {
  path: string;
  content: string;
  lang: string;
}

// Minimal language mapping
const extToLang: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript'
};

function extractImports(content: string): string[] {
  const imports: string[] = [];
  // Match ES6 imports: import ... from 'path', import 'path', export ... from 'path'
  const importRegex = /(?:import|export)\s+(?:(?:[\s\S]*?)\s+from\s+)?['"]([^'"]+)['"]/g;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

function getTsConfigPaths(rootDir: string): Record<string, string[]> | null {
  const tryFiles = ['tsconfig.base.json', 'tsconfig.json'];
  for (const f of tryFiles) {
    const p = path.join(rootDir, f);
    if (fs.existsSync(p)) {
      try {
        // Very basic JSON parse (might fail on comments, but let's try removing basic comments)
        const raw = fs.readFileSync(p, 'utf8');
        const clean = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        const parsed = JSON.parse(clean);
        if (parsed?.compilerOptions?.paths) {
          return parsed.compilerOptions.paths;
        }
      } catch (e) {
        // ignore
      }
    }
  }
  return null;
}

let tsConfigPathsCache: Record<string, string[]> | null = null;
let tsConfigPathsLoaded = false;

function resolvePath(importPath: string, currentFilePath: string, rootDir: string, extensions: string[]): string | null {
  // If it's a relative path
  if (importPath.startsWith('.')) {
    const absPath = path.resolve(path.dirname(currentFilePath), importPath);
    return tryExtensions(absPath, extensions);
  }

  if (!tsConfigPathsLoaded) {
    tsConfigPathsCache = getTsConfigPaths(rootDir);
    tsConfigPathsLoaded = true;
  }

  // Handle tsconfig paths
  if (tsConfigPathsCache) {
    for (const [aliasPattern, destinations] of Object.entries(tsConfigPathsCache)) {
      // E.g. aliasPattern = "@ghostfolio/api/*"
      // target = "apps/api/src/*"
      if (aliasPattern.endsWith('/*')) {
        const baseAlias = aliasPattern.slice(0, -2); // "@ghostfolio/api"
        if (importPath.startsWith(baseAlias + '/')) {
          const suffix = importPath.slice(baseAlias.length + 1); // "decorators/has-permission.decorator"
          for (const destPattern of destinations) {
            if (destPattern.endsWith('/*')) {
              const baseDest = destPattern.slice(0, -2); // "apps/api/src"
              const potentialPath = path.join(rootDir, baseDest, suffix);
              const resolved = tryExtensions(potentialPath, extensions);
              if (resolved) return resolved;
            }
          }
        }
      } else if (aliasPattern === importPath) {
        for (const dest of destinations) {
          const potentialPath = path.join(rootDir, dest);
          const resolved = tryExtensions(potentialPath, extensions);
          if (resolved) return resolved;
        }
      }
    }
  }

  // Heuristic fallback for things starting with @
  if (importPath.startsWith('@')) {
    const parts = importPath.split('/');
    if (parts.length > 1) {
      const remaining = parts.slice(1).join('/');
      const potentialPaths = [
        path.join(rootDir, 'libs', remaining),
        path.join(rootDir, 'apps', remaining),
        path.join(rootDir, 'src', remaining)
      ];
      for (const p of potentialPaths) {
        const resolved = tryExtensions(p, extensions);
        if (resolved) return resolved;
      }
    }
  }

  // Internal absolute paths starting from root
  const srcPath = path.join(rootDir, importPath);
  const resolvedSrc = tryExtensions(srcPath, extensions);
  if (resolvedSrc) return resolvedSrc;

  return null;
}

function tryExtensions(basePath: string, extensions: string[]): string | null {
  if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) {
    return basePath;
  }
  for (const ext of extensions) {
    const withExt = `${basePath}${ext}`;
    if (fs.existsSync(withExt) && fs.statSync(withExt).isFile()) {
      return withExt;
    }
  }
  // Try treating it as a directory with index
  for (const ext of extensions) {
    const indexWithExt = path.join(basePath, `index${ext}`);
    if (fs.existsSync(indexWithExt) && fs.statSync(indexWithExt).isFile()) {
      return indexWithExt;
    }
  }
  return null;
}

export function assembleContext(
  targetFolder: string,
  options: AssemblyOptions = {}
): DiscoveredFile[] {
  const depth = options.depth ?? 1;
  const rootDir = options.rootDir ?? targetFolder;
  const extensions = options.extensions ?? ['.ts', '.tsx', '.js', '.jsx'];

  const visited = new Set<string>();
  const results: DiscoveredFile[] = [];

  // Queue holds {filePath, currentDepth}
  const queue: { path: string; currentDepth: number }[] = [];

  // 1. Discover all files in the target folder
  function discoverFolder(dir: string) {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir);
    for (const item of items) {
      if (item === 'node_modules' || item === 'dist' || item === 'build' || item.startsWith('.')) continue;
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        discoverFolder(fullPath);
      } else if (stat.isFile()) {
        const ext = path.extname(fullPath).toLowerCase();
        if (extensions.includes(ext)) {
          if (!visited.has(fullPath)) {
            visited.add(fullPath);
            queue.push({ path: fullPath, currentDepth: 0 });
          }
        }
      }
    }
  }

  discoverFolder(targetFolder);

  // 2. Process queue and resolve imports up to `depth`
  let qIndex = 0;
  while (qIndex < queue.length) {
    const { path: currentPath, currentDepth } = queue[qIndex++];
    
    let content;
    try {
      content = fs.readFileSync(currentPath, 'utf8');
    } catch (e) {
      continue;
    }

    const ext = path.extname(currentPath).toLowerCase();
    results.push({
      path: currentPath,
      content,
      lang: extToLang[ext] || 'javascript'
    });

    if (currentDepth < depth) {
      const imports = extractImports(content);
      for (const imp of imports) {
        const resolvedPath = resolvePath(imp, currentPath, rootDir, extensions);
        if (resolvedPath && !visited.has(resolvedPath)) {
          visited.add(resolvedPath);
          queue.push({ path: resolvedPath, currentDepth: currentDepth + 1 });
        }
      }
    }
  }

  return results;
}
