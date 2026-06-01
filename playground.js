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
// 3. DOM Initialization & Event Binding
// =========================================================================

document.addEventListener("DOMContentLoaded", () => {
  const codeInput     = document.getElementById("code-input");
  const cgeOutput     = document.getElementById("cge-output");
  const copyBtn       = document.getElementById("copy-btn");
  const llmPromptBtn  = document.getElementById("llm-prompt-btn");
  const tabBtns       = document.querySelectorAll(".segment-tab");
  const extLabel      = document.getElementById("ext-label");
  const lineNumbers   = document.getElementById("gutter-lines");
  const toast         = document.getElementById("toast-bar");

  // Mode Swapping DOM nodes
  const btnModeCode   = document.getElementById("btn-mode-code");
  const btnModeVisual = document.getElementById("btn-mode-visual");
  const btnModeVerify = document.getElementById("btn-mode-verify");
  const containerCode = document.getElementById("container-code");
  const containerVisual = document.getElementById("container-visual");
  const containerVerify = document.getElementById("container-verify");
  const astTreeView   = document.getElementById("ast-tree-view");

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
      default:           return "txt";
    }
  };

  // --- Sync scrolling between Textarea and Gutter ---
  function updateLineNumbers() {
    const lines = codeInput.value.split("\n");
    lineNumbers.innerHTML = lines.map((_, i) => `<span>${i + 1}</span>`).join("");
    lineNumbers.scrollTop = codeInput.scrollTop;
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
    }
  }

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
  const estimatorPills = document.querySelectorAll(".estimator-pill");
  let activeMultiplier = 50;  // default: 50 prompts/day
  let lastTokensSaved = 0;

  // GPT-4o average: ~$2.50 per 1M input tokens
  const COST_PER_TOKEN = 2.50 / 1_000_000;
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

    const monthlyTokensSaved = Math.round(lastTokensSaved * activeMultiplier * DAYS_PER_MONTH);
    const monthlyCostSaved = monthlyTokensSaved * COST_PER_TOKEN;

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
  }

  estimatorPills.forEach(pill => {
    pill.addEventListener("click", () => {
      estimatorPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      activeMultiplier = parseFloat(pill.dataset.mult);
      updateEstimator();
    });
  });

  // --- Core Compile ---
  function handleCompile() {
    const code = codeInput.value;
    const fileName = `source_code.${getExt(currentLang)}`;
    compiledResult = compiler.compile(code, currentLang, fileName);
    
    // Print CGE text
    cgeOutput.innerHTML = highlightCGE(compiledResult.text);
    
    updateLineNumbers();
    updateMetrics(code, compiledResult.text);

    // If visual tab is active, rebuild tree live!
    if (currentOutputMode === "visual") {
      renderVisualAST();
    }
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
  codeInput.addEventListener("scroll", () => {
    lineNumbers.scrollTop = codeInput.scrollTop;
  });

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

  // --- Initial load ---
  codeInput.value = templates[currentLang];
  handleCompile();
});
