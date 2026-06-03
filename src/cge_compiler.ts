import * as fs from "fs";
import * as path from "path";
import { CGEParser } from "./cge_parser";
import { TypeScriptParser } from "./typescript_parser";
import { PythonParser } from "./python_parser";
import { RustParser } from "./rust_parser";
import { GoParser } from "./go_parser";
import { CppParser } from "./cpp_parser";

/**
 * CGECompiler
 * Modular context compression engine orchestrating multi-language parsers.
 */
export class CGECompiler {
  private filePaths: string[];

  constructor(filePaths: string[] = []) {
    this.filePaths = filePaths;
  }

  /**
   * Compiles raw code directly based on specified language.
   * @param code Raw source code string.
   * @param language Target language ("typescript", "python", or "rust").
   * @param fileName Optional file name context.
   */
  public compileCode(code: string, language: string, fileName?: string): string {
    const parser = this.getParserForLanguage(language);
    const parsed = parser.parse(code, fileName);

    const compName = fileName ? path.basename(fileName, path.extname(fileName)) : "Component";
    const isHook = compName.startsWith("use");
    const langLabel = language === "typescript" ? (isHook ? " (React Hook)" : " (TypeScript)") : ` (${language.charAt(0).toUpperCase() + language.slice(1)})`;
    
    const header = `CGE/1.0 ${compName}${langLabel}\n`;

    let output = header + "\n";

    if (parsed.imports.length > 0) {
      output += `IMPORTS:\n  ${parsed.imports.join("\n  ")}\n\n`;
    }

    if (parsed.types.length > 0) {
      output += `TYPES:\n  ${parsed.types.join("\n  ")}\n\n`;
    }

    if (parsed.state.length > 0) {
      output += `STATE:\n  ${parsed.state.join("\n  ")}\n\n`;
    }

    if (parsed.routes && parsed.routes.length > 0) {
      output += `ROUTES:\n  ${parsed.routes.join("\n  ")}\n\n`;
    }

    if (parsed.middleware && parsed.middleware.length > 0) {
      output += `MIDDLEWARE:\n  ${parsed.middleware.join("\n  ")}\n\n`;
    }

    if (parsed.permissions && parsed.permissions.length > 0) {
      output += `PERMISSIONS:\n  ${parsed.permissions.join("\n  ")}\n\n`;
    }

    if (parsed.dependencies && parsed.dependencies.length > 0) {
      output += `DEPENDENCIES:\n  ${parsed.dependencies.join("\n  ")}\n\n`;
    }

    if (parsed.ops.length > 0) {
      output += `OPS:\n  ${parsed.ops.join("\n\n  ")}\n\n`;
    }

    if (parsed.privateOps.length > 0) {
      output += `PRIVATE:\n  ${parsed.privateOps.join("\n  ")}\n\n`;
    }

    if (parsed.exports.length > 0) {
      output += `EXPORTS: ${parsed.exports.join(", ")}\n`;
    }

    return output.trim() + "\n";
  }

  /**
   * Compiles a source file on disk into CGE 1.0 notation.
   * Auto-detects the language based on file extension.
   */
  public compile(filePath: string): string {
    const resolvedPath = path.resolve(filePath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Source file not found: ${filePath}`);
    }

    const code = fs.readFileSync(resolvedPath, "utf-8");
    const ext = path.extname(resolvedPath).toLowerCase();
    const language = this.getLanguageFromExtension(ext);

    return this.compileCode(code, language, path.basename(resolvedPath));
  }

  // --- HELPERS ---

  private getLanguageFromExtension(ext: string): string {
    switch (ext) {
      case ".ts":
      case ".tsx":
      case ".js":
      case ".jsx":
        return "typescript";
      case ".py":
        return "python";
      case ".rs":
        return "rust";
      case ".go":
        return "go";
      case ".cpp":
      case ".h":
      case ".hpp":
        return "cpp";
      default:
        throw new Error(`Unsupported file extension: ${ext}`);
    }
  }

  private getParserForLanguage(language: string): CGEParser {
    switch (language.toLowerCase()) {
      case "typescript":
      case "ts":
      case "js":
      case "jsx":
      case "tsx":
        return new TypeScriptParser();
      case "python":
      case "py":
        return new PythonParser();
      case "rust":
      case "rs":
        return new RustParser();
      case "go":
        return new GoParser();
      case "cpp":
      case "c++":
        return new CppParser();
      default:
        throw new Error(`Unsupported parser language: ${language}`);
    }
  }
}
