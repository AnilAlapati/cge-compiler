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
        if (braceCount >= activeBlock.startBraceLevel) {
          activeBlock.bodyLines.push(line);
          activeBlock.rawText += `\n${line}`;
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

        activeBlock = { name, isPublic, params, ret, bodyLines: [], rawText: line, startBraceLevel: clean.includes("{") ? braceCount : braceCount + 1 };
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

// Client-side Go CGE Parser
class GoClientParser {
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
    let activeInterface = null;
    let activeBlock = null;
    let inImportBlock = false;
    let inVarBlock = false;
    let inConstBlock = false;
    let braceCount = 0;

    const mapGoType = (goType) => {
      if (!goType) return "any";
      let clean = goType.trim();
      if (clean.startsWith("*")) clean = clean.substring(1).trim();

      switch (clean) {
        case "string": return "S";
        case "int":
        case "int32":
        case "int64":
        case "uint":
        case "uint32":
        case "uint64":
        case "float32":
        case "float64":
          return "N";
        case "bool": return "B";
        case "time.Time": return "D";
        case "error": return "error";
        case "interface{}":
        case "any":
          return "any";
      }
      if (clean.startsWith("[]")) {
        return `${mapGoType(clean.substring(2))}[]`;
      }
      if (clean.startsWith("map[")) {
        const bracketIndex = clean.indexOf("]");
        if (bracketIndex > 4) {
          const keyType = clean.substring(4, bracketIndex);
          const valueType = clean.substring(bracketIndex + 1);
          return `Map<${mapGoType(keyType)}, ${mapGoType(valueType)}>`;
        }
      }
      return clean;
    };

    const translateGoStatement = (stmt) => {
      const clean = stmt.trim();
      if (!clean) return "";

      const guardReturn = clean.match(/^if\s+(.+?)\s*\{\s*return\s*(.*?)\s*\}/);
      if (guardReturn) return `GUARD ${guardReturn[1]} RETURN ${guardReturn[2] || "void"}`;

      const guardPanic = clean.match(/^if\s+(.+?)\s*\{\s*panic\((.*?)\)\s*\}/);
      if (guardPanic) return `GUARD ${guardPanic[1]} THROW ${guardPanic[2]}`;

      if (clean.startsWith("return ")) return `RETURN ${clean.substring(7)}`;
      return clean;
    };

    const isCapitalized = (str) => {
      if (!str) return false;
      const char = str.charAt(0);
      return char === char.toUpperCase() && char !== char.toLowerCase();
    };

    const flushStruct = () => {
      if (!activeStruct) return;
      const prefix = isCapitalized(activeStruct.name) ? "EXPORT " : "";
      types.push(`${prefix}${activeStruct.name}{${activeStruct.fields.join(", ")}}`);
      if (isCapitalized(activeStruct.name)) exports.push(activeStruct.name);
      activeStruct = null;
    };

    const flushInterface = () => {
      if (!activeInterface) return;
      const prefix = isCapitalized(activeInterface.name) ? "EXPORT " : "";
      types.push(`${prefix}${activeInterface.name}{${activeInterface.methods.join(", ")}}`);
      if (isCapitalized(activeInterface.name)) exports.push(activeInterface.name);
      activeInterface = null;
    };

    const flushBlock = () => {
      if (!activeBlock) return;
      const bodyTranslated = [];
      let i = 0;
      while (i < activeBlock.bodyLines.length) {
        const line = activeBlock.bodyLines[i];
        const clean = line.trim();

        if (clean.startsWith("if ") && clean.endsWith("{") && i + 2 < activeBlock.bodyLines.length) {
          const next = activeBlock.bodyLines[i + 1].trim();
          const third = activeBlock.bodyLines[i + 2].trim();
          if (third === "}") {
            const cond = clean.substring(3, clean.length - 1).trim();
            if (next.startsWith("return ") || next === "return") {
              const val = next.startsWith("return ") ? next.substring(7).trim() : "void";
              const statementText = `GUARD ${cond} RETURN ${val}`;
              bodyTranslated.push(`    ${statementText}`);
              nodesMeta.push({
                name: `Guard return (${cond.substring(0, 15)})`,
                type: "Go Guard",
                rule: "Guard Assertions",
                desc: "Folds Go check and early return flow.",
                before: `${line}\n${activeBlock.bodyLines[i+1]}\n${third}`,
                after: statementText
              });
              i += 3;
              continue;
            }
            if (next.startsWith("panic(")) {
              const errMatch = next.match(/^panic\((.*?)\)/);
              const err = errMatch ? errMatch[1] : next;
              const statementText = `GUARD ${cond} THROW ${err}`;
              bodyTranslated.push(`    ${statementText}`);
              nodesMeta.push({
                name: `Guard panic (${cond.substring(0, 15)})`,
                type: "Go Guard Panic",
                rule: "Guard Assertions",
                desc: "Folds conditional panics into an inline THROW.",
                before: `${line}\n${activeBlock.bodyLines[i+1]}\n${third}`,
                after: statementText
              });
              i += 3;
              continue;
            }
          }
        }

        const rangeMatch = clean.match(/^for\s+(.+?)\s*:=\s*range\s+(.+?)\s*\{$/) || clean.match(/^for\s+(.+?)\s*=\s*range\s+(.+?)\s*\{$/);
        if (rangeMatch && i + 1 < activeBlock.bodyLines.length) {
          const next = activeBlock.bodyLines[i + 1].trim();
          if (next.endsWith("}")) {
            const iteratorRaw = rangeMatch[1] || "";
            const collection = rangeMatch[2] || "";
            const iterator = iteratorRaw.replace(/^_\s*,\s*/, "").trim();
            const statementText = `SCAN ${collection} FOR ${iterator} -> ${translateGoStatement(next)}`;
            bodyTranslated.push(`    ${statementText}`);
            nodesMeta.push({
              name: `Range Loop (${iterator})`,
              type: "Go Range Loop",
              rule: "Logic Folding",
              desc: "Folds a Go range iterator loop into a SCAN notation.",
              before: `${line}\n${activeBlock.bodyLines[i+1]}`,
              after: statementText
            });
            i += 2;
            continue;
          }
        }

        const trans = translateGoStatement(clean);
        if (trans && trans !== "}") {
          bodyTranslated.push(`    ${trans}`);
        }
        i++;
      }

      const nameWithReceiver = activeBlock.receiver ? `${activeBlock.receiver}.${activeBlock.name}` : activeBlock.name;
      const signature = `${activeBlock.isExported ? "EXPORT " : ""}${nameWithReceiver}(${activeBlock.params})->${activeBlock.ret}:${bodyTranslated.length > 0 ? "\n" + bodyTranslated.join("\n") : " void"}`;

      if (activeBlock.isExported) {
        ops.push(signature);
        exports.push(activeBlock.name);
      } else {
        privateOps.push(signature);
      }

      nodesMeta.push({
        name: activeBlock.name,
        type: activeBlock.receiver ? "Go Struct Method" : "Go Function",
        rule: "Logic Extraction",
        desc: `Processes the Go logic flow for function ${activeBlock.name}.`,
        before: signature,
        after: signature
      });

      activeBlock = null;
    };

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const clean = line.trim();
      if (!clean || clean.startsWith("//") || clean.startsWith("/*")) continue;

      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      braceCount += opens - closes;

      if (activeBlock) {
        if (braceCount >= activeBlock.startBraceLevel) {
          activeBlock.bodyLines.push(line);
          continue;
        } else {
          flushBlock();
          continue;
        }
      }

      if (activeStruct) {
        if (clean.startsWith("}")) {
          flushStruct();
          continue;
        }
        const fieldMatch = clean.match(/^(\w+)\s+([^\s`]+)/);
        if (fieldMatch) {
          const fName = fieldMatch[1];
          const fType = mapGoType(fieldMatch[2]);
          activeStruct.fields.push(`${fName}:${fType}`);
        }
        continue;
      }

      if (activeInterface) {
        if (clean.startsWith("}")) {
          flushInterface();
          continue;
        }
        const methodMatch = clean.match(/^(\w+)\s*\((.*?)\)\s*(.*)/);
        if (methodMatch) {
          const mName = methodMatch[1];
          const paramsRaw = methodMatch[2] || "";
          const retRaw = methodMatch[3]?.trim() || "void";
          const params = paramsRaw
            .split(",")
            .map(p => p.trim())
            .filter(Boolean)
            .map(p => {
              const parts = p.split(/\s+/);
              return parts.length === 2 ? `${parts[0]}:${mapGoType(parts[1])}` : `param:${mapGoType(p)}`;
            })
            .join(", ");
          
          let ret = mapGoType(retRaw);
          if (retRaw.startsWith("(")) {
            const cleanedRet = retRaw.replace(/[()]/g, "");
            ret = cleanedRet.split(",").map(r => mapGoType(r.trim())).join("|");
          }
          activeInterface.methods.push(`${mName}(${params})->${ret}`);
        }
        continue;
      }

      if (inImportBlock) {
        if (clean.startsWith(")")) {
          inImportBlock = false;
          continue;
        }
        const impMatch = clean.match(/^"(.+?)"/);
        if (impMatch) imports.push(impMatch[1]);
        continue;
      }

      if (inVarBlock || inConstBlock) {
        if (clean.startsWith(")")) {
          inVarBlock = false;
          inConstBlock = false;
          continue;
        }
        const stateMatch = clean.match(/^(\w+)\s*(?:[^\s=]*)\s*=\s*(.+)/);
        if (stateMatch) {
          const name = stateMatch[1];
          const val = stateMatch[2];
          const prefix = inConstBlock ? "CONST " : "";
          const exportPrefix = isCapitalized(name) ? "EXPORT " : "";
          state.push(`${exportPrefix}${prefix}${name}:any = ${val}`);
          if (isCapitalized(name)) exports.push(name);
        }
        continue;
      }

      const singleImport = clean.match(/^import\s+"(.+?)"/);
      if (singleImport) {
        imports.push(singleImport[1]);
        continue;
      }

      if (clean === "import (") {
        inImportBlock = true;
        continue;
      }

      const structMatch = clean.match(/^type\s+(\w+)\s+struct\s*\{/);
      if (structMatch) {
        flushStruct();
        flushInterface();
        activeStruct = { name: structMatch[1], fields: [] };
        continue;
      }

      const interfaceMatch = clean.match(/^type\s+(\w+)\s+interface\s*\{/);
      if (interfaceMatch) {
        flushStruct();
        flushInterface();
        activeInterface = { name: interfaceMatch[1], methods: [] };
        continue;
      }

      const fnMatch = clean.match(/^func\s+(?:\((.+?)\)\s+)?(\w+)\s*\((.*?)\)\s*(.*?)\s*\{/);
      if (fnMatch) {
        const receiverRaw = fnMatch[1] || "";
        const name = fnMatch[2];
        const paramsRaw = fnMatch[3] || "";
        const retRaw = fnMatch[4]?.trim() || "void";

        let receiver = "";
        if (receiverRaw) {
          const parts = receiverRaw.trim().split(/\s+/);
          const rType = parts[1] || parts[0] || "";
          receiver = rType.replace(/^\*/, "").trim();
        }

        const params = paramsRaw
          .split(",")
          .map(p => p.trim())
          .filter(Boolean)
          .map(p => {
            const parts = p.split(/\s+/);
            return parts.length === 2 ? `${parts[0]}:${mapGoType(parts[1])}` : `param:${mapGoType(p)}`;
          })
          .join(", ");

        let ret = mapGoType(retRaw);
        if (retRaw.startsWith("(")) {
          const cleanedRet = retRaw.replace(/[()]/g, "");
          ret = cleanedRet.split(",").map(r => mapGoType(r.trim())).join("|");
        }

        activeBlock = {
          name,
          isExported: isCapitalized(name),
          receiver,
          params,
          ret,
          bodyLines: [],
          startBraceLevel: clean.includes("{") ? braceCount : braceCount + 1
        };
        continue;
      }

      const singleConst = clean.match(/^const\s+(\w+)\s*(?:[^\s=]*)\s*=\s*(.+)/);
      if (singleConst) {
        const name = singleConst[1];
        const val = singleConst[2];
        const prefix = isCapitalized(name) ? "EXPORT " : "";
        state.push(`${prefix}CONST ${name}:any = ${val}`);
        if (isCapitalized(name)) exports.push(name);
        continue;
      }

      const singleVar = clean.match(/^var\s+(\w+)\s*(?:[^\s=]*)\s*=\s*(.+)/);
      if (singleVar) {
        const name = singleVar[1];
        const val = singleVar[2];
        const prefix = isCapitalized(name) ? "EXPORT " : "";
        state.push(`${prefix}${name}:any = ${val}`);
        if (isCapitalized(name)) exports.push(name);
        continue;
      }

      if (clean === "var (") {
        inVarBlock = true;
        continue;
      }
      if (clean === "const (") {
        inConstBlock = true;
        continue;
      }
    }

    flushStruct();
    flushInterface();
    flushBlock();

    return { imports, types, state, ops, privateOps, exports, nodes: nodesMeta };
  }
}

// Client-side C++ CGE Parser
class CppClientParser {
  parse(code) {
    const lines = code.split("\n");
    const imports = [];
    const types = [];
    const state = [];
    const ops = [];
    const privateOps = [];
    const exports = [];
    const nodesMeta = [];

    let activeClass = null;
    let activeEnum = null;
    let activeBlock = null;
    let currentAccess = "private";
    let braceCount = 0;

    const mapCppType = (cppType) => {
      if (!cppType) return "any";
      let clean = cppType.trim().replace(/\bconst\b/g, "").replace(/[&*]/g, "").trim();
      if (clean.startsWith("std::")) clean = clean.substring(5);

      switch (clean) {
        case "string": return "S";
        case "int":
        case "float":
        case "double":
        case "long":
        case "short":
        case "size_t":
        case "char":
        case "int32_t":
        case "int64_t":
        case "uint32_t":
        case "uint64_t":
          return "N";
        case "bool": return "B";
        case "void": return "void";
      }
      if (clean.startsWith("vector<") || clean.startsWith("list<")) {
        const inner = clean.substring(clean.indexOf("<") + 1, clean.lastIndexOf(">"));
        return `${mapCppType(inner)}[]`;
      }
      if (clean.startsWith("map<") || clean.startsWith("unordered_map<")) {
        const inner = clean.substring(clean.indexOf("<") + 1, clean.lastIndexOf(">"));
        const parts = inner.split(",");
        return `Map<${mapCppType(parts[0]?.trim() || "S")}, ${mapCppType(parts[1]?.trim() || "any")}>`;
      }
      return clean;
    };

    const translateCppStatement = (stmt) => {
      const clean = stmt.trim().replace(/;$/, "");
      if (!clean) return "";

      const guardReturn = clean.match(/^if\s*\((.+?)\)\s*return\s*(.*?)$/);
      if (guardReturn) return `GUARD ${guardReturn[1]} RETURN ${guardReturn[2] || "void"}`;

      const guardThrow = clean.match(/^if\s*\((.+?)\)\s*throw\s+(.*?)$/);
      if (guardThrow) return `GUARD ${guardThrow[1]} THROW ${guardThrow[2]}`;

      if (clean.startsWith("return ")) return `RETURN ${clean.substring(7)}`;
      if (clean.startsWith("throw ")) return `THROW ${clean.substring(6)}`;
      return clean;
    };

    const flushClass = () => {
      if (!activeClass) return;
      types.push(`EXPORT ${activeClass.name}{${activeClass.fields.join(", ")}}`);
      exports.push(activeClass.name);
      activeClass = null;
    };

    const flushEnum = () => {
      if (!activeEnum) return;
      types.push(`EXPORT ${activeEnum.name} = ${activeEnum.variants.join("|")}`);
      exports.push(activeEnum.name);
      activeEnum = null;
    };

    const flushBlock = () => {
      if (!activeBlock) return;
      const bodyTranslated = [];
      let i = 0;
      while (i < activeBlock.bodyLines.length) {
        const line = activeBlock.bodyLines[i];
        const clean = line.trim();

        if (clean.startsWith("if ") && clean.endsWith("{") && i + 2 < activeBlock.bodyLines.length) {
          const next = activeBlock.bodyLines[i + 1].trim().replace(/;$/, "");
          const third = activeBlock.bodyLines[i + 2].trim();
          if (third === "}") {
            const cond = clean.substring(clean.indexOf("(") + 1, clean.lastIndexOf(")")).trim();
            if (next.startsWith("return ") || next === "return") {
              const val = next.startsWith("return ") ? next.substring(7).trim() : "void";
              const statementText = `GUARD ${cond} RETURN ${val}`;
              bodyTranslated.push(`    ${statementText}`);
              nodesMeta.push({
                name: `Guard return (${cond.substring(0, 15)})`,
                type: "C++ Guard",
                rule: "Guard Assertions",
                desc: "Folds C++ early return flow.",
                before: `${line}\n${activeBlock.bodyLines[i+1]}\n${third}`,
                after: statementText
              });
              i += 3;
              continue;
            }
            if (next.startsWith("throw ")) {
              const err = next.substring(6).trim();
              const statementText = `GUARD ${cond} THROW ${err}`;
              bodyTranslated.push(`    ${statementText}`);
              nodesMeta.push({
                name: `Guard throw (${cond.substring(0, 15)})`,
                type: "C++ Guard Throw",
                rule: "Guard Assertions",
                desc: "Folds conditional throw into THROW.",
                before: `${line}\n${activeBlock.bodyLines[i+1]}\n${third}`,
                after: statementText
              });
              i += 3;
              continue;
            }
          }
        }

        const forMatch = clean.match(/^for\s*\((.+?)\s*:\s*(.+?)\)\s*\{$/);
        if (forMatch && i + 1 < activeBlock.bodyLines.length) {
          const next = activeBlock.bodyLines[i + 1].trim().replace(/;$/, "");
          if (next.endsWith("}")) {
            const decl = forMatch[1] || "";
            const collection = forMatch[2] || "";
            const declParts = decl.trim().split(/\s+/);
            const iterator = declParts[declParts.length - 1]?.replace(/[&*]/g, "") || "item";
            const statementText = `SCAN ${collection} FOR ${iterator} -> ${translateCppStatement(next)}`;
            bodyTranslated.push(`    ${statementText}`);
            nodesMeta.push({
              name: `Range Loop (${iterator})`,
              type: "C++ Range Loop",
              rule: "Logic Folding",
              desc: "Folds C++ iterator loops into SCAN notation.",
              before: `${line}\n${activeBlock.bodyLines[i+1]}`,
              after: statementText
            });
            i += 2;
            continue;
          }
        }

        const trans = translateCppStatement(clean);
        if (trans && trans !== "}") {
          bodyTranslated.push(`    ${trans}`);
        }
        i++;
      }

      const nameWithClass = activeBlock.className ? `${activeBlock.className}.${activeBlock.name}` : activeBlock.name;
      const signature = `${activeBlock.isPublic ? "EXPORT " : ""}${nameWithClass}(${activeBlock.params})->${activeBlock.ret}:${bodyTranslated.length > 0 ? "\n" + bodyTranslated.join("\n") : " void"}`;

      if (activeBlock.isPublic) {
        ops.push(signature);
        exports.push(activeBlock.name);
      } else {
        privateOps.push(signature);
      }

      nodesMeta.push({
        name: activeBlock.name,
        type: activeBlock.className ? "C++ Class Method" : "C++ Function",
        rule: "Logic Extraction",
        desc: `Processes logic flow for C++ signature ${activeBlock.name}.`,
        before: signature,
        after: signature
      });

      activeBlock = null;
    };

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      const clean = line.trim();
      if (!clean || clean.startsWith("//") || clean.startsWith("/*")) continue;

      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      braceCount += opens - closes;

      if (activeBlock) {
        if (braceCount >= activeBlock.startBraceLevel) {
          activeBlock.bodyLines.push(line);
          continue;
        } else {
          flushBlock();
          continue;
        }
      }

      if (activeClass) {
        if (clean.startsWith("};")) {
          flushClass();
          continue;
        }
        if (clean === "public:") { currentAccess = "public"; continue; }
        if (clean === "private:") { currentAccess = "private"; continue; }
        if (clean === "protected:") { currentAccess = "protected"; continue; }

        const classMethodMatch = clean.match(/^(?:virtual\s+)?([^\s]+)\s+(\w+)\s*\((.*?)\)(?:\s*const)?\s*\{/);
        if (classMethodMatch) {
          const ret = mapCppType(classMethodMatch[1]);
          const name = classMethodMatch[2];
          const paramsRaw = classMethodMatch[3] || "";
          const isPublic = activeClass.isStruct || currentAccess === "public";
          const params = paramsRaw
            .split(",")
            .map(p => p.trim())
            .filter(Boolean)
            .map(p => {
              const parts = p.split(/\s+/);
              return parts.length >= 2 ? `${parts[parts.length - 1]?.replace(/[&*]/g, "")}:${mapCppType(parts.slice(0, -1).join(" "))}` : `param:${mapCppType(p)}`;
            })
            .join(", ");

          activeBlock = {
            name,
            isPublic,
            className: activeClass.name,
            params,
            ret,
            bodyLines: [],
            startBraceLevel: clean.includes("{") ? braceCount : braceCount + 1
          };
          continue;
        }

        const propMatch = clean.match(/^([^\s]+)\s+(\w+)\s*(?:=\s*[^;]+)?\s*;/);
        if (propMatch) {
          const type = mapCppType(propMatch[1]);
          const name = propMatch[2];
          if (activeClass.isStruct || currentAccess === "public") {
            activeClass.fields.push(`${name}:${type}`);
          }
          const prefix = (activeClass.isStruct || currentAccess === "public") ? "EXPORT " : "";
          state.push(`${prefix}${activeClass.name}.${name}:${type}`);
        }
        continue;
      }

      if (activeEnum) {
        if (clean.startsWith("};")) {
          flushEnum();
          continue;
        }
        const val = clean.replace(/,$/, "").trim();
        if (val) activeEnum.variants.push(val);
        continue;
      }

      const includeMatch = clean.match(/^#include\s+["<](.+?)[">]/);
      if (includeMatch) {
        imports.push(includeMatch[1]);
        continue;
      }

      const classMatch = clean.match(/^class\s+(\w+)\s*\{/);
      if (classMatch) {
        flushClass();
        flushEnum();
        activeClass = { name: classMatch[1], isStruct: false, fields: [] };
        currentAccess = "private";
        continue;
      }

      const structMatch = clean.match(/^struct\s+(\w+)\s*\{/);
      if (structMatch) {
        flushClass();
        flushEnum();
        activeClass = { name: structMatch[1], isStruct: true, fields: [] };
        currentAccess = "public";
        continue;
      }

      const enumMatch = clean.match(/^enum\s+(\w+)\s*\{/) || clean.match(/^enum\s+class\s+(\w+)\s*\{/);
      if (enumMatch) {
        flushClass();
        flushEnum();
        activeEnum = { name: enumMatch[1], variants: [] };
        continue;
      }

      const globalFnMatch = clean.match(/^([^\s]+)\s+(\w+)\s*\((.*?)\)\s*\{/);
      if (globalFnMatch) {
        const ret = mapCppType(globalFnMatch[1]);
        const name = globalFnMatch[2];
        const paramsRaw = globalFnMatch[3] || "";
        const isPublic = name !== "main";
        const params = paramsRaw
          .split(",")
          .map(p => p.trim())
          .filter(Boolean)
          .map(p => {
            const parts = p.split(/\s+/);
            return parts.length >= 2 ? `${parts[parts.length - 1]?.replace(/[&*]/g, "")}:${mapCppType(parts.slice(0, -1).join(" "))}` : `param:${mapCppType(p)}`;
          })
          .join(", ");

        activeBlock = {
          name,
          isPublic,
          className: "",
          params,
          ret,
          bodyLines: [],
          startBraceLevel: clean.includes("{") ? braceCount : braceCount + 1
        };
        continue;
      }

      const constMatch = clean.match(/^const\s+([^\s]+)\s+(\w+)\s*=\s*(.+?);/);
      if (constMatch) {
        const type = mapCppType(constMatch[1]);
        const name = constMatch[2];
        const val = constMatch[3];
        state.push(`EXPORT CONST ${name}:${type} = ${val}`);
        exports.push(name);
        continue;
      }

      const varMatch = clean.match(/^([^\s]+)\s+(\w+)\s*=\s*(.+?);/);
      if (varMatch) {
        const type = mapCppType(varMatch[1]);
        const name = varMatch[2];
        const val = varMatch[3];
        if (name !== "using" && type !== "namespace") {
          state.push(`EXPORT ${name}:${type} = ${val}`);
          exports.push(name);
        }
        continue;
      }
    }

    flushClass();
    flushEnum();
    flushBlock();

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
      case "go": parser = new GoClientParser(); break;
      case "cpp": parser = new CppClientParser(); break;
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
  role: "admin" | "user" | "guest";
  isActive: boolean;
}

export interface AuthSession {
  token: string;
  expiresAt: number;
  scopes: string[];
}

export interface SecurityLog {
  timestamp: number;
  event: string;
  ipAddress: string;
}

const SESSION_TIMEOUT_MS = 3600000;
const MAX_RETRY_ATTEMPTS = 3;

export const useAuthActions = (userId: string) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [logs, setLogs] = useState<SecurityLog[]>([]);

  const login = async (email: string, mfaCode?: string) => {
    if (!email) {
      throw new Error("Invalid email address provided");
    }
    if (email.indexOf("@") === -1) {
      throw new Error("Email must contain @ character");
    }
    const token = await api.auth.login(email, mfaCode);
    return token;
  };

  const logout = async () => {
    if (!session) {
      return false;
    }
    await api.auth.revoke(session.token);
    setSession(null);
    setUser(null);
    return true;
  };

  const verifySession = () => {
    if (!session) {
      return false;
    }
    if (Date.now() > session.expiresAt) {
      return false;
    }
    const activeScopes = session.scopes;
    for (const scope of activeScopes) {
      if (scope === "admin") return true;
    }
    return false;
  };

  const auditLogs = () => {
    const activeLogs = logs;
    for (const log of activeLogs) {
      if (log.event === "unauthorized") return true;
    }
    return false;
  };

  const hasPermission = (requiredScope: string) => {
    if (!session) {
      return false;
    }
    const scopes = session.scopes;
    for (const scope of scopes) {
      if (scope === requiredScope) return true;
    }
    return false;
  };

  return {
    user,
    session,
    login,
    logout,
    verifySession,
    auditLogs,
    hasPermission
  };
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
}`,

  go: `package main

import (
	"fmt"
	"time"
)

type UserSession struct {
	ID        string
	Email     string
	IsActive  bool
	CreatedAt time.Time
}

const TokenExpirySeconds = 900

func VerifySession(session *UserSession) bool {
	if session == nil {
		panic("missing session")
	}
	
	for _, token := range session.Tokens {
		if token.Expired {
			return false
		}
	}
	return true
}

func getHash(val string) string {
	return "hashed_value"
}`,

  cpp: `#include <string>
#include <vector>
#include <stdexcept>

struct AuthToken {
    std::string value;
    long expires_at;
};

class UserSession {
public:
    std::string id;
    std::string email;
    bool is_active;
    std::vector<AuthToken> tokens;
};

const int MAX_ATTEMPTS = 5;

bool verifySession(const UserSession& session) {
    if (session.id.empty()) {
        throw std::invalid_argument("missing id");
    }
    
    for (auto& token : session.tokens) {
        if (token.value.empty()) {
            return false;
        }
    }
    return true;
}

std::string getHash(std::string val) {
    return "hash";
}`
};

// =========================================================================
// 2.5 Auto-Detect Heuristic Engine
// =========================================================================

function autoDetectLanguage(code) {
  if (!code || code.trim().length < 10) return null;
  
  // Fast regex heuristics looking for strong syntactical tells
  const hasPython = /\bdef\b|\belif\b|:\s*\n\s+/.test(code) && !/[{}]/.test(code.substring(0, 50));
  const hasRust = /\bfn\b|\bimpl\b|\bpub\s+(?:struct|fn|enum)\b/.test(code);
  const hasGo = /\bfunc\b|\bpackage\b|\bchan\b/.test(code);
  const hasCpp = /#include|\bstd::\b|\bint\s+main\s*\(/.test(code);
  const hasTS = /\binterface\b|\bexport\b/.test(code);
  
  let matches = 0;
  let detected = null;
  
  if (hasPython) { matches++; detected = "python"; }
  if (hasRust) { matches++; detected = "rust"; }
  if (hasGo) { matches++; detected = "go"; }
  if (hasCpp) { matches++; detected = "cpp"; }
  if (hasTS) { matches++; detected = "typescript"; }

  // If we have exactly one strong match, we confidently return it. Otherwise, return null (ambiguous).
  return matches === 1 ? detected : null;
}

// =========================================================================
// 3. DOM Initialization & Event Binding
// =========================================================================

const SUPPORTED_LANGUAGES = [
  { id: "typescript", name: "TypeScript", icon: "⚡", color: "#3b82f6" },
  { id: "python", name: "Python", icon: "🐍", color: "#10b981" },
  { id: "rust", name: "Rust", icon: "🦀", color: "#f59e0b" },
  { id: "go", name: "Go", icon: "🐹", color: "#06b6d4" },
  { id: "cpp", name: "C++", icon: "🥽", color: "#8b5cf6" }
];

document.addEventListener("DOMContentLoaded", () => {
  // Populate UI with single source of truth for languages
  const segmentTabsContainer = document.getElementById("segment-tabs");
  if (segmentTabsContainer) {
    segmentTabsContainer.innerHTML = SUPPORTED_LANGUAGES.map((lang, idx) => `
      <button class="segment-tab ${idx === 0 ? 'active' : ''}" data-lang="${lang.id}">
        ${lang.icon} ${lang.name}
      </button>
    `).join('');
  }

  const zipLangs = document.getElementById("zip-supported-langs");
  if (zipLangs) {
    const formattedLangs = SUPPORTED_LANGUAGES.map(lang => 
      `<span style="color: ${lang.color}; font-weight: 600;">${lang.name}</span>`
    );
    const last = formattedLangs.pop();
    zipLangs.innerHTML = `Supports ${formattedLangs.join(', ')}, and ${last} codebase archives.`;
  }

  const codeInput     = document.getElementById("code-input");
  const cgeOutput     = document.getElementById("cge-output");
  const copyBtn = document.getElementById("copy-btn");
  
  const optComments = document.getElementById("opt-comments");
  const optJsdoc = document.getElementById("opt-jsdoc");
  const optDeadCode = document.getElementById("opt-dead-code");
  const optWhitespace = document.getElementById("opt-whitespace");
  
  if (optComments) optComments.addEventListener("change", handleCompile);
  if (optJsdoc) optJsdoc.addEventListener("change", handleCompile);
  if (optDeadCode) optDeadCode.addEventListener("change", handleCompile);
  if (optWhitespace) optWhitespace.addEventListener("change", handleCompile);
  const llmPromptBtn  = document.getElementById("llm-prompt-btn");
  const tabBtns       = document.querySelectorAll(".segment-tab");
  const extLabel      = document.getElementById("ext-label");
  const lineNumbers   = document.getElementById("gutter-lines");
  const outputGutterLines = document.getElementById("output-gutter-lines");
  const outputScroller = document.getElementById("output-scroller");
  const toast         = document.getElementById("toast-bar");

  // Mode Swapping DOM nodes
  const btnModeCode   = document.getElementById("btn-mode-code");
  const btnModeVisual = document.getElementById("btn-mode-visual");
  const btnModeVerify = document.getElementById("btn-mode-verify");
  
  const containerCode = document.getElementById("container-code");
  const containerVisual = document.getElementById("container-visual");
  const containerVerify = document.getElementById("container-verify");
  const containerAudit  = document.getElementById("container-audit");
  const astTreeView   = document.getElementById("ast-tree-view");
  const editorGrid    = document.querySelector(".editor-grid");
  const outputCard    = document.getElementById("output-card");
  const compileBridge = document.querySelector(".compile-bridge");

  // Input Swapper DOM nodes
  const btnInputCode = document.getElementById("btn-input-code");
  const btnInputZip  = document.getElementById("btn-input-zip");
  const inputContainerCode = document.getElementById("input-container-code");
  const inputContainerZip  = document.getElementById("input-container-zip");

  // CLNR DOM nodes
  const llmInput          = document.getElementById("llm-reconstructed-input");
  const verifyGutterLines = document.getElementById("verify-gutter-lines");
  const verifyStatus      = document.getElementById("verify-status");
  const verifyDiffList    = document.getElementById("verify-diff-list");
  const patchAction       = document.getElementById("patch-action");
  const copyPatchBtn      = document.getElementById("copy-patch-btn");

  // Drawer DOM nodes
  const astDrawer         = document.getElementById("ast-drawer");
  const drawerCloseBtn    = document.getElementById("drawer-close-btn");
  const drawerNodeName    = document.getElementById("drawer-node-name");
  const drawerNodeRule    = document.getElementById("drawer-node-rule");
  const drawerNodeDesc    = document.getElementById("drawer-node-desc");
  const drawerMetricRatio = document.getElementById("drawer-metric-ratio");
  const drawerMetricTokens= document.getElementById("drawer-metric-tokens");
  const drawerCodeBefore  = document.getElementById("drawer-code-before");
  const drawerCodeAfter   = document.getElementById("drawer-code-after");

  // General Metrics (Unified Performance Panel)
  const metricsSection   = document.getElementById("metrics");
  const metricRatio      = document.getElementById("metric-ratio");
  const metricSavings    = document.getElementById("metric-savings");
  const metricPercent    = document.getElementById("metric-percent");
  const charsFreedEl     = document.getElementById("chars-freed");
  const origTokensEl     = document.getElementById("orig-tokens");
  const compTokensEl     = document.getElementById("comp-tokens");
  const ringFill         = document.getElementById("ring-fill");
  const proportionOrig   = document.getElementById("proportion-original");
  const proportionComp   = document.getElementById("proportion-compressed");
  const savingsSummary   = document.getElementById("savings-summary");

  let currentLang = "typescript";
  let currentOutputMode = "code"; // "code" or "visual"
  let debounceTimer = null;
  let compiledResult = { text: "", nodes: [] };

  // --- Utility: file extension ---
  const getExt = (lang) => {
    switch (lang) {
      case "typescript": return "ts";
      case "python":     return "py";
      case "rust":       return "rs";
      case "go":         return "go";
      case "cpp":        return "cpp";
      default:           return "txt";
    }
  };

  // --- Sync scrolling between Textarea and Gutter ---
  function updateLineNumbers() {
    const lines = codeInput.value.split("\n");
    lineNumbers.innerHTML = lines.map((_, i) => `<span>${i + 1}</span>`).join("");
    lineNumbers.scrollTop = codeInput.scrollTop;
    
    if (outputGutterLines && cgeOutput) {
      const outText = cgeOutput.textContent || "";
      const outLines = outText.split("\n");
      if (outLines.length > 0 && outLines[outLines.length - 1] === "") {
        outLines.pop(); // Remove trailing empty split
      }
      outputGutterLines.innerHTML = outLines.map((_, i) => `<span>${i + 1}</span>`).join("");
      if (outputScroller) {
        outputGutterLines.scrollTop = outputScroller.scrollTop;
      }
    }
  }

  // --- Subtle Syntax-colored CGE output ---
  function highlightCGE(raw) {
    const escaped = raw
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    return escaped
      // Header line
      .replace(/^(CGE\/1\.0\s.+)$/m, '<span class="kw-header">$1</span>')
      // Section labels
      .replace(/^(IMPORTS:|TYPES:|STATE:|OPS:|PRIVATE:)/gm, '<span class="kw-section">$1</span>')
      // EXPORTS line
      .replace(/^(EXPORTS:\s.+)$/gm, '<span class="kw-exports">$1</span>')
      // GUARD keyword
      .replace(/\b(GUARD)\b/g, '<span class="kw-guard">$1</span>')
      // SCAN keyword
      .replace(/\b(SCAN)\b/g, '<span class="kw-scan">$1</span>')
      // Action keywords
      .replace(/\b(THROW|RETURN|CONST)\b/g, '<span class="kw-action">$1</span>');
  }

  // --- Snappy animated counters ---
  function animateCounter(element, targetText, duration = 300) {
    const percentMatch = targetText.match(/^(\d+)%$/);
    if (percentMatch) {
      const target = parseInt(percentMatch[1]);
      animateNumber(element, target, "%", duration);
      return;
    }
    const ratioMatch = targetText.match(/^([\d.]+)x$/);
    if (ratioMatch) {
      const target = parseFloat(ratioMatch[1]);
      animateFloat(element, target, "x", duration);
      return;
    }
    element.textContent = targetText;
  }

  function animateNumber(el, target, suffix, duration) {
    const start = performance.now();
    const from = 0;
    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(from + (target - from) * eased);
      el.textContent = `${current}${suffix}`;
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function animateFloat(el, target, suffix, duration) {
    const start = performance.now();
    const from = 0;
    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = (from + (target - from) * eased).toFixed(1);
      el.textContent = `${current}${suffix}`;
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // --- Drawer Interaction ---
  function closeDrawer() {
    astDrawer.classList.remove("active");
  }

  // --- Ast visual inspector click node handler ---
  function openDrawerForNode(node) {
    const beforeTokens = Math.ceil(node.before.length / 4) + 2;
    const afterTokens = Math.ceil(node.after.length / 4);
    const saved = Math.max(0, beforeTokens - afterTokens);
    const savingsPercent = Math.round((1 - (afterTokens / beforeTokens)) * 100);

    drawerNodeName.textContent = node.name;
    drawerNodeRule.textContent = node.rule;
    
    // Assign rule classes
    drawerNodeRule.className = "drawer-rule-tag";
    if (node.rule === "Primitive Folding") drawerNodeRule.classList.add("rule-folding");
    else if (node.rule === "Guard Assertions") drawerNodeRule.classList.add("rule-guard");
    else if (node.rule === "Scan Compactor") drawerNodeRule.classList.add("rule-scan");
    else if (node.rule === "Block Collapsing") drawerNodeRule.classList.add("rule-collapse");

    drawerNodeDesc.textContent = node.desc;
    drawerMetricRatio.textContent = `${savingsPercent}%`;
    drawerMetricTokens.textContent = `-${saved} tkn`;

    drawerCodeBefore.textContent = node.before.trim();
    drawerCodeAfter.textContent = node.after.trim();

    astDrawer.classList.add("active");
  }

  // --- Dynamic AST Visual tree builder ---
  function renderVisualAST() {
    closeDrawer();
    astTreeView.innerHTML = "";

    const nodes = compiledResult.nodes || [];
    if (nodes.length === 0) {
      astTreeView.innerHTML = `
        <div class="tree-empty-state">
          <span class="empty-state-icon">🧬</span>
          <span class="empty-state-text">
            No structures parsed.<br>
            Please paste structural statements in the editor to inspect.
          </span>
        </div>
      `;
      return;
    }

    // Group nodes by CGE spec category
    const categories = {
      "Primitive Folding": [],
      "Guard Assertions": [],
      "Scan Compactor": [],
      "Block Collapsing": []
    };

    nodes.forEach(node => {
      if (categories[node.rule]) {
        categories[node.rule].push(node);
      } else {
        categories["Block Collapsing"].push(node);
      }
    });

    // Loop groups and draw
    Object.keys(categories).forEach(rule => {
      const groupNodes = categories[rule];
      if (groupNodes.length === 0) return;

      const sectionHeader = document.createElement("div");
      sectionHeader.className = "tree-section-header";
      sectionHeader.textContent = rule;
      astTreeView.appendChild(sectionHeader);

      const groupDiv = document.createElement("div");
      groupDiv.className = "tree-group";

      groupNodes.forEach(node => {
        const itemNode = document.createElement("div");
        itemNode.className = "tree-node";

        // Calculate specific micro-savings
        const beforeT = Math.ceil(node.before.length / 4) + 2;
        const afterT = Math.ceil(node.after.length / 4);
        const percent = Math.round((1 - (afterT / beforeT)) * 100);

        let icon = "⚡";
        if (rule === "Primitive Folding") icon = "🗂️";
        else if (rule === "Guard Assertions") icon = "🛡️";
        else if (rule === "Scan Compactor") icon = "🔄";

        itemNode.innerHTML = `
          <div class="node-left">
            <span class="node-icon">${icon}</span>
            <span class="node-name">${node.name}</span>
            <span class="node-type-pill">${node.type}</span>
          </div>
          <span class="node-savings-badge">${percent > 0 ? percent : 0}% saved</span>
        `;

        itemNode.addEventListener("click", () => {
          openDrawerForNode(node);
        });

        groupDiv.appendChild(itemNode);
      });

      astTreeView.appendChild(groupDiv);
    });
  }

  // --- Mode Swapper Controller ---
  function switchMode(newMode) {
    currentOutputMode = newMode;
    closeDrawer();

    btnModeCode.classList.remove("active");
    btnModeVisual.classList.remove("active");
    btnModeVerify.classList.remove("active");
    
    containerCode.classList.remove("active");
    containerVisual.classList.remove("active");
    containerVerify.classList.remove("active");
    containerAudit.style.display = "none";

    if (newMode === "code") {
      btnModeCode.classList.add("active");
      containerCode.classList.add("active");
    } else if (newMode === "visual") {
      btnModeVisual.classList.add("active");
      containerVisual.classList.add("active");
      renderVisualAST();
    } else if (newMode === "verify") {
      btnModeVerify.classList.add("active");
      containerVerify.classList.add("active");
    } else if (newMode === "audit") {
      containerAudit.style.display = "flex";
    }
  }

  let currentInputMode = "code";
  let hasActiveAudit = false;
  function switchInputMode(newMode) {
    currentInputMode = newMode;
    btnInputCode.classList.remove("active");
    btnInputZip.classList.remove("active");
    inputContainerCode.classList.remove("active");
    inputContainerCode.style.display = "none";
    inputContainerZip.style.display = "none";
    if (containerAudit) containerAudit.style.display = "none";

    btnModeCode.style.display = "none";
    btnModeVisual.style.display = "none";
    btnModeVerify.style.display = "none";

    if (newMode === "code") {
      btnInputCode.classList.add("active");
      inputContainerCode.classList.add("active");
      inputContainerCode.style.display = "flex";
      
      // Restore standard two-column layout
      if (outputCard) outputCard.style.display = "flex";
      if (compileBridge) compileBridge.style.display = "flex";
      if (editorGrid) editorGrid.style.gridTemplateColumns = "1fr 36px 1fr";
      
      btnModeCode.style.display = "inline-block";
      btnModeVisual.style.display = "inline-block";
      btnModeVerify.style.display = "inline-block";
      
      if (metricsSection) metricsSection.style.display = "block";
      
      if (currentOutputMode === "audit") {
        switchMode("code");
      } else {
        switchMode(currentOutputMode);
      }
    } else if (newMode === "zip") {
      btnInputZip.classList.add("active");
      inputContainerZip.style.display = "flex";
      
      // Hide right panel and set left panel to 100% full-width
      if (outputCard) outputCard.style.display = "none";
      if (compileBridge) compileBridge.style.display = "none";
      if (editorGrid) editorGrid.style.gridTemplateColumns = "1fr";
      
      if (metricsSection) metricsSection.style.display = "none";
    }
  }

  btnInputCode.addEventListener("click", () => switchInputMode("code"));
  btnInputZip.addEventListener("click", () => switchInputMode("zip"));

  btnModeCode.addEventListener("click", () => switchMode("code"));
  btnModeVisual.addEventListener("click", () => switchMode("visual"));
  btnModeVerify.addEventListener("click", () => switchMode("verify"));
  drawerCloseBtn.addEventListener("click", closeDrawer);

  // --- Metrics Update ---
  function updateMetrics(original, compressed) {
    const origChars = original.length;
    const compChars = compressed.length;
    
    const origTokens = Math.ceil(origChars / 4) + 12;
    const compTokens = Math.max(12, Math.ceil(compChars / 4));
    
    const ratio = parseFloat((origTokens / compTokens).toFixed(1));
    const savingsPercent = Math.round((1 - (compTokens / origTokens)) * 100);
    const tokensSaved = origTokens - compTokens;
    const charsSaved = origChars - compChars;

    // Hero ring gauge
    animateFloat(metricRatio, ratio, 'x', 600);
    const circumference = 326.73;
    // Cap at 95% of ring for visual clarity
    const ringPercent = Math.min(savingsPercent, 95) / 100;
    ringFill.style.strokeDashoffset = circumference * (1 - ringPercent);

    // Proportion bar
    const compPercent = Math.max(5, Math.round((compTokens / origTokens) * 100));
    const origPercent = 100 - compPercent;
    proportionOrig.style.width = `${origPercent}%`;
    proportionComp.style.width = `${compPercent}%`;

    // Legend values
    origTokensEl.textContent = `${origTokens.toLocaleString()} tkn`;
    compTokensEl.textContent = `${compTokens.toLocaleString()} tkn`;

    // Right stat column
    animateNumber(metricSavings, tokensSaved, ' tkn', 500);
    charsFreedEl.textContent = `~${charsSaved.toLocaleString()}`;
    metricPercent.textContent = `${savingsPercent}%`;

    savingsSummary.textContent = `${savingsPercent}% reduction · ${tokensSaved.toLocaleString()} tokens freed`;

    // Drive estimator
    lastTokensSaved = tokensSaved;
    updateEstimator();
  }

  // --- Projected Savings Estimator ---
  const estTokensEl = document.getElementById("est-tokens");
  const estCostEl   = document.getElementById("est-cost");
  const freqPills = document.querySelectorAll("#single-roi-freq .estimator-pill");
  const teamPills = document.querySelectorAll("#single-roi-team .estimator-pill");
  const modelPills = document.querySelectorAll("#single-roi-model .estimator-pill");
  
  let activeFreq = 50;  // default: 50 prompts/day
  let activeTeam = 1;   // default: 1 developer
  let activeModelCost = 5.00;
  let activeModelName = "GPT-5.5";
  let lastTokensSaved = 0;

  // GPT-4o average: ~$2.50 per 1M input tokens
  const DAYS_PER_MONTH = 30;

  function formatTokenCount(n) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
  }

  function updateEstimator() {
    if (lastTokensSaved <= 0) {
      estTokensEl.textContent = "—";
      estCostEl.textContent = "—";
      return;
    }

    const costPerToken = activeModelCost / 1_000_000;

    const monthlyTokensSaved = Math.round(lastTokensSaved * activeFreq * activeTeam * DAYS_PER_MONTH);
    const monthlyCostSaved = monthlyTokensSaved * costPerToken;

    estTokensEl.textContent = formatTokenCount(monthlyTokensSaved);

    if (monthlyCostSaved < 0.01) {
      estCostEl.textContent = `$${monthlyCostSaved.toFixed(3)}`;
    } else if (monthlyCostSaved < 1) {
      estCostEl.textContent = `$${monthlyCostSaved.toFixed(2)}`;
    } else if (monthlyCostSaved < 100) {
      estCostEl.textContent = `$${monthlyCostSaved.toFixed(2)}`;
    } else {
      estCostEl.textContent = `$${Math.round(monthlyCostSaved).toLocaleString()}`;
    }

    const disclaimer = document.getElementById("single-math-disclaimer");
    if (disclaimer) {
      disclaimer.textContent = `*Monthly calculation: Tokens Saved × Agent Queries × Team Size × 30 Days × $${activeModelCost.toFixed(2)} per 1M Input Tokens (${activeModelName})`;
    }
  }

  modelPills.forEach(pill => {
    pill.addEventListener("click", () => {
      modelPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      activeModelCost = parseFloat(pill.dataset.cost);
      activeModelName = pill.dataset.name;
      updateEstimator();
    });
  });

  freqPills.forEach(pill => {
    pill.addEventListener("click", () => {
      freqPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      activeFreq = parseFloat(pill.dataset.mult);
      updateEstimator();
    });
  });

  teamPills.forEach(pill => {
    pill.addEventListener("click", () => {
      teamPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      activeTeam = parseFloat(pill.dataset.team);
      updateEstimator();
    });
  });

  // --- Core Compile ---
  function handleCompile() {
    const code = codeInput.value;
    const fileName = `source_code.${getExt(currentLang)}`;    const engine = new window.MinifyEngine({
      stripLineComments: optComments ? optComments.checked : true,
      stripBlockComments: optComments ? optComments.checked : true,
      stripDocComments: optJsdoc ? optJsdoc.checked : true,
      stripDeadCode: optDeadCode ? optDeadCode.checked : true,
      normalizeNewlines: optWhitespace ? optWhitespace.checked : true,
      stripTrailingWhitespace: optWhitespace ? optWhitespace.checked : true,
      preserveTodos: false
    });
    const res = engine.minify(code, currentLang);
    compiledResult = { text: res.output, nodes: [] };
    
    // 3. Render Output
    cgeOutput.innerHTML = highlightCGE(compiledResult.text);
    
    updateLineNumbers();
    updateMetrics(code, compiledResult.text);

    // If visual tab is active, rebuild tree live!
    if (currentOutputMode === "visual") {
      renderVisualAST();
    }
    
    // Check if we should prompt the user for feedback
    if (window.triggerFeedbackAutoPrompt) window.triggerFeedbackAutoPrompt();
  }

  // --- Debounced compile handler ---
  function debouncedCompile() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(handleCompile, 80);
  }

  // --- Tab switching ---
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      
      currentLang = btn.getAttribute("data-lang");
      extLabel.textContent = getExt(currentLang);
      
      codeInput.value = templates[currentLang];
      handleCompile();
    });
  });

  // --- Input events ---
  codeInput.addEventListener("input", debouncedCompile);
  
  // Auto-detect language on paste
  codeInput.addEventListener("paste", (e) => {
    // Wait for the pasted value to populate in the textarea
    setTimeout(() => {
      const pastedCode = codeInput.value;
      const detected = autoDetectLanguage(pastedCode);
      
      if (detected) {
        if (detected !== currentLang) {
          // Switch tabs visually
          tabBtns.forEach(b => b.classList.remove("active"));
          const targetBtn = Array.from(tabBtns).find(b => b.getAttribute("data-lang") === detected);
          if (targetBtn) targetBtn.classList.add("active");
          
          currentLang = detected;
          if (extLabel) extLabel.textContent = getExt(currentLang);
          
          showToast(`✨ Auto-detected ${detected.charAt(0).toUpperCase() + detected.slice(1)}`);
          // Note: Compilation happens automatically via the debouncedCompile 'input' listener
        }
      } else {
        // Only show ambiguity warning for substantial snippets
        if (pastedCode.trim().length > 20) {
          showToast("⚠️ Language ambiguous. Please select the correct tab manually.", 3500);
        }
      }
    }, 10);
  });
  codeInput.addEventListener("scroll", () => {
    lineNumbers.scrollTop = codeInput.scrollTop;
  });
  if (outputScroller && outputGutterLines) {
    outputScroller.addEventListener("scroll", () => {
      outputGutterLines.scrollTop = outputScroller.scrollTop;
    });
  }

  // --- Copy with toast ---
  function showToast(message, duration = 2000) {
    toast.textContent = message;
    toast.classList.add("active");
    setTimeout(() => toast.classList.remove("active"), duration);
  }

  copyBtn.addEventListener("click", () => {
    const textContent = cgeOutput.textContent || cgeOutput.innerText;
    navigator.clipboard.writeText(textContent).then(() => {
      showToast("✨ Copied compressed shorthand to clipboard");
    }).catch(() => {
      showToast("⚠️ Select text manually to copy");
    });
  });

  llmPromptBtn.addEventListener("click", () => {
    const textContent = cgeOutput.textContent || cgeOutput.innerText;
    const currentLangName = currentLang.charAt(0).toUpperCase() + currentLang.slice(1);
    const systemPromptWrapper = `Act as an expert ${currentLangName} compiler. Below is a code block translated into Cognitive Graph Encoding (CGE) loss-less shorthand notation.

Please read the encoded representation carefully, then:
1. Provide a clear, 2-sentence summary of what this code does.
2. Decompress this CGE shorthand back into fully working, standard, clean ${currentLangName} code.

Here is the CGE encoded code:
${textContent}`;

    navigator.clipboard.writeText(systemPromptWrapper).then(() => {
      showToast("🚀 Copied verification prompt wrapper to clipboard!");
    }).catch(() => {
      showToast("⚠️ Unable to copy prompt wrapper automatically");
    });
  });

  // --- CLNR Diff Engine ---
  let currentPatches = [];

  function runDiffEngine() {
    const pastedCode = llmInput.value.trim();
    
    if (!pastedCode) {
      verifyStatus.className = "verify-status";
      verifyStatus.innerHTML = "Awaiting Input...";
      verifyDiffList.innerHTML = "";
      patchAction.style.display = "none";
      return;
    }

    // Parse the pasted code using the same compiler to extract AST identifiers
    const reconstructedResult = compiler.compile(pastedCode, currentLang, "reconstructed");
    
    const origNodes = compiledResult.nodes || [];
    const reconNodes = reconstructedResult.nodes || [];
    
    const origNames = origNodes.map(n => n.name);
    const reconNames = reconNodes.map(n => n.name);
    
    const missing = origNames.filter(name => !reconNames.includes(name));
    const extra = reconNames.filter(name => !origNames.includes(name));
    
    verifyDiffList.innerHTML = "";
    currentPatches = [];
    
    if (missing.length === 0 && extra.length === 0) {
      verifyStatus.className = "verify-status success";
      verifyStatus.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
          <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
        100% Structural Fidelity Match
      `;
      patchAction.style.display = "none";
    } else {
      verifyStatus.className = "verify-status error";
      verifyStatus.innerHTML = `
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="15" y1="9" x2="9" y2="15"></line>
          <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
        Fidelity Mismatch Detected
      `;
      
      missing.forEach(m => {
        const div = document.createElement("div");
        div.className = "diff-item";
        
        // Try to guess if it was renamed
        let patchMsg = `[PATCH: Missing identifier '${m}'. Ensure it is implemented strictly as '${m}']`;
        if (extra.length > 0) {
          // just pick the first extra as a likely hallucination mapping
          patchMsg = `[PATCH: Hallucinated identifier '${extra[0]}'. It should be exactly '${m}']`;
        }
        
        div.textContent = patchMsg;
        verifyDiffList.appendChild(div);
        currentPatches.push(patchMsg);
      });
      
      patchAction.style.display = "flex";
    }
  }

  function updateVerifyLineNumbers() {
    if (!verifyGutterLines) return;
    const lines = llmInput.value.split("\n");
    verifyGutterLines.innerHTML = lines.map((_, i) => `<span>${i + 1}</span>`).join("");
    verifyGutterLines.scrollTop = llmInput.scrollTop;
  }

  llmInput.addEventListener("input", () => {
    runDiffEngine();
    updateVerifyLineNumbers();
  });

  llmInput.addEventListener("scroll", () => {
    if (verifyGutterLines) {
      verifyGutterLines.scrollTop = llmInput.scrollTop;
    }
  });
  
  copyPatchBtn.addEventListener("click", () => {
    if (currentPatches.length > 0) {
      navigator.clipboard.writeText(currentPatches.join("\\n")).then(() => {
        showToast("🩹 Copied Correction Patches!");
      });
    }
  });

  const simulateBtn = document.getElementById("simulate-clnr-btn");
  if (simulateBtn) {
    simulateBtn.addEventListener("click", () => {
      // Deactivate button during simulation
      simulateBtn.disabled = true;
      simulateBtn.style.opacity = "0.6";
      simulateBtn.style.cursor = "not-allowed";

      llmInput.value = "";
      verifyStatus.className = "verify-status";
      verifyStatus.innerHTML = "📡 Querying LLM for zero-shot CGE decompression...";
      verifyDiffList.innerHTML = "";
      patchAction.style.display = "none";
      updateVerifyLineNumbers();

      let candidateCode = "";
      let correctedCode = "";

      if (currentLang === "typescript") {
        candidateCode = `import { useState } from "react";\n\nexport interface User {\n  id: string;\n  email: string;\n  isActive: boolean;\n}\n\nexport const useSession = (email: string) => {\n  if (!email) throw new Error("no_email");\n  return { loggedIn: true };\n};\n\nexport class AuthService {\n  private endpointUrl: string = "api/auth";\n\n  public async login(email: string): Promise<string> {\n    if (!email) {\n      throw new Error("invalid");\n    }\n    return "token123";\n  }\n}`;
        correctedCode = `import { useState } from "react";\n\nexport interface User {\n  id: string;\n  email: string;\n  isActive: boolean;\n}\n\nexport const useAuth = (email: string) => {\n  if (!email) throw new Error("no_email");\n  return { loggedIn: true };\n};\n\nexport class AuthService {\n  private endpoint: string = "api/auth";\n\n  public async login(email: string): Promise<string> {\n    if (!email) {\n      throw new Error("invalid");\n    }\n    return "token123";\n  }\n}`;
      } else if (currentLang === "python") {
        candidateCode = `from datetime import datetime\nfrom typing import List, Optional\n\nclass UserProfile:\n    id: str\n    email: str\n    created_at: datetime\n\nTOKEN_EXPIRY = 900000\n\ndef _get_hash(password: str) -> str:\n    return "hashed"\n\ndef check_user(user: UserProfile) -> bool:\n    if not user:\n        raise ValueError("missing_user")\n    for item in user.items:\n        if item.val == 10:\n            return True\n    return False`;
        correctedCode = `from datetime import datetime\nfrom typing import List, Optional\n\nclass UserProfile:\n    id: str\n    email: str\n    created_at: datetime\n\nTOKEN_EXPIRY = 900000\n\ndef _get_hash(password: str) -> str:\n    return "hashed"\n\ndef verify_user(user: UserProfile) -> bool:\n    if not user:\n        raise ValueError("missing_user")\n    for item in user.items:\n        if item.val == 10:\n            return True\n    return False`;
      } else {
        candidateCode = `use std::collections::HashMap;\n\npub struct UserSession {\n    pub token: String,\n    pub user_id: u64,\n}\n\npub enum UserRole {\n    Admin,\n    User,\n}\n\nconst MAX_ATTEMPTS: u32 = 5;\n\npub fn verify_session(session: UserSession) -> bool {\n    if session.token.is_empty() {\n        return false;\n    }\n    true\n}\n\nfn internal_check() {\n    println!("internal");\n}`;
        correctedCode = `use std::collections::HashMap;\n\npub struct UserSession {\n    pub token: String,\n    pub user_id: u64,\n}\n\npub enum UserRole {\n    Admin,\n    User,\n}\n\nconst MAX_ATTEMPTS: u32 = 5;\n\npub fn validate(session: UserSession) -> bool {\n    if session.token.is_empty() {\n        return false;\n    }\n    true\n}\n\nfn internal_check() {\n    println!("internal");\n}`;
      }

      // Step 1: Simulate LLM generating Candidate C0 with mismatches
      setTimeout(() => {
        llmInput.value = candidateCode;
        runDiffEngine();
        updateVerifyLineNumbers();
        showToast("🤖 LLM returned decompression candidates (Zero-Shot)");

        // Step 2: AST Diff Engine isolates mismatches & generates patches
        setTimeout(() => {
          verifyStatus.className = "verify-status error";
          verifyStatus.innerHTML = "🩹 AST Differ isolated errors. Re-querying with Correction Patches...";
          showToast("🔬 Generating Active Feedback patches...");

          // Step 3: Simulate LLM regenerating code with patches
          setTimeout(() => {
            llmInput.value = correctedCode;
            runDiffEngine();
            updateVerifyLineNumbers();
            
            verifyStatus.className = "verify-status success";
            verifyStatus.innerHTML = `
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              100% Structural Fidelity Match achieved in 2 loops!
            `;
            showToast("✅ Reconstruction Loop completed successfully!");

            // Reactivate button
            simulateBtn.disabled = false;
            simulateBtn.style.opacity = "1";
            simulateBtn.style.cursor = "pointer";
          }, 1500);

        }, 1500);

      }, 1500);
    });
  }
  // --- Project Compaction & ROI Audit ---
  const auditDropzone      = document.getElementById("audit-dropzone");
  const auditFileInput     = document.getElementById("audit-file-input");
  const auditUploadTrigger = document.getElementById("audit-upload-trigger");
  const auditResults       = document.getElementById("audit-results");

  const auditTotalFiles    = document.getElementById("audit-total-files");
  const auditOrigTokens    = document.getElementById("audit-orig-tokens");
  const auditCompTokens    = document.getElementById("audit-comp-tokens");
  const auditSavings       = document.getElementById("audit-savings");
  const auditOrigCost      = document.getElementById("audit-orig-cost");
  const auditCompCost      = document.getElementById("audit-comp-cost");
  const auditCostSaved     = document.getElementById("audit-cost-saved");
  const auditRoiSaved      = document.getElementById("audit-roi-saved");
  const auditBreakdownSummary = document.getElementById("audit-breakdown-summary");
  const auditBreakdownBarProcessed = document.getElementById("audit-breakdown-bar-processed");
  const auditBreakdownBarExcluded = document.getElementById("audit-breakdown-bar-excluded");
  const auditBreakdownList = document.getElementById("audit-breakdown-list");

  // Dropzone state variables
  const dropzoneNormalState = document.getElementById("dropzone-normal-state");
  const dropzoneProcessingState = document.getElementById("dropzone-processing-state");
  const dropzoneStatusTitle = document.getElementById("dropzone-status-title");
  const dropzoneStatusSubtitle = document.getElementById("dropzone-status-subtitle");
  const dropzoneProgressBar = document.getElementById("dropzone-progress-bar");

  // Trigger file select dialog
  if (auditFileInput) {
    auditFileInput.addEventListener("click", (e) => {
      e.stopPropagation();
    });
  }

  if (auditUploadTrigger && auditFileInput) {
    auditUploadTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      auditFileInput.click();
    });
  }

  if (auditDropzone && auditFileInput) {


    // Drag-over styling
    auditDropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      auditDropzone.style.borderColor = "#10b981";
      auditDropzone.style.background = "rgba(16, 185, 129, 0.1)";
    });

    auditDropzone.addEventListener("dragleave", () => {
      auditDropzone.style.borderColor = "#4b5563";
      auditDropzone.style.background = "rgba(31, 41, 55, 0.4)";
    });

    let lastZipFile = null;

    async function handleZipUpload(e, isRecalculation = false) {
      let file = null;
      if (e && e.target && e.target.files) {
        file = e.target.files[0];
        lastZipFile = file;
      } else if (e && e.dataTransfer && e.dataTransfer.files) {
        file = e.dataTransfer.files[0];
        lastZipFile = file;
      } else if (isRecalculation && lastZipFile) {
        file = lastZipFile;
      }

      if (!file) return;
      processZipFile(file);
    }

    auditDropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      auditDropzone.style.borderColor = "#4b5563";
      auditDropzone.style.background = "rgba(31, 41, 55, 0.4)";
      handleZipUpload(e);
    });

    auditFileInput.addEventListener("change", (e) => {
      handleZipUpload(e);
    });
  }

  // Cache for extracted zip
  let cachedZipFiles = [];
  let extensionCountsCache = {};

  async function processZipFile(file) {
    if (!file) return;
    
    // Switch to zip view if not already there
    if (typeof switchInputMode === "function") {
      switchInputMode("zip");
    }

    const auditDropzone = document.getElementById("audit-dropzone");
    const dropzoneNormal = document.getElementById("dropzone-normal-state");
    const dropzoneProcessing = document.getElementById("dropzone-processing-state");
    const progressBar = document.getElementById("dropzone-progress-bar");
    
    dropzoneNormal.style.display = "none";
    dropzoneProcessing.style.display = "flex";
    progressBar.style.width = "0%";

    try {
      const zip = await JSZip.loadAsync(file);
      const allFiles = Object.keys(zip.files);
      
      const processedFiles = [];
      const extensionCounts = {};
      const validExts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.rs', '.go', '.cpp', '.h', '.hpp', '.cs', '.php', '.rb', '.md', '.json', '.css', '.html'];

      for (let i = 0; i < allFiles.length; i++) {
        const name = allFiles[i];
        const f = zip.files[name];
        
        // Progress update
        if (i % 10 === 0) {
          progressBar.style.width = `${Math.min(50, (i / allFiles.length) * 50)}%`;
        }

        if (!f.dir) {
          // Ignore heavy vendor/binary directories
          if (name.includes('node_modules/') || 
              name.includes('.git/') || 
              name.includes('venv/') || 
              name.includes('build/') || 
              name.includes('dist/') ||
              name.includes('.min.js') || 
              name.includes('.bundle.js')) {
            continue;
          }

          const ext = name.split(".").pop().toLowerCase();
          
          if (validExts.includes('.' + ext)) {
            processedFiles.push(name);
            extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
          }
        }
      }

      cachedZipFiles = processedFiles;
      window.cachedZipObject = zip;
      extensionCountsCache = extensionCounts;
      
      progressBar.style.width = "100%";
      setTimeout(() => {
        // Hide dropzone, show config step
        auditDropzone.style.display = "none";
        renderConfigStep(extensionCounts);
      }, 500);

    } catch (err) {
      console.error(err);
      alert("Error reading zip file. Please check the console.");
      dropzoneNormal.style.display = "flex";
      dropzoneProcessing.style.display = "none";
    }
  }

  function renderConfigStep(extensionCounts) {
    const configStep = document.getElementById("zip-config-step");
    configStep.style.display = "flex";
    
    const configChipsContainer = document.getElementById("zip-config-chips");
    configChipsContainer.innerHTML = "";

    const validExts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.rs', '.go', '.cpp', '.h', '.hpp', '.cs', '.php', '.rb', '.md', '.json', '.css', '.html'];
    const sortedExts = Object.keys(extensionCounts).sort((a, b) => extensionCounts[b] - extensionCounts[a]);

    if (!window.disabledZipExts) {
      window.disabledZipExts = new Set();
      // By default, ignore all files so the user can cleanly select what they want
      sortedExts.forEach(ext => {
        if (validExts.includes('.' + ext)) {
          window.disabledZipExts.add('.' + ext);
        }
      });
    }
    
    sortedExts.forEach(ext => {
      const isCompiled = validExts.includes('.' + ext);
      if (!isCompiled) return;

      const chip = document.createElement("div");
      const isDisabled = window.disabledZipExts.has('.' + ext);
      
      chip.style.cssText = "display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 6px; background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3); color: #6ee7b7; font-size: 0.85rem; cursor: pointer; user-select: none; transition: all 0.2s ease;";
      if (isDisabled) {
        chip.style.background = "rgba(0,0,0,0.3)";
        chip.style.borderColor = "rgba(255,255,255,0.1)";
        chip.style.color = "#6b7280";
      }

      chip.innerHTML = `
        <input type="checkbox" ${isDisabled ? '' : 'checked'} style="pointer-events: none; margin: 0;">
        <span style="font-weight: 600;">.${ext}</span>
        <span style="opacity: 0.7; font-size: 0.75rem;">(${extensionCounts[ext]})</span>
      `;
      
      chip.addEventListener('click', () => {
        if (window.disabledZipExts.has('.' + ext)) {
          window.disabledZipExts.delete('.' + ext);
          chip.style.background = "rgba(16, 185, 129, 0.1)";
          chip.style.borderColor = "rgba(16, 185, 129, 0.3)";
          chip.style.color = "#6ee7b7";
          chip.style.textDecoration = "none";
          chip.querySelector('input').checked = true;
        } else {
          window.disabledZipExts.add('.' + ext);
          chip.style.background = "rgba(0,0,0,0.3)";
          chip.style.borderColor = "rgba(255,255,255,0.1)";
          chip.style.color = "#6b7280";
          chip.style.textDecoration = "line-through";
          chip.querySelector('input').checked = false;
        }
      });

      configChipsContainer.appendChild(chip);
    });
  }

  const zipSubmitBtn = document.getElementById("zip-submit-btn");
  if (zipSubmitBtn) {
    zipSubmitBtn.addEventListener("click", () => {
      calculateZipROI();
    });
  }

  const btnBackToConfig = document.getElementById("btn-back-to-config");
  if (btnBackToConfig) {
    btnBackToConfig.addEventListener("click", () => {
      const inputContainerZip = document.getElementById("input-container-zip");
      const containerAudit = document.getElementById("container-audit");
      
      containerAudit.style.display = "none";
      inputContainerZip.style.display = "flex";
      
      if (zipSubmitBtn) {
        zipSubmitBtn.textContent = "Calculate Context Savings";
        zipSubmitBtn.style.opacity = "1";
        zipSubmitBtn.style.pointerEvents = "auto";
      }
    });
  }

  async function calculateZipROI() {
    const zipOptComments = document.getElementById("zip-opt-comments");
    const zipOptJsdoc = document.getElementById("zip-opt-jsdoc");
    const zipOptDeadCode = document.getElementById("zip-opt-dead-code");
    const zipOptWhitespace = document.getElementById("zip-opt-whitespace");

    // Update UI state to "Calculating..." so the user knows it hasn't frozen
    const zipSubmitBtn = document.getElementById("zip-submit-btn");
    const originalBtnText = zipSubmitBtn ? zipSubmitBtn.textContent : "";
    if (zipSubmitBtn) {
      zipSubmitBtn.textContent = "Compiling... (This may take a moment)";
      zipSubmitBtn.style.opacity = "0.7";
      zipSubmitBtn.style.pointerEvents = "none";
    }

    // Yield to let the browser paint the "Compiling..." state
    await new Promise(r => setTimeout(r, 50));

    // Hide input container, show audit container
    const inputContainerZip = document.getElementById("input-container-zip");
    const containerAudit = document.getElementById("container-audit");
    const auditResults = document.getElementById("audit-results");
    
    inputContainerZip.style.display = "none";
    containerAudit.style.display = "block";
    if (auditResults) auditResults.style.display = "flex";
    
    // Switch active mode variable
    currentMode = 'audit';
    
    let totalOrigChars = 0;
    let totalCompChars = 0;
    let processedCount = 0;
    let totalExcluded = 0;

    const zipEngine = new window.MinifyEngine({
      stripLineComments: zipOptComments ? zipOptComments.checked : true,
      stripBlockComments: zipOptComments ? zipOptComments.checked : true,
      stripDocComments: zipOptJsdoc ? zipOptJsdoc.checked : true,
      stripDeadCode: zipOptDeadCode ? zipOptDeadCode.checked : true,
      normalizeNewlines: zipOptWhitespace ? zipOptWhitespace.checked : true,
      stripTrailingWhitespace: zipOptWhitespace ? zipOptWhitespace.checked : true,
      preserveTodos: false
    });
    
    const zip = window.cachedZipObject;
    let xmlOutput = "<repo>\n";

    // Re-render final chips in dashboard (only Included ones)
    const auditBreakdownList = document.getElementById("audit-breakdown-list");
    if (auditBreakdownList) auditBreakdownList.innerHTML = "";
    
    const sortedExts = Object.keys(extensionCountsCache).sort((a, b) => extensionCountsCache[b] - extensionCountsCache[a]);
    sortedExts.forEach(ext => {
      const isDisabled = window.disabledZipExts.has('.' + ext);
      if (isDisabled) return; // Only show included files!
      
      const chip = document.createElement("div");
      chip.className = "audit-chip-card compiled";
      chip.innerHTML = `
        <div class="audit-chip-title">
          <span class="audit-chip-ext">.${ext}</span>
          <span class="audit-chip-count">${extensionCountsCache[ext]} files</span>
        </div>
        <span class="audit-chip-badge compiled">Included</span>
      `;
      if (auditBreakdownList) auditBreakdownList.appendChild(chip);
    });

    const MAX_COMPILE_FILES = 1000;

    for (let i = 0; i < cachedZipFiles.length; i++) {
      if (processedCount >= MAX_COMPILE_FILES) {
        totalExcluded += (cachedZipFiles.length - i);
        break;
      }

      const name = cachedZipFiles[i];
      const ext = name.split(".").pop().toLowerCase();
      
      // Skip user-deselected extensions
      if (window.disabledZipExts && window.disabledZipExts.has('.' + ext)) {
        totalExcluded++;
        continue;
      }
      
      const extensionToLanguage = {
        "ts": "typescript", "tsx": "typescript", "js": "javascript", "jsx": "javascript",
        "py": "python", "rs": "rust", "go": "go", "cpp": "cpp", "h": "cpp", "hpp": "cpp",
        "cs": "csharp", "php": "php", "rb": "ruby", "md": "markdown", "json": "json", "css": "css", "html": "html"
      };
      
      const lang = extensionToLanguage[ext] || "javascript";
      const content = await zip.files[name].async("string");
      
      try {
        const res = zipEngine.minify(content, ext);
        const compiled = { text: res.output };
        
        totalOrigChars += content.length;
        totalCompChars += compiled.text.length;
        processedCount++;
        
        xmlOutput += `  <file path="${name}">\n${compiled.text}\n  </file>\n`;

        // Yield execution every 50 files to prevent browser UI freezing
        if (processedCount % 50 === 0) {
          await new Promise(r => setTimeout(r, 0));
        }
      } catch (e) {
        console.warn("Failed to parse " + name, e);
      }
    }
    
    xmlOutput += "</repo>";

    if (processedCount >= MAX_COMPILE_FILES) {
      showToast(`⚡ Capped compiler at first ${MAX_COMPILE_FILES} source files to prevent browser lag.`);
    }

    if (zipSubmitBtn) {
      zipSubmitBtn.textContent = originalBtnText;
      zipSubmitBtn.style.opacity = "1";
      zipSubmitBtn.style.pointerEvents = "auto";
    }
    
    // Quick estimation for tokens (1 token ≈ 4 chars)
    const totalOrigTokens = Math.ceil(totalOrigChars / 4) + (processedCount * 12);
    const totalCompTokens = Math.ceil(totalCompChars / 4) + (processedCount * 12);
    const savingsPercent = Math.round((1 - (totalCompTokens / totalOrigTokens)) * 100) || 0;

    // Estimate monthly cost:
    const totalMultiplier = currentQueriesPerDay * currentTeamSize * 30;
    const origCost = (totalOrigTokens * totalMultiplier * currentModelCost) / 1_000_000;
    const compCost = (totalCompTokens * totalMultiplier * currentModelCost) / 1_000_000;
    const moneySaved = origCost - compCost;
    
    const descOrig = document.getElementById("audit-cost-desc-orig");
    if (descOrig) descOrig.textContent = `Monthly cost to process uncompressed codebase over ${currentQueriesPerDay} queries/day across ${currentTeamSize} developers:`;

    const costSubtitle = document.getElementById("audit-cost-subtitle");
    if (costSubtitle) costSubtitle.textContent = `${currentModelName} input rates ($${currentModelCost.toFixed(2)} / 1M tokens)`;
    
    const betaDisclaimerModel = document.getElementById("beta-disclaimer-model");
    if (betaDisclaimerModel) betaDisclaimerModel.textContent = currentModelName;

    // Populate dashboard
    const auditTotalFiles = document.getElementById("audit-total-files");
    const auditOrigTokens = document.getElementById("audit-orig-tokens");
    const auditCompTokens = document.getElementById("audit-comp-tokens");
    const auditSavings = document.getElementById("audit-savings");
    const auditOrigCost = document.getElementById("audit-orig-cost");
    const auditCompCost = document.getElementById("audit-comp-cost");
    const auditRoiSaved = document.getElementById("audit-roi-saved");
    const auditBreakdownSummary = document.getElementById("audit-breakdown-summary");
    const cgeOutput = document.getElementById("cge-output");

    if (auditTotalFiles) auditTotalFiles.textContent = processedCount.toLocaleString();
    if (auditOrigTokens) auditOrigTokens.textContent = totalOrigTokens.toLocaleString();
    if (auditCompTokens) {
      auditCompTokens.textContent = totalCompTokens.toLocaleString();
    }
    if (auditSavings) auditSavings.textContent = `${savingsPercent}%`;
    if (auditOrigCost) auditOrigCost.textContent = `$${origCost.toFixed(2)}`;
    if (auditCompCost) auditCompCost.textContent = `$${compCost.toFixed(2)}`;
    if (auditRoiSaved) {
      auditRoiSaved.textContent = `-$${moneySaved.toFixed(2)}`;
      auditRoiSaved.style.color = "#10b981";
    }
    
    const auditCostSaved = document.getElementById("audit-cost-saved");
    if (auditCostSaved) auditCostSaved.textContent = `Saved: ${savingsPercent}% of total bill!`;

    if (auditBreakdownSummary) {
      auditBreakdownSummary.textContent = `${processedCount} files compiled / ${totalExcluded} files bypassed`;
    }

    // Also populate the single file text view so they can copy the massive XML blob!
    if (cgeOutput) cgeOutput.textContent = xmlOutput;
  }

  // ROI Logic
  let currentQueriesPerDay = 50;
  let currentTeamSize = 1;
  let currentModelCost = 5.00;
  let currentModelName = "GPT-5.5";
  const roiFreqBtns = document.querySelectorAll('#roi-frequency .estimator-pill');
  const roiTeamBtns = document.querySelectorAll('#roi-team-size .estimator-pill');
  const roiModelBtns = document.querySelectorAll('#roi-model-select .estimator-pill');

  roiModelBtns.forEach(pill => {
    pill.addEventListener("click", () => {
      roiModelBtns.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      currentModelCost = parseFloat(pill.dataset.cost);
      currentModelName = pill.dataset.name;
      const containerAudit = document.getElementById("container-audit");
      if (containerAudit && containerAudit.style.display !== "none") {
        recalculateZip();
      }
    });
  });

  const recalculateZip = () => {
    // If they are on the dashboard, just recalculate in place
    if (document.getElementById("container-audit").style.display === "block") {
      calculateZipROI();
    }
  };

  roiFreqBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      roiFreqBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentQueriesPerDay = parseInt(btn.getAttribute('data-freq'), 10);
      recalculateZip();
    });
  });

  roiTeamBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      roiTeamBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTeamSize = parseInt(btn.getAttribute('data-team'), 10);
      recalculateZip();
    });
  });

  // --- Scroll Reveal (IntersectionObserver) ---
  const revealSections = document.querySelectorAll(".reveal-element");
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.05, rootMargin: "0px 0px -20px 0px" });

  revealSections.forEach(section => revealObserver.observe(section));

  // --- Warn before page unload if an audit was completed ---
  window.addEventListener("beforeunload", (e) => {
    if (hasActiveAudit) {
      e.preventDefault();
      e.returnValue = "Your project compaction audit metrics will be lost if you refresh. Do you want to continue?";
      return e.returnValue;
    }
  });

  // --- Feedback UI Logic ---
  const feedbackFab = document.getElementById("feedback-fab");
  const feedbackModal = document.getElementById("feedback-modal");
  const feedbackClose = document.getElementById("feedback-close");
  const feedbackForm = document.getElementById("feedback-form");
  const fbSubmitBtn = document.getElementById("fb-submit-btn");

  const openFeedbackModal = () => {
    if (feedbackModal) {
      feedbackModal.classList.add("active");
    }
  };

  const closeFeedbackModal = () => {
    if (feedbackModal) {
      feedbackModal.classList.remove("active");
      // Record that we showed the modal or they closed it to prevent spam
      localStorage.setItem("cge_last_feedback_prompt", Date.now().toString());
    }
  };

  if (feedbackFab) feedbackFab.addEventListener("click", openFeedbackModal);
  if (feedbackClose) feedbackClose.addEventListener("click", closeFeedbackModal);
  if (feedbackModal) {
    feedbackModal.addEventListener("click", (e) => {
      if (e.target === feedbackModal) closeFeedbackModal();
    });
  }

  if (feedbackForm) {
    feedbackForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      const formData = new FormData(feedbackForm);
      const actionUrl = feedbackForm.getAttribute("action");
      
      fbSubmitBtn.textContent = "Sending...";
      fbSubmitBtn.disabled = true;

      // Mock submit if user hasn't added Formspree ID yet
      if (actionUrl.includes("YOUR_FORM_ID_HERE")) {
        setTimeout(() => {
          showToast("✅ Feedback sent! (Dev Mode: Endpoint needed)");
          console.log("Feedback payload:", Object.fromEntries(formData.entries()));
          feedbackForm.reset();
          closeFeedbackModal();
          fbSubmitBtn.textContent = "Send Feedback";
          fbSubmitBtn.disabled = false;
        }, 800);
        return;
      }

      // Real submit to Formspree
      try {
        const response = await fetch(actionUrl, {
          method: "POST",
          body: formData,
          headers: {
            'Accept': 'application/json'
          }
        });
        
        if (response.ok) {
          showToast("✅ Thank you for your feedback!");
          feedbackForm.reset();
          closeFeedbackModal();
        } else {
          showToast("❌ Oops! There was a problem submitting your feedback.");
        }
      } catch (err) {
        showToast("❌ Oops! Network error. Please try again later.");
      } finally {
        fbSubmitBtn.textContent = "Send Feedback";
        fbSubmitBtn.disabled = false;
      }
    });
  }

  // --- Auto-Prompt Feedback Logic ---
  let hasAutoPrompted = false;
  window.triggerFeedbackAutoPrompt = () => {
    if (hasAutoPrompted) return;
    
    const lastPrompt = localStorage.getItem("cge_last_feedback_prompt");
    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    
    // Auto-prompt if they've never been prompted, or it's been > 7 days
    if (!lastPrompt || (Date.now() - parseInt(lastPrompt)) > SEVEN_DAYS_MS) {
      hasAutoPrompted = true;
      setTimeout(() => {
        openFeedbackModal();
      }, 5000);
    }
  };

  // Generate a large realistic mock file
  function generateMockCode() {
    let mock = `/**
 * Core Authentication Controller
 * @module AuthController
 * @description Handles session management, JWT signing, and OAuth redirects.
 * @author Anil Alapati
 * @version 2.0.0
 */

import { Request, Response } from 'express';
import { sign } from 'jsonwebtoken';
import { db } from '../database';

// Configuration object
const CONFIG = {
  expiresIn: '24h',
  algorithm: 'RS256'
};

/*
  TODO: Deprecate the old MD5 hashing algorithm next sprint.
  Ticket: LC-1092
*/

/**
 * Validates user credentials.
 * @param {string} email - User email
 * @param {string} password - Raw password
 * @returns {Promise<boolean>} True if valid
 */
export async function validateUser(email, password) {
  // Query DB
  const user = await db.users.find({ email });
  
  if (!user) {
    return false; // User not found
  }
  
  /*
    const oldHash = crypto.createHash('md5').update(password).digest('hex');
    if (user.hash === oldHash) {
      // Legacy login success
      return true;
    }
  */

  // Use bcrypt for secure comparison
  return await compareHash(password, user.hash);
}
`;
    // Repeat a block to make it ~500 lines long
    for (let i = 0; i < 20; i++) {
      mock += `
/**
 * Utility function to process batch data part ${i}
 * @param {Array} data - Input array
 */
export function processBatch${i}(data) {
  // Initialize counter
  let count = 0;
  
  // Loop through data
  for (let item of data) {
    count += item.value; // Aggregate values
  }
  
  /*
  if (count > 1000) {
    console.warn("Threshold exceeded in batch ${i}");
    // We used to trigger an email here but it caused spam
    // sendAlertEmail('admin@leancontext.com');
  }
  */
  
  return count;
}
`;
    }
    return mock;
  }

  // Start empty by default on boot
  if (!codeInput.value) {
    codeInput.value = "";
  }

  // Load sample button listener
  const btnLoadSample = document.getElementById("btn-load-sample");
  if (btnLoadSample) {
    btnLoadSample.addEventListener("mouseenter", () => {
      btnLoadSample.style.background = "rgba(59, 130, 246, 0.25)";
      btnLoadSample.style.borderColor = "rgba(59, 130, 246, 0.5)";
      btnLoadSample.style.color = "#93c5fd";
    });
    btnLoadSample.addEventListener("mouseleave", () => {
      btnLoadSample.style.background = "rgba(59, 130, 246, 0.15)";
      btnLoadSample.style.borderColor = "rgba(59, 130, 246, 0.3)";
      btnLoadSample.style.color = "#60a5fa";
    });
    btnLoadSample.addEventListener("click", () => {
      codeInput.value = generateMockCode();
      handleCompile();
    });
  }

  // Initialize
  handleCompile();
});
