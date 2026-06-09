import * as fs from 'fs';
import * as path from 'path';

const IGNORED_FOLDERS = ['node_modules', '.git', 'dist', 'build', 'coverage', '.next', 'target', 'out', 'vendor'];
const VALID_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.rs', '.go', '.java', '.cs', '.cpp', '.h', '.hpp', '.json', '.css', '.html'];

export interface DiscoveredFile {
  path: string;
  content: string;
}

export function discoverFiles(dir: string, baseDir: string = dir, maxFiles: number = 500, files: DiscoveredFile[] = []): DiscoveredFile[] {
  if (files.length >= maxFiles) return files;

  try {
    const stat = fs.statSync(dir);
    if (!stat.isDirectory()) {
      const ext = path.extname(dir).toLowerCase();
      if (VALID_EXTENSIONS.includes(ext)) {
        try {
          const content = fs.readFileSync(dir, 'utf8');
          files.push({
            path: path.relative(baseDir, dir) || path.basename(dir),
            content
          });
        } catch (e) {
          // ignore read errors
        }
      }
      return files;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) break;

      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_FOLDERS.includes(entry.name)) {
          discoverFiles(fullPath, baseDir, maxFiles, files);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (VALID_EXTENSIONS.includes(ext)) {
          try {
            const content = fs.readFileSync(fullPath, 'utf8');
            files.push({
              path: path.relative(baseDir, fullPath),
              content
            });
          } catch (e) {
            // ignore read errors
          }
        }
      }
    }
  } catch (e) {
    // ignore stat errors
  }

  return files;
}
