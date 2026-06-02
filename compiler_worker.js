/* =========================================================================
   CGE Playground — Core Compiler & UI Controller
   ========================================================================= */

// =========================================================================
// 1. Language Parsers (Client-side High-Fidelity AST scanning)
// =========================================================================

// Common helper to map basic programming types to CGE/1.0 primitives
function mapTypeToCGE(typeStr) {
  if (!typeStr) return "any";
  const clean = typeStr.trim();
  switch (clean) {
    case "string":
    case "String":
    case "str":
    case "&str":
      return "S";
    case "number":
    case "int":
    case "float":
    case "u32":
    case "u64":
    case "i32":
    case "i64":
    case "f32":
    case "f64":
    case "usize":
      return "N";
    case "boolean":
    case "bool":
      return "B";
    case "Date":
    case "datetime":
    case "date":
      return "D";
    case "void":
    case "None":
    case "()":
      return "void";
    case "any":
    case "unknown":
    case "Any":
      return "any";
  }
  if (clean.endsWith("[]") || clean.startsWith("List[") || clean.startsWith("Vec<")) {
    let inner = clean;
    if (clean.startsWith("List[")) inner = clean.substring(5, clean.length - 1);
    else if (clean.startsWith("Vec<")) inner = clean.substring(4, clean.length - 1);
    else inner = clean.slice(0, -2);
    return `${mapTypeToCGE(inner)}[]`;
  }
  if (clean.startsWith("Promise<")) {
    const inner = clean.substring(8, clean.length - 1);
    return `Promise<${mapTypeToCGE(inner)}>`;
  }
  return clean;
}

// Client-side TypeScript CGE Parser
class TypeScriptClientParser {
  /**
   * Pre-normalize: join multi-line declarations into single logical lines.
   * When a line has unbalanced parentheses or ends with common continuation
   * patterns, concatenate subsequent lines until brackets balance.
   * This allows the line-by-line regex parser to see complete declarations.
   */
  normalizeLines(rawLines) {
    const result = [];
    let buffer = "";
    let parenDepth = 0;

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const trimmed = line.trim();

      // Skip empty lines and comments when not buffering
      if (!buffer && (!trimmed || trimmed.startsWith("//"))) {
        result.push(line);
        continue;
      }

      // Count parentheses (not inside strings)
      let inString = false;
      let stringChar = "";
      for (let c = 0; c < trimmed.length; c++) {
        const ch = trimmed[c];
        if (inString) {
          if (ch === stringChar && trimmed[c - 1] !== "\\") inString = false;
        } else {
          if (ch === '"' || ch === "'" || ch === '`') {
            inString = true;
            stringChar = ch;
          } else if (ch === '(') parenDepth++;
          else if (ch === ')') parenDepth--;
        }
      }

      if (buffer) {
        buffer += " " + trimmed;
      } else if (parenDepth > 0) {
        // Line opened a paren that didn't close — start buffering
        buffer = line;
      } else {
        result.push(line);
        continue;
      }

      // If parens are balanced, flush the buffer
      if (parenDepth <= 0) {
        result.push(buffer);
        buffer = "";
        parenDepth = 0;
      }
    }

    // Flush any remaining buffer
    if (buffer) {
      result.push(buffer);
    }

    return result;
  }

  parse(code) {
    const rawLines = code.split("\n");
    const lines = this.normalizeLines(rawLines);
    const imports = [];
    const types = [];
    const state = [];
    const ops = [];
    const privateOps = [];
    const exports = [];

    // Structural node meta for interactive inspector
    const nodesMeta = [];

    let currentInterface = null;
    let currentBlock = null;
    let braceCount = 0;

    const translateTSStatement = (stmt) => {
      const clean = stmt.trim().replace(/;$/, "");
      if (!clean) return "";
      if (clean.startsWith("if ") && (clean.includes("throw ") || clean.includes("return "))) {
        const matchThrow = clean.match(/^if\s*\((.+?)\)\s*throw\s+(.+)$/);
        if (matchThrow) return `GUARD ${matchThrow[1]} THROW ${matchThrow[2]}`;
        const matchRet = clean.match(/^if\s*\((.+?)\)\s*return\s*(.*)$/);
        if (matchRet) return `GUARD ${matchRet[1]} RETURN ${matchRet[2] || "void"}`;
      }
      if (clean.startsWith("throw ")) return `THROW ${clean.substring(6)}`;
      if (clean.startsWith("return ")) return `RETURN ${clean.substring(7)}`;
      if (clean === "return") return "RETURN void";
      return clean;
    };

    const flushBlock = () => {
      if (!currentBlock) return;
      const bodyTranslated = [];
      let i = 0;
      while (i < currentBlock.bodyLines.length) {
        const line = currentBlock.bodyLines[i];
        const clean = line.trim();

        // Multi-line if-throw/return check
        if (clean.startsWith("if ") && clean.endsWith("{") && i + 2 < currentBlock.bodyLines.length) {
          const next = currentBlock.bodyLines[i + 1].trim();
          const third = currentBlock.bodyLines[i + 2].trim();
          if (third === "}") {
            const cond = clean.substring(3, clean.length - 1).replace(/[\(\)]/g, "").trim();
            if (next.startsWith("throw ")) {
              const statementText = `GUARD ${cond} THROW ${next.substring(6).replace(/;$/, "")}`;
              bodyTranslated.push(`    ${statementText}`);
              
              // Register interactive node
              nodesMeta.push({
                name: `Guard assertion (${cond.substring(0, 15)})`,
                type: "Guard Condition",
                rule: "Guard Assertions",
                desc: "Collapses multi-line conditional limits, checks, and throw blocks into a highly flat inline instruction.",
                before: `${clean}\n  ${next}\n${third}`,
                after: statementText
              });
              i += 3;
              continue;
            }
            if (next.startsWith("return ") || next === "return") {
              const val = next.startsWith("return ") ? next.substring(7).replace(/;$/, "") : "void";
              const statementText = `GUARD ${cond} RETURN ${val}`;
              bodyTranslated.push(`    ${statementText}`);
              
              // Register interactive node
              nodesMeta.push({
                name: `Guard return (${cond.substring(0, 15)})`,
                type: "Guard Return",
                rule: "Guard Assertions",
                desc: "Collapses multi-line conditional returns or fallback evaluations into a flat inline assertion.",
                before: `${clean}\n  ${next}\n${third}`,
                after: statementText
              });
              i += 3;
              continue;
            }
          }
        }

        // Loop checks (SCAN compactor)
        const forMatch = clean.match(/^for\s*\((?:const|let)?\s+(.+?)\s+of\s+(.+?)\)\s*\{$/);
        if (forMatch && i + 1 < currentBlock.bodyLines.length) {
          const next = currentBlock.bodyLines[i + 1].trim();
          if (currentBlock.bodyLines[i + 2]?.trim() === "}") {
            const iterator = forMatch[1];
            const collection = forMatch[2];
            const statementText = `SCAN ${collection} FOR ${iterator} -> ${translateTSStatement(next)}`;
            bodyTranslated.push(`    ${statementText}`);

            // Register interactive node
            nodesMeta.push({
              name: `Collection scan (${collection})`,
              type: "Scan Compactor",
              rule: "Scan Compactor",
              desc: "Folds collection lookups, searches, and iterative list actions into a single query directive.",
              before: `${clean}\n  ${next}\n${currentBlock.bodyLines[i + 2]}`,
              after: statementText
            });
            i += 3;
            continue;
          }
        }

        const trans = translateTSStatement(clean);
        if (trans && trans !== "}") {
          bodyTranslated.push(`    ${trans}`);
        }
        i++;
      }

      const retType = mapTypeToCGE(currentBlock.ret);
      const signature = `${currentBlock.name}(${currentBlock.params})->${retType}:${bodyTranslated.length > 0 ? "\n" + bodyTranslated.join("\n") : " void"}`;
      
      if (currentBlock.isPrivate) privateOps.push(signature);
      else ops.push(signature);

      // Register function node
      nodesMeta.push({
        name: `${currentBlock.name}()`,
        type: currentBlock.isPrivate ? "Private Method" : "Exported Function",
        rule: "Block Collapsing",
        desc: "Strips function/method structures of structural indent margins and syntax brackets, compiling statement lists into compressed graphs.",
        before: currentBlock.rawText,
        after: signature
      });

      currentBlock = null;
    };

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const clean = line.trim();
      if (!clean || clean.startsWith("//")) continue;

      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      braceCount += opens - closes;

      if (currentBlock) {
        currentBlock.rawText += `\n${line}`;
        if (braceCount > 0 || (braceCount === 0 && opens > 0)) {
          currentBlock.bodyLines.push(line);
          continue;
        } else {
          flushBlock();
          continue;
        }
      }

      if (currentInterface) {
        currentInterface.rawText += `\n${line}`;
        if (clean.startsWith("}")) {
          const typeDef = `${currentInterface.name}{${currentInterface.fields.join(", ")}}`;
          types.push(typeDef);
          exports.push(currentInterface.name);

          // Register type node
          nodesMeta.push({
            name: currentInterface.name,
            type: "Interface Type",
            rule: "Primitive Folding",
            desc: "Folds verbose structure declarations into streamlined type maps, substituting shorthand type codes.",
            before: currentInterface.rawText,
            after: typeDef
          });

          currentInterface = null;
          continue;
        }
        const fieldMatch = clean.match(/^(\w+)\??\s*:\s*([^;]+)/);
        if (fieldMatch) {
          const isOptional = clean.includes("?");
          const name = fieldMatch[1];
          const type = mapTypeToCGE(fieldMatch[2]);
          currentInterface.fields.push(`${name}${isOptional ? "?" : ""}:${type}`);
        }
        continue;
      }

      // 1. Imports
      const impMatch = clean.match(/^import\s+(?:(.+?)\s+from\s+)?['"](.+?)['"]/);
      if (impMatch) {
        const spec = impMatch[1] || "";
        const from = impMatch[2] || "";
        const impDef = `${spec} from ${from}`;
        imports.push(impDef);

        nodesMeta.push({
          name: from.replace(/^[\.\/]+/, ""),
          type: "Import Module",
          rule: "Block Collapsing",
          desc: "Flattens module reference bindings, packing dependency pathways tightly.",
          before: line,
          after: `IMPORTS: ${impDef}`
        });
        continue;
      }

      // 2. Interfaces
      const intMatch = clean.match(/^(?:export\s+)?interface\s+(\w+)/);
      if (intMatch) {
        currentInterface = { name: intMatch[1], fields: [], rawText: line };
        continue;
      }

      // 3. Methods & Functions (including export const myFunc = async (x) => { ... })
      const fnMatch = clean.match(/^(?:export\s+)?(?:const|let|var)?\s*(\w+)\s*=\s*(?:async\s*)?\((.*?)\)(?:\s*:\s*(.+?))?\s*=>\s*\{/) ||
                      clean.match(/^(?:export\s+)?(?:async\s+)?(?:public|private)?\s*(?:function|fn)?\s+(\w+)\s*\((.*?)\)(?:\s*:\s*(.+?))?\s*\{/) ||
                      clean.match(/^(?:export\s+)?(?:async\s+)?(?:public|private)?\s*(\w+)\s*\((.*?)\)(?:\s*:\s*(.+?))?\s*\{/);
      if (fnMatch && !clean.startsWith("import") && !clean.startsWith("if") && !clean.startsWith("for") && !clean.startsWith("return")) {
        const name = fnMatch[1];
        const paramsRaw = fnMatch[2] || "";
        const ret = fnMatch[3] || "void";
        const isPrivate = clean.includes("private") || name.startsWith("_");

        const params = paramsRaw.split(",").map(p => {
          const parts = p.split(":");
          const pName = parts[0]?.trim() || "";
          const pType = parts[1] ? mapTypeToCGE(parts[1]) : "any";
          return `${pName}:${pType}`;
        }).filter(p => p).join(", ");

        currentBlock = { name, isPrivate, params, ret, bodyLines: [], rawText: line };
        if (!isPrivate) exports.push(name);
        continue;
      }

      // 4. Variables & Constants
      const varMatch = clean.match(/^(?:export\s+)?(const|let|var)\s+(\w+)(?:\s*:\s*([^=;]+))?(?:\s*=\s*(.+?))?;?$/);
      if (varMatch) {
        const keyword = varMatch[1];
        const name = varMatch[2];
        const type = mapTypeToCGE(varMatch[3]);
        const val = varMatch[4] || "";
        const isConst = keyword === "const";

        if ((clean.includes("=>") || clean.includes("function")) && !clean.endsWith("{")) {
          // Single-line arrow or function assignments
          const paramMatch = clean.match(/\((.*?)\)\s*=>\s*(.+)$/);
          let compiledBody = "";
          let params = "params";
          
          if (paramMatch) {
            const paramsRaw = paramMatch[1];
            const rawBody = paramMatch[2].replace(/;$/, "").trim();
            
            params = paramsRaw.split(",").map(p => {
              const parts = p.split(":");
              const pName = parts[0]?.trim() || "";
              const pType = parts[1] ? mapTypeToCGE(parts[1]) : "any";
              return `${pName}:${pType}`;
            }).filter(p => p).join(", ");
            
            compiledBody = rawBody;
          } else {
            compiledBody = val.replace(/^(?:async\s*)?\s*\((.*?)\)\s*=>\s*/, "").replace(/;$/, "").trim();
          }

          const signature = `${name}(${params})->${compiledBody}`;
          ops.push(signature);
          exports.push(name);

          nodesMeta.push({
            name: `${name}()`,
            type: "Single-line Operator",
            rule: "Block Collapsing",
            desc: "Compacts single-line arrow functions losslessly, keeping implementation details intact.",
            before: line,
            after: signature
          });
        } else {
          const stateDef = `${isConst ? "CONST " : ""}${name}:${type}${val ? " = " + val : ""}`;
          state.push(stateDef);
          exports.push(name);

          nodesMeta.push({
            name,
            type: "State Parameter",
            rule: "Primitive Folding",
            desc: "Squeezes global assignments and type footprints into lightweight tokens.",
            before: line,
            after: stateDef
          });
        }
      }
    }

    flushBlock();
    if (currentInterface) {
      const typeDef = `${currentInterface.name}{${currentInterface.fields.join(", ")}}`;
      types.push(typeDef);
    }

    return { imports, types, state, ops, privateOps, exports, nodes: nodesMeta };
  }
}

// Client-side Python CGE Parser
class PythonClientParser {
  parse(code) {
    const lines = code.split("\n");
    const imports = [];
    const types = [];
    const state = [];
    const ops = [];
    const privateOps = [];
    const exports = [];
    const nodesMeta = [];

    let currentClass = null;
    let currentBlock = null;

    const getIndent = (l) => {
      const match = l.match(/^(\s*)/);
      return match ? match[0].length : 0;
    };

    const translatePyStatement = (stmt) => {
      const clean = stmt.trim();
      if (!clean) return "";
      
      const raiseGuard = clean.match(/^if\s+(.+?):\s*raise\s+(\w+)\((.*)?\)$/);
      if (raiseGuard) return `GUARD ${raiseGuard[1]} THROW "${raiseGuard[2]}:${raiseGuard[3]?.replace(/['"]/g, "") || ""}"`;

      const returnGuard = clean.match(/^if\s+(.+?):\s*return\s*(.*)$/);
      if (returnGuard) return `GUARD ${returnGuard[1]} RETURN ${returnGuard[2]?.trim() || "void"}`;

      if (clean.startsWith("return ")) return `RETURN ${clean.substring(7).trim()}`;
      if (clean === "return") return "RETURN void";
      if (clean.startsWith("raise ")) return `THROW ${clean.substring(6).trim()}`;
      return clean;
    };

    const flushBlock = () => {
      if (!currentBlock) return;
      const bodyTranslated = [];
      let i = 0;
      while (i < currentBlock.bodyLines.length) {
        const line = currentBlock.bodyLines[i];
        const clean = line.trim();
        const indent = getIndent(line);

        if (clean.startsWith("if ") && i + 1 < currentBlock.bodyLines.length) {
          const next = currentBlock.bodyLines[i + 1].trim();
          const nextIndent = getIndent(currentBlock.bodyLines[i + 1]);
          if (nextIndent > indent) {
            const cond = clean.substring(3, clean.length - 1).trim();
            if (next.startsWith("raise ")) {
              const statementText = `GUARD ${cond} THROW ${next.substring(6).trim()}`;
              bodyTranslated.push(`    ${statementText}`);

              nodesMeta.push({
                name: `Guard assertion (${cond.substring(0, 15)})`,
                type: "Guard Condition",
                rule: "Guard Assertions",
                desc: "Folds Python indentation and conditional verification raise structures into a single line directive.",
                before: `${line}\n${currentBlock.bodyLines[i + 1]}`,
                after: statementText
              });
              i += 2;
              continue;
            }
            if (next.startsWith("return ") || next === "return") {
              const val = next.startsWith("return ") ? next.substring(7).trim() : "void";
              const statementText = `GUARD ${cond} RETURN ${val}`;
              bodyTranslated.push(`    ${statementText}`);

              nodesMeta.push({
                name: `Guard return (${cond.substring(0, 15)})`,
                type: "Guard Return",
                rule: "Guard Assertions",
                desc: "Folds inline returns triggered by assertion limits.",
                before: `${line}\n${currentBlock.bodyLines[i + 1]}`,
                after: statementText
              });
              i += 2;
              continue;
            }
          }
        }

        // Loop compacting
        const forMatch = clean.match(/^for\s+(.+?)\s+in\s+(.+?):$/);
        if (forMatch && i + 1 < currentBlock.bodyLines.length) {
          const next = currentBlock.bodyLines[i + 1].trim();
          const statementText = `SCAN ${forMatch[2]} FOR ${forMatch[1]} -> ${translatePyStatement(next)}`;
          bodyTranslated.push(`    ${statementText}`);

          nodesMeta.push({
            name: `Collection loop (${forMatch[2]})`,
            type: "Scan Compactor",
            rule: "Scan Compactor",
            desc: "Folds collection scans and checks into a high density query expression.",
            before: `${line}\n${currentBlock.bodyLines[i + 1]}`,
            after: statementText
          });
          i += 2;
          continue;
        }

        const trans = translatePyStatement(clean);
        if (trans) bodyTranslated.push(`    ${trans}`);
        i++;
      }

      const retType = mapTypeToCGE(currentBlock.ret);
      const signature = `${currentBlock.name}(${currentBlock.params})->${retType}:${bodyTranslated.length > 0 ? "\n" + bodyTranslated.join("\n") : " void"}`;
      
      if (currentBlock.isPrivate) privateOps.push(signature);
      else ops.push(signature);

      nodesMeta.push({
        name: `${currentBlock.name}()`,
        type: currentBlock.isPrivate ? "Internal Method" : "Public Scope",
        rule: "Block Collapsing",
        desc: "Collapses indentation margins, flattens return pipelines, and folds block signatures.",
        before: currentBlock.rawText,
        after: signature
      });

      currentBlock = null;
    };

    const flushClass = () => {
      if (!currentClass) return;
      const classDef = `${currentClass.name}{${currentClass.fields.join(", ")}}`;
      types.push(classDef);
      exports.push(currentClass.name);

      nodesMeta.push({
        name: currentClass.name,
        type: "Class Struct",
        rule: "Primitive Folding",
        desc: "Packs structural parameters and attributes, substituting shorthand primitives.",
        before: currentClass.rawText,
        after: classDef
      });

      currentClass = null;
    };

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const clean = line.trim();
      if (!clean || clean.startsWith("#")) continue;

      const indent = getIndent(line);

      if (currentBlock) {
        if (indent > currentBlock.indent) {
          currentBlock.bodyLines.push(line);
          currentBlock.rawText += `\n${line}`;
          continue;
        } else {
          flushBlock();
        }
      }

      if (currentClass && indent === 0) flushClass();

      // 1. Imports
      const impMatch1 = clean.match(/^import\s+(.+)$/);
      const impMatch2 = clean.match(/^from\s+([\w\.]+)\s+import\s+(.+)$/);
      if (impMatch1) {
        const val = impMatch1[1];
        imports.push(val);
        nodesMeta.push({
          name: val,
          type: "Python Import",
          rule: "Block Collapsing",
          desc: "Reduces absolute reference bindings.",
          before: line,
          after: `IMPORTS: ${val}`
        });
        continue;
      }
      if (impMatch2) {
        const val = `${impMatch2[2]} from ${impMatch2[1]}`;
        imports.push(val);
        nodesMeta.push({
          name: impMatch2[2],
          type: "Python Scope Import",
          rule: "Block Collapsing",
          desc: "Reduces directory path pathways.",
          before: line,
          after: `IMPORTS: ${val}`
        });
        continue;
      }

      // 2. Classes
      const classMatch = clean.match(/^class\s+(\w+)/);
      if (classMatch) {
        flushClass();
        currentClass = { name: classMatch[1], fields: [], rawText: line };
        continue;
      }

      // 3. Methods & Functions
      const defMatch = clean.match(/^(?:async\s+)?def\s+(\w+)\((.*?)\)(?:\s*->\s*(.+?))?:$/);
      if (defMatch) {
        const name = defMatch[1];
        const paramsRaw = defMatch[2] || "";
        const ret = defMatch[3] || "None";
        const isPrivate = name.startsWith("_");

        const params = paramsRaw.split(",").map(p => p.trim())
          .filter(p => p && p !== "self" && p !== "cls")
          .map(p => {
            const parts = p.split(":");
            return `${parts[0]?.trim()}:${mapTypeToCGE(parts[1])}`;
          }).join(", ");

        currentBlock = { name, isPrivate, params, ret, indent, bodyLines: [], rawText: line };
        if (!currentClass && !isPrivate) exports.push(name);
        continue;
      }

      // 4. Constants & Properties
      const varMatch = clean.match(/^([\w_]+)(?:\s*:\s*([^=]+))?(?:\s*=\s*(.+))?$/);
      if (varMatch) {
        const name = varMatch[1];
        const rawType = varMatch[2];
        const isConst = name === name.toUpperCase();

        if (currentClass) {
          currentClass.fields.push(`${name}:${mapTypeToCGE(rawType)}`);
          currentClass.rawText += `\n${line}`;
        } else {
          const stateDef = `${isConst ? "CONST " : ""}${name}:${mapTypeToCGE(rawType)} = ${varMatch[3]?.trim() || ""}`;
          state.push(stateDef);
          exports.push(name);

          nodesMeta.push({
            name,
            type: "State Scope",
            rule: "Primitive Folding",
            desc: "Packs variable parameters.",
            before: line,
            after: stateDef
          });
        }
      }
    }

    flushBlock();
    flushClass();

    return { imports, types, state, ops, privateOps, exports, nodes: nodesMeta };
  }
}

// Client-side Rust CGE Parser
class RustClientParser {
  parse(code) {
    const lines = code.split("\n");
    const imports = [];
    const types = [];
    const state = [];
    const ops = [];
    const privateOps = [];
    const exports = [];
    const nodesMeta = [];

    let activeStruct = null;
    let activeEnum = null;
    let activeBlock = null;
    let braceCount = 0;

    const translateRustStatement = (stmt) => {
      const clean = stmt.trim().replace(/;$/, "");
      if (!clean) return "";

      const guardReturn = clean.match(/^if\s+(.+?)\s*\{\s*return\s*(.*?)\s*;?\s*\}/);
      if (guardReturn) return `GUARD ${guardReturn[1]} RETURN ${guardReturn[2] || "void"}`;

      const guardPanic = clean.match(/^if\s+(.+?)\s*\{\s*panic!\((.*?)\)\s*;?\s*\}/);
      if (guardPanic) return `GUARD ${guardPanic[1]} THROW ${guardPanic[2]}`;

      if (clean.startsWith("return ")) return `RETURN ${clean.substring(7)}`;
      return clean;
    };

    const flushBlock = () => {
      if (!activeBlock) return;
      const bodyTranslated = [];
      let i = 0;
      while (i < activeBlock.bodyLines.length) {
        const line = activeBlock.bodyLines[i];
        const clean = line.trim();

        // Multi-line if-return or if-panic
        if (clean.startsWith("if ") && clean.endsWith("{") && i + 2 < activeBlock.bodyLines.length) {
          const next = activeBlock.bodyLines[i + 1].trim();
          const third = activeBlock.bodyLines[i + 2].trim();
          if (third === "}") {
            const cond = clean.substring(3, clean.length - 1).trim();
            if (next.startsWith("return ") || next === "return") {
              const val = next.startsWith("return ") ? next.substring(7).replace(/;$/, "").trim() : "void";
              const statementText = `GUARD ${cond} RETURN ${val}`;
              bodyTranslated.push(`    ${statementText}`);

              nodesMeta.push({
                name: `Guard return (${cond.substring(0, 15)})`,
                type: "Rust Guard",
                rule: "Guard Assertions",
                desc: "Folds Rust expression checks and early execution returns.",
                before: `${line}\n${activeBlock.bodyLines[i+1]}\n${third}`,
                after: statementText
              });
              i += 3;
              continue;
            }
            if (next.startsWith("panic!")) {
              const statementText = `GUARD ${cond} THROW ${next.replace(/;$/, "").trim()}`;
              bodyTranslated.push(`    ${statementText}`);

              nodesMeta.push({
                name: `Guard panic (${cond.substring(0, 15)})`,
                type: "Rust Guard Panic",
                rule: "Guard Assertions",
                desc: "Folds conditional panics into an inline THROW instruction.",
                before: `${line}\n${activeBlock.bodyLines[i+1]}\n${third}`,
                after: statementText
              });
              i += 3;
              continue;
            }
          }
        }

        // Loop checks
        const forMatch = clean.match(/^for\s+(.+?)\s+in\s+(.+?)\s*\{$/);
        if (forMatch && i + 1 < activeBlock.bodyLines.length) {
          const next = activeBlock.bodyLines[i + 1].trim();
          if (activeBlock.bodyLines[i + 2]?.trim() === "}") {
            const statementText = `SCAN ${forMatch[2]} FOR ${forMatch[1]} -> ${translateRustStatement(next)}`;
            bodyTranslated.push(`    ${statementText}`);

            nodesMeta.push({
              name: `Rust collection loop (${forMatch[2]})`,
              type: "Scan Compactor",
              rule: "Scan Compactor",
              desc: "Compacts Rust iteration sequences.",
              before: `${line}\n${activeBlock.bodyLines[i+1]}\n${activeBlock.bodyLines[i+2]}`,
              after: statementText
            });
            i += 3;
            continue;
          }
        }

        const trans = translateRustStatement(clean);
        if (trans && trans !== "}") bodyTranslated.push(`    ${trans}`);
        i++;
      }

      const retType = mapTypeToCGE(activeBlock.ret);
      const signature = `${activeBlock.name}(${activeBlock.params})->${retType}:${bodyTranslated.length > 0 ? "\n" + bodyTranslated.join("\n") : " void"}`;
      
      if (activeBlock.isPublic) ops.push(signature);
      else privateOps.push(signature);

      nodesMeta.push({
        name: `${activeBlock.name}()`,
        type: activeBlock.isPublic ? "Public Function" : "Internal Fn",
        rule: "Block Collapsing",
        desc: "Squeezes layout margins and expression structures.",
        before: activeBlock.rawText,
        after: signature
      });

      activeBlock = null;
    };

    const flushStruct = () => {
      if (!activeStruct) return;
      const typeDef = `${activeStruct.name}{${activeStruct.fields.join(", ")}}`;
      types.push(typeDef);
      exports.push(activeStruct.name);

      nodesMeta.push({
        name: activeStruct.name,
        type: "Rust Struct",
        rule: "Primitive Folding",
        desc: "Packs struct definitions with brief shorthand primitives.",
        before: activeStruct.rawText,
        after: typeDef
      });

      activeStruct = null;
    };

    const flushEnum = () => {
      if (!activeEnum) return;
      const typeDef = `${activeEnum.name} = ${activeEnum.variants.join("|")}`;
      types.push(typeDef);
      exports.push(activeEnum.name);

      nodesMeta.push({
        name: activeEnum.name,
        type: "Rust Enum",
        rule: "Primitive Folding",
        desc: "Compacts rust variant listings.",
        before: activeEnum.rawText,
        after: typeDef
      });

      activeEnum = null;
    };

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const clean = line.trim();
      if (!clean || clean.startsWith("//") || clean.startsWith("/*")) continue;

      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      braceCount += opens - closes;

      if (activeBlock) {
        activeBlock.bodyLines.push(line);
        activeBlock.rawText += `\n${line}`;
        if (braceCount > 0 || (braceCount === 0 && opens > 0)) {
          continue;
        } else {
          flushBlock();
          continue;
        }
      }

      if (activeStruct) {
        activeStruct.rawText += `\n${line}`;
        if (clean.startsWith("}")) {
          flushStruct();
          continue;
        }
        const fieldMatch = clean.match(/^pub\s+(\w+)\s*:\s*(.+)/) || clean.match(/^(\w+)\s*:\s*(.+)/);
        if (fieldMatch) {
          activeStruct.fields.push(`${fieldMatch[1]}:${mapTypeToCGE(fieldMatch[2].replace(/,$/, ""))}`);
        }
        continue;
      }

      if (activeEnum) {
        activeEnum.rawText += `\n${line}`;
        if (clean.startsWith("}")) {
          flushEnum();
          continue;
        }
        const variant = clean.replace(/,$/, "");
        if (variant && !variant.startsWith("pub")) activeEnum.variants.push(variant);
        continue;
      }

      // 1. Imports
      const useMatch = clean.match(/^use\s+(.+);/);
      if (useMatch) {
        const val = useMatch[1];
        imports.push(val);
        nodesMeta.push({
          name: val.split("::").pop() || val,
          type: "Rust Dependency",
          rule: "Block Collapsing",
          desc: "Folds absolute scope mappings.",
          before: line,
          after: `IMPORTS: ${val}`
        });
        continue;
      }

      // 2. Structs
      const structMatch = clean.match(/^pub\s+struct\s+(\w+)/) || clean.match(/^struct\s+(\w+)/);
      if (structMatch) {
        flushStruct();
        activeStruct = { name: structMatch[1], fields: [], rawText: line };
        continue;
      }

      // 3. Enums
      const enumMatch = clean.match(/^pub\s+enum\s+(\w+)/) || clean.match(/^enum\s+(\w+)/);
      if (enumMatch) {
        flushEnum();
        activeEnum = { name: enumMatch[1], variants: [], rawText: line };
        continue;
      }

      // 4. Functions
      const fnMatch = clean.match(/^(pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\((.*?)\)(?:\s*->\s*(.+?))?\s*\{/);
      if (fnMatch) {
        const isPublic = !!fnMatch[1];
        const name = fnMatch[2];
        const paramsRaw = fnMatch[3] || "";
        const ret = fnMatch[4]?.trim() || "()";

        const params = paramsRaw.split(",").map(p => p.trim())
          .filter(p => p && p !== "self" && p !== "&self" && p !== "&mut self")
          .map(p => {
            const parts = p.split(":");
            return `${parts[0]?.trim()}:${mapTypeToCGE(parts[1])}`;
          }).join(", ");

        activeBlock = { name, isPublic, params, ret, bodyLines: [], rawText: line };
        if (isPublic) exports.push(name);
        continue;
      }

      // 5. Constants
      const constMatch = clean.match(/^(pub\s+)?const\s+(\w+)\s*:\s*(.+?)\s*=\s*(.+);/);
      if (constMatch) {
        const stateDef = `CONST ${constMatch[2]}:${mapTypeToCGE(constMatch[3])} = ${constMatch[4]}`;
        state.push(stateDef);
        if (constMatch[1]) exports.push(constMatch[2]);

        nodesMeta.push({
          name: constMatch[2],
          type: "Rust Constant",
          rule: "Primitive Folding",
          desc: "Folds global static constant types.",
          before: line,
          after: stateDef
        });
      }
    }

    flushBlock();
    flushStruct();
    flushEnum();

    return { imports, types, state, ops, privateOps, exports, nodes: nodesMeta };
  }
}

// Client-side Compiler Manager Orchestrator
class CGEClientCompiler {
  compile(code, language, fileName) {
    let parser;
    switch (language) {
      case "typescript": parser = new TypeScriptClientParser(); break;
      case "python": parser = new PythonClientParser(); break;
      case "rust": parser = new RustClientParser(); break;
      default: return { text: "Unsupported language.", nodes: [] };
    }

    const parsed = parser.parse(code);
    const compName = fileName ? fileName.split(".")[0] : "Component";
    const label = language === "typescript" ? "TypeScript" : language.charAt(0).toUpperCase() + language.slice(1);
    
    let output = `CGE/1.0 ${compName} (${label})\n\n`;

    if (parsed.imports.length > 0) output += `IMPORTS:\n  ${parsed.imports.join("\n  ")}\n\n`;
    if (parsed.types.length > 0) output += `TYPES:\n  ${parsed.types.join("\n  ")}\n\n`;
    if (parsed.state.length > 0) output += `STATE:\n  ${parsed.state.join("\n  ")}\n\n`;
    if (parsed.ops.length > 0) output += `OPS:\n  ${parsed.ops.join("\n\n  ")}\n\n`;
    if (parsed.privateOps.length > 0) output += `PRIVATE:\n  ${parsed.privateOps.join("\n  ")}\n\n`;
    if (parsed.exports.length > 0) output += `EXPORTS: ${parsed.exports.join(", ")}\n`;

    return {
      text: output.trim() + "\n",
      nodes: parsed.nodes
    };
  }
}

// =========================================================================
// 2. UI Controller & Templates
// =========================================================================

const compiler = new CGEClientCompiler();

const templates = {
  typescript: `import { useState, useEffect } from "react";

export interface User {
  id: string;
  email: string;
  isActive: boolean;
}

export const useAuthActions = (userId: string) => {
  const [user, setUser] = useState<User | null>(null);

  const login = async (email: string) => {
    if (!email) {
      throw new Error("Invalid email");
    }
    const token = await api.auth.login(email);
    return token;
  };

  const verifySession = () => {
    const sessions = getSessions();
    for (const session of sessions) {
      if (session.active) return true;
    }
    return false;
  };

  return { user, login };
};`,

  python: `from datetime import datetime
from typing import List, Optional

class UserSession:
    id: str
    email: str
    is_active: bool
    created_at: datetime

TOKEN_EXPIRY_MS = 900000

def verify_session(session: UserSession) -> bool:
    if not session:
        raise ValueError("Missing session")
    
    for token in session.active_tokens:
        if token.is_expired():
            return False
            
    return True

def _get_hash(password: str) -> str:
    return "md5_hash_value"`,

  rust: `use std::time::Duration;
use std::collections::HashMap;

pub struct AuthToken {
    pub value: String,
    pub expires_at: u64,
}

pub enum UserRole {
    Admin,
    Editor,
    Viewer,
}

const MAX_LOGIN_ATTEMPTS: u32 = 5;

pub fn validate_token(token: AuthToken) -> bool {
    if token.value.is_empty() {
        return false;
    }
    true
}

fn internal_hash(val: String) -> () {
    println!("internal hashing");
}`
};

// =========================================================================

self.addEventListener('message', function(e) {
  const data = e.data;
  
  if (data.type === 'compile') {
    try {
      const result = compiler.compile(data.content, data.lang, data.name);
      self.postMessage({
        id: data.id,
        type: 'success',
        result: { text: result.text }
      });
    } catch (err) {
      self.postMessage({
        id: data.id,
        type: 'error',
        error: err.toString()
      });
    }
  }
});
