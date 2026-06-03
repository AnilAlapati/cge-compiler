import { CGEParserPhase2 } from "./cge_parser_phase2";

/**
 * Python CGE Parser (Phase 2)
 * Parses Python source code into unified CGE blocks and extracts architecture decorators.
 */
export class PythonParserPhase2 implements CGEParserPhase2 {
  public parse(code: string, fileName?: string): {
    imports: string[];
    types: string[];
    state: string[];
    ops: string[];
    privateOps: string[];
    exports: string[];
    routes?: string[];
    middleware?: string[];
    permissions?: string[];
    dependencies?: string[];
  } {
    const sourceFileName = fileName || "temp.py";
    const lines = code.split("\n");
    
    const imports: string[] = [];
    const types: string[] = [];
    const state: string[] = [];
    const ops: string[] = [];
    const privateOps: string[] = [];
    const exportsList: string[] = [];
    const routes: string[] = [];
    const permissions: string[] = [];
    const dependencies: string[] = [];

    let currentClass: { name: string; fields: string[] } | null = null;
    let activeDecorators: string[] = [];
    let currentBlock: { name: string; isPrivate: boolean; type: "func" | "method"; params: string; ret: string; indent: number; bodyLines: string[]; decorators: string[] } | null = null;

    // Helper to map Python types to CGE shorthand
    const mapPythonType = (pyType: string | undefined): string => {
      if (!pyType) return "any";
      const clean = pyType.trim();
      switch (clean) {
        case "str": return "S";
        case "int":
        case "float": return "N";
        case "bool": return "B";
        case "datetime":
        case "date": return "D";
        case "None": return "void";
        case "Any": return "any";
      }
      if (clean.startsWith("List[") || clean.endsWith("[]")) {
        const inner = clean.startsWith("List[") ? clean.substring(5, clean.length - 1) : clean.slice(0, -2);
        return `${mapPythonType(inner)}[]`;
      }
      if (clean.startsWith("Dict[")) {
        const parts = clean.substring(5, clean.length - 1).split(",");
        const key = parts[0]?.trim() || "S";
        const val = parts[1]?.trim() || "any";
        return `Map<${mapPythonType(key)}, ${mapPythonType(val)}>`;
      }
      if (clean.startsWith("Optional[")) {
        return mapPythonType(clean.substring(9, clean.length - 1)) + "?";
      }
      return clean;
    };

    // Helper to extract indentation level
    const getIndent = (line: string): number => {
      const match = line.match(/^(\s*)/);
      return match && match[0] ? match[0].length : 0;
    };

    // Helper to translate a Python statement block to CGE notation
    const translateStatement = (stmt: string): string => {
      const clean = stmt.trim();
      if (!clean) return "";

      // 1. Guard check with raise
      const raiseGuard = clean.match(/^if\s+(.+?):\s*raise\s+(\w+)\((.*)\)$/);
      if (raiseGuard) {
        const cond = raiseGuard[1] || "";
        const errType = raiseGuard[2] || "";
        const errArgs = raiseGuard[3] || "";
        return `GUARD ${cond} THROW "${errType}:${errArgs.replace(/['"]/g, "")}"`;
      }
      
      // 2. Guard check with return
      const returnGuard = clean.match(/^if\s+(.+?):\s*return\s*(.*)$/);
      if (returnGuard) {
        const cond = returnGuard[1] || "";
        const val = returnGuard[2]?.trim() || "void";
        return `GUARD ${cond} RETURN ${val}`;
      }

      // 3. Simple Return
      if (clean.startsWith("return ")) {
        return `RETURN ${clean.substring(7).trim()}`;
      }
      if (clean === "return") {
        return "RETURN void";
      }

      // 4. Raise / Throw
      if (clean.startsWith("raise ")) {
        return `THROW ${clean.substring(6).trim()}`;
      }

      // 5. Try/Except
      if (clean.startsWith("try:")) {
        return "TRY:";
      }

      return clean;
    };

    // Helper to flush active function block
    const flushCurrentBlock = () => {
      if (!currentBlock) return;
      
      const bodyTranslated: string[] = [];
      let i = 0;
      while (i < currentBlock.bodyLines.length) {
        const line = currentBlock.bodyLines[i];
        if (line === undefined) {
          i++;
          continue;
        }
        const clean = line.trim();
        const indent = getIndent(line);

        // Check if it's an if-else or if-raise block
        if (clean.startsWith("if ") && i + 1 < currentBlock.bodyLines.length) {
          const nextLine = currentBlock.bodyLines[i + 1];
          if (nextLine !== undefined) {
            const nextClean = nextLine.trim();
            const nextIndent = getIndent(nextLine);
            if (nextIndent > indent) {
              // Nested raise
              if (nextClean.startsWith("raise ")) {
                const cond = clean.substring(3, clean.length - 1).trim();
                const err = nextClean.substring(6).trim();
                bodyTranslated.push(`    GUARD ${cond} THROW ${err}`);
                i += 2;
                continue;
              }
              // Nested return
              if (nextClean.startsWith("return ") || nextClean === "return") {
                const cond = clean.substring(3, clean.length - 1).trim();
                const val = nextClean.startsWith("return ") ? nextClean.substring(7).trim() : "void";
                bodyTranslated.push(`    GUARD ${cond} RETURN ${val}`);
                i += 2;
                continue;
              }
            }
          }
        }

        // Check for loops (SCAN mapping)
        const forMatch = clean.match(/^for\s+(.+?)\s+in\s+(.+?):$/);
        if (forMatch && i + 1 < currentBlock.bodyLines.length) {
          const nextLine = currentBlock.bodyLines[i + 1];
          if (nextLine !== undefined) {
            const nextClean = nextLine.trim();
            const nextIndent = getIndent(nextLine);
            if (nextIndent > indent) {
              const iterator = forMatch[1] || "";
              const collection = forMatch[2] || "";
              
              let body = "";
              // Handle nested multi-line if-return or if-raise block inside loop
              if (nextClean.startsWith("if ") && nextClean.endsWith(":") && i + 2 < currentBlock.bodyLines.length) {
                const subNextLine = currentBlock.bodyLines[i + 2];
                if (subNextLine !== undefined) {
                  const subNextClean = subNextLine.trim();
                  const subNextIndent = getIndent(subNextLine);
                  if (subNextIndent > nextIndent) {
                    if (subNextClean.startsWith("return ") || subNextClean === "return") {
                      const cond = nextClean.substring(3, nextClean.length - 1).trim();
                      const val = subNextClean.startsWith("return ") ? subNextClean.substring(7).trim() : "void";
                      body = `GUARD ${cond} RETURN ${val}`;
                      i++; // Consume the nested return
                    } else if (subNextClean.startsWith("raise ")) {
                      const cond = nextClean.substring(3, nextClean.length - 1).trim();
                      const err = subNextClean.substring(6).trim();
                      body = `GUARD ${cond} THROW ${err}`;
                      i++; // Consume the nested raise
                    }
                  }
                }
              }
              
              if (!body) {
                body = translateStatement(nextClean);
              }
              
              bodyTranslated.push(`    SCAN ${collection} FOR ${iterator} -> ${body}`);
              i += 2;
              continue;
            }
          }
        }

        // Check for Try/Except blocks
        if (clean === "try:") {
          let tryPart = "";
          let catchPart = "";
          let j = i + 1;
          while (j < currentBlock.bodyLines.length) {
            const subLine = currentBlock.bodyLines[j];
            if (subLine === undefined) {
              j++;
              continue;
            }
            const subLineClean = subLine.trim();
            if (subLineClean.startsWith("except")) {
              const excMatch = subLineClean.match(/except\s+(\w+)(?:\s+as\s+(\w+))?:/);
              const excName = excMatch ? excMatch[2] || excMatch[1] || "err" : "err";
              let catchLines: string[] = [];
              let k = j + 1;
              while (k < currentBlock.bodyLines.length) {
                const kLine = currentBlock.bodyLines[k];
                if (kLine === undefined) {
                  k++;
                  continue;
                }
                const subSubIndent = getIndent(kLine);
                if (subSubIndent <= indent) break;
                catchLines.push(kLine.trim());
                k++;
              }
              catchPart = ` CATCH: ${catchLines.join(", ")}`;
              j = k;
              break;
            }
            tryPart += (tryPart ? ", " : "") + translateStatement(subLineClean);
            j++;
          }
          bodyTranslated.push(`    TRY: ${tryPart}${catchPart}`);
          i = j;
          continue;
        }

        const trans = translateStatement(clean);
        if (trans) {
          bodyTranslated.push(`    ${trans}`);
        }
        i++;
      }

      const bodyStr = bodyTranslated.join("\n");
      const retType = mapPythonType(currentBlock.ret);
      const decoratorPrefix = currentBlock.decorators && currentBlock.decorators.length > 0 
          ? `[${currentBlock.decorators.join(" ")}] ` 
          : "";
      const signature = `${decoratorPrefix}${currentBlock.name}(${currentBlock.params})->${retType}:${bodyStr ? "\n" + bodyStr : " void"}`;

      if (currentBlock.isPrivate) {
        privateOps.push(signature);
      } else {
        ops.push(signature);
      }

      currentBlock = null;
    };

    // Helper to flush active class
    const flushCurrentClass = () => {
      if (!currentClass) return;
      types.push(`${currentClass.name}{${currentClass.fields.join(", ")}}`);
      exportsList.push(currentClass.name);
      currentClass = null;
    };

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      if (line === undefined) continue;
      
      const clean = line.trim();
      if (!clean || clean.startsWith("#")) continue;

      const indent = getIndent(line);

      // If we are currently inside a function/method block
      if (currentBlock) {
        if (indent > currentBlock.indent) {
          currentBlock.bodyLines.push(line);
          continue;
        } else {
          flushCurrentBlock();
        }
      }

      // If we are currently inside a class block
      if (currentClass && indent === 0) {
        flushCurrentClass();
      }

      // 1. Imports
      const importMatch1 = clean.match(/^import\s+(.+)$/);
      const importMatch2 = clean.match(/^from\s+([\w\.]+)\s+import\s+(.+)$/);
      if (importMatch1) {
        const imp = importMatch1[1] || "";
        imports.push(imp);
        continue;
      }
      if (importMatch2) {
        const fromMod = importMatch2[1] || "";
        const imp = importMatch2[2] || "";
        imports.push(`${imp} from ${fromMod}`);
        continue;
      }

      // 2. Classes (Types)
      const classMatch = clean.match(/^class\s+(\w+)(?:\((.+)\))?:$/);
      if (classMatch) {
        flushCurrentClass();
        const className = classMatch[1] || "UnknownClass";
        currentClass = {
          name: className,
          fields: [],
        };
        continue;
      }

      // Decorator collection
      if (clean.startsWith("@")) {
        activeDecorators.push(clean);
        continue;
      }

      // 3. Methods & Functions
      const defMatch = clean.match(/^(?:async\s+)?def\s+(\w+)\((.*?)\)(?:\s*->\s*(.+?))?:$/);
      if (defMatch) {
        const name = defMatch[1] || "anonymous";
        let paramsRaw = defMatch[2] || "";
        const ret = defMatch[3] || "None";
        const isPrivate = name.startsWith("_");

        // Format parameters
        const params = paramsRaw
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p && p !== "self" && p !== "cls")
          .map((p) => {
            const parts = p.split(":");
            const pName = parts[0]?.trim() || "";
            const pType = parts[1] ? mapPythonType(parts[1]) : "any";
            return `${pName}:${pType}`;
          })
          .join(", ");

        const methodDecorators = [...activeDecorators];
        activeDecorators = [];
        
        methodDecorators.forEach(d => {
            if (d.includes('route(') || d.includes('get(') || d.includes('post(')) {
                routes.push(`${d} -> ${name}`);
            }
            if (d.includes('require_auth') || d.includes('login_required') || d.includes('permission')) {
                permissions.push(`${name} REQUIRES ${d}`);
            }
        });

        currentBlock = {
          name,
          isPrivate,
          type: currentClass ? "method" : "func",
          params,
          ret,
          indent,
          bodyLines: [],
          decorators: methodDecorators,
        };

        if (!currentClass && !isPrivate) {
          exportsList.push(name);
        }
        continue;
      }
      
      // If it's not a decorator, reset decorators
      if (!clean.startsWith("@") && !clean.startsWith("#")) {
          activeDecorators = [];
      }

      // 4. Class properties (State or Type fields) or Global properties
      const varMatch = clean.match(/^([\w_]+)(?:\s*:\s*([^=]+))?(?:\s*=\s*(.+))?$/);
      if (varMatch) {
        const name = varMatch[1] || "";
        const rawType = varMatch[2]?.trim() || "any";
        const init = varMatch[3]?.trim() || "";
        const isConst = name === name.toUpperCase();

        if (currentClass) {
          const fieldType = mapPythonType(rawType);
          currentClass.fields.push(`${name}:${fieldType}`);
        } else {
          // Global state / constant
          const prefix = isConst ? "CONST " : "";
          const fieldType = mapPythonType(rawType);
          const initStr = init ? ` = ${init}` : "";
          state.push(`${prefix}${name}:${fieldType}${initStr}`);
          if (!name.startsWith("_")) {
            exportsList.push(name);
          }
          if (init && (init.includes("SQLAlchemy") || init.includes("Client"))) {
            dependencies.push(`${name} -> ${init}`);
          }
        }
      }
    }

    // Flush any remaining active blocks
    flushCurrentBlock();
    flushCurrentClass();

    return {
      imports,
      types,
      state,
      ops,
      privateOps,
      exports: exportsList,
      routes,
      middleware: [],
      permissions,
      dependencies,
    };
  }
}
