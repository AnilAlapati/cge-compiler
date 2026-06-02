import { CGEParser } from "./cge_parser";

/**
 * Go CGE Parser
 * Translates Go source structures (structs, interfaces, functions, receiver methods) into CGE/1.0.
 */
export class GoParser implements CGEParser {
  public parse(code: string, fileName?: string): {
    imports: string[];
    types: string[];
    state: string[];
    ops: string[];
    privateOps: string[];
    exports: string[];
  } {
    const lines = code.split("\n");

    const imports: string[] = [];
    const types: string[] = [];
    const state: string[] = [];
    const ops: string[] = [];
    const privateOps: string[] = [];
    const exportsList: string[] = [];

    // Helper to map Go types to CGE shorthand
    const mapGoType = (goType: string | undefined): string => {
      if (!goType) return "any";
      let clean = goType.trim();
      
      // Strip pointer indicator
      if (clean.startsWith("*")) {
        clean = clean.substring(1).trim();
      }

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
        case "uintptr":
        case "byte":
        case "rune":
          return "N";
        case "bool": return "B";
        case "time.Time": return "D";
        case "error": return "error";
        case "interface{}":
        case "any":
          return "any";
      }

      // Slice or array: []type
      if (clean.startsWith("[]")) {
        const inner = clean.substring(2);
        return `${mapGoType(inner)}[]`;
      }

      // Map: map[keyType]valueType
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

    // Helper to clean and format statements inside function bodies
    const translateStatement = (stmt: string): string => {
      const clean = stmt.trim();
      if (!clean) return "";

      // 1. Guard check with return: if err != nil { return ... }
      const inlineGuardReturn = clean.match(/^if\s+(.+?)\s*\{\s*return\s*(.*?)\s*\}/);
      if (inlineGuardReturn) {
        const cond = inlineGuardReturn[1] || "";
        const val = inlineGuardReturn[2] || "void";
        return `GUARD ${cond} RETURN ${val}`;
      }

      // 2. Guard check with panic: if err != nil { panic(...) }
      const inlineGuardPanic = clean.match(/^if\s+(.+?)\s*\{\s*panic\((.*?)\)\s*\}/);
      if (inlineGuardPanic) {
        const cond = inlineGuardPanic[1] || "";
        const err = inlineGuardPanic[2] || "";
        return `GUARD ${cond} THROW ${err}`;
      }

      // 3. Simple return
      if (clean.startsWith("return ")) {
        return `RETURN ${clean.substring(7)}`;
      }
      if (clean === "return") {
        return "RETURN void";
      }

      // 4. Panic/Throw
      if (clean.startsWith("panic(")) {
        const match = clean.match(/^panic\((.*?)\)/);
        return `THROW ${match ? match[1] : clean}`;
      }

      return clean;
    };

    let activeStruct: { name: string; fields: string[] } | null = null;
    let activeInterface: { name: string; methods: string[] } | null = null;
    let activeBlock: { name: string; isExported: boolean; receiver: string; params: string; ret: string; bodyLines: string[]; startBraceLevel: number } | null = null;
    let inImportBlock = false;
    let inVarBlock = false;
    let inConstBlock = false;
    let braceCount = 0;

    const isCapitalized = (str: string): boolean => {
      if (!str) return false;
      const char = str.charAt(0);
      return char === char.toUpperCase() && char !== char.toLowerCase();
    };

    const flushStruct = () => {
      if (!activeStruct) return;
      const prefix = isCapitalized(activeStruct.name) ? "EXPORT " : "";
      types.push(`${prefix}${activeStruct.name}{${activeStruct.fields.join(", ")}}`);
      if (isCapitalized(activeStruct.name)) {
        exportsList.push(activeStruct.name);
      }
      activeStruct = null;
    };

    const flushInterface = () => {
      if (!activeInterface) return;
      const prefix = isCapitalized(activeInterface.name) ? "EXPORT " : "";
      types.push(`${prefix}${activeInterface.name}{${activeInterface.methods.join(", ")}}`);
      if (isCapitalized(activeInterface.name)) {
        exportsList.push(activeInterface.name);
      }
      activeInterface = null;
    };

    const flushBlock = () => {
      if (!activeBlock) return;

      const bodyTranslated: string[] = [];
      let i = 0;
      while (i < activeBlock.bodyLines.length) {
        const line = activeBlock.bodyLines[i];
        if (line === undefined) {
          i++;
          continue;
        }
        const clean = line.trim();

        // Multi-line guard support:
        // if err != nil {
        //     return nil, err
        // }
        if (clean.startsWith("if ") && clean.endsWith("{") && i + 2 < activeBlock.bodyLines.length) {
          const nextLine = activeBlock.bodyLines[i + 1];
          const thirdLine = activeBlock.bodyLines[i + 2];
          if (nextLine !== undefined && thirdLine !== undefined) {
            const nextClean = nextLine.trim();
            const thirdClean = thirdLine.trim();
            if ((nextClean.startsWith("return ") || nextClean === "return") && thirdClean === "}") {
              const cond = clean.substring(3, clean.length - 1).trim();
              const val = nextClean.startsWith("return ") ? nextClean.substring(7).trim() : "void";
              bodyTranslated.push(`    GUARD ${cond} RETURN ${val}`);
              i += 3;
              continue;
            }
            if (nextClean.startsWith("panic(") && thirdClean === "}") {
              const cond = clean.substring(3, clean.length - 1).trim();
              const errMatch = nextClean.match(/^panic\((.*?)\)/);
              const err = errMatch ? errMatch[1] : nextClean;
              bodyTranslated.push(`    GUARD ${cond} THROW ${err}`);
              i += 3;
              continue;
            }
          }
        }

        // Loop translation: for _, item := range items { ... }
        const rangeMatch = clean.match(/^for\s+(.+?)\s*:=\s*range\s+(.+?)\s*\{$/) || clean.match(/^for\s+(.+?)\s*=\s*range\s+(.+?)\s*\{$/);
        if (rangeMatch) {
          const iteratorRaw = rangeMatch[1] || "";
          const collection = rangeMatch[2] || "";
          const iterator = iteratorRaw.replace(/^_\s*,\s*/, "").trim();

          // Pattern A: nested 3-line if block inside loop (5 lines total)
          if (i + 4 < activeBlock.bodyLines.length) {
            const next = (activeBlock.bodyLines[i + 1] || "").trim();
            const third = (activeBlock.bodyLines[i + 2] || "").trim();
            const fourth = (activeBlock.bodyLines[i + 3] || "").trim();
            const fifth = (activeBlock.bodyLines[i + 4] || "").trim();
            if (next.startsWith("if ") && next.endsWith("{") && fourth === "}" && fifth === "}") {
              const cond = next.substring(3, next.length - 1).trim();
              const body = translateStatement(third);
              bodyTranslated.push(`    SCAN ${collection} FOR ${iterator} -> GUARD ${cond} ${body}`);
              i += 5;
              continue;
            }
          }

          // Pattern B: single statement loop body (3 lines total)
          if (i + 2 < activeBlock.bodyLines.length) {
            const next = (activeBlock.bodyLines[i + 1] || "").trim();
            const third = (activeBlock.bodyLines[i + 2] || "").trim();
            if (third === "}") {
              const body = translateStatement(next);
              bodyTranslated.push(`    SCAN ${collection} FOR ${iterator} -> ${body}`);
              i += 3;
              continue;
            }
          }
        }

        const trans = translateStatement(clean);
        if (trans && trans !== "}") {
          bodyTranslated.push(`    ${trans}`);
        }
        i++;
      }

      // Format method name with receiver if applicable, e.g. AuthService.Login
      const nameWithReceiver = activeBlock.receiver ? `${activeBlock.receiver}.${activeBlock.name}` : activeBlock.name;
      const signature = `${activeBlock.isExported ? "EXPORT " : ""}${nameWithReceiver}(${activeBlock.params})->${activeBlock.ret}:${bodyTranslated.length > 0 ? "\n" + bodyTranslated.join("\n") : " void"}`;

      if (activeBlock.isExported) {
        ops.push(signature);
        exportsList.push(activeBlock.name);
      } else {
        privateOps.push(signature);
      }

      activeBlock = null;
    };

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      if (line === undefined) continue;

      const clean = line.trim();
      if (!clean || clean.startsWith("//") || clean.startsWith("/*")) continue;

      // Track braces
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
        // Extract structural fields
        const fieldMatch = clean.match(/^(\w+)\s+([^\s`]+)/);
        if (fieldMatch) {
          const fName = fieldMatch[1] || "";
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
        // Extract interface signatures
        const methodMatch = clean.match(/^(\w+)\s*\((.*?)\)\s*(.*)/);
        if (methodMatch) {
          const mName = methodMatch[1] || "";
          const paramsRaw = methodMatch[2] || "";
          const retRaw = methodMatch[3]?.trim() || "void";

          const params = paramsRaw
            .split(",")
            .map(p => p.trim())
            .filter(Boolean)
            .map(p => {
              const parts = p.split(/\s+/);
              if (parts.length === 2) {
                return `${parts[0]}:${mapGoType(parts[1])}`;
              }
              return `param:${mapGoType(p)}`;
            })
            .join(", ");
          
          let ret = mapGoType(retRaw);
          if (retRaw.startsWith("(")) {
            // handle multi-value returns like (string, error)
            const cleanedRet = retRaw.replace(/[()]/g, "");
            ret = cleanedRet.split(",").map(r => mapGoType(r.trim())).join("|");
          }

          activeInterface.methods.push(`${mName}(${params})->${ret}`);
        }
        continue;
      }

      // Handle multi-line import blocks
      if (inImportBlock) {
        if (clean.startsWith(")")) {
          inImportBlock = false;
          continue;
        }
        const impMatch = clean.match(/^"(.+?)"/);
        if (impMatch) {
          imports.push(impMatch[1] || "");
        }
        continue;
      }

      // Handle multi-line var/const blocks
      if (inVarBlock || inConstBlock) {
        if (clean.startsWith(")")) {
          inVarBlock = false;
          inConstBlock = false;
          continue;
        }
        const stateMatch = clean.match(/^(\w+)\s*(?:[^\s=]*)\s*=\s*(.+)/);
        if (stateMatch) {
          const name = stateMatch[1] || "";
          const val = stateMatch[2] || "";
          const prefix = inConstBlock ? "CONST " : "";
          const exportPrefix = isCapitalized(name) ? "EXPORT " : "";
          state.push(`${exportPrefix}${prefix}${name}:any = ${val}`);
          if (isCapitalized(name)) exportsList.push(name);
        }
        continue;
      }

      // 1. Single line imports
      const singleImport = clean.match(/^import\s+"(.+?)"/);
      if (singleImport) {
        imports.push(singleImport[1] || "");
        continue;
      }

      // Multi-line import start
      if (clean === "import (") {
        inImportBlock = true;
        continue;
      }

      // 2. Struct declarations
      const structMatch = clean.match(/^type\s+(\w+)\s+struct\s*\{/);
      if (structMatch) {
        flushStruct();
        flushInterface();
        activeStruct = {
          name: structMatch[1] || "Unknown",
          fields: []
        };
        continue;
      }

      // 3. Interface declarations
      const interfaceMatch = clean.match(/^type\s+(\w+)\s+interface\s*\{/);
      if (interfaceMatch) {
        flushStruct();
        flushInterface();
        activeInterface = {
          name: interfaceMatch[1] || "Unknown",
          methods: []
        };
        continue;
      }

      // 4. Function & Receiver Method declarations
      // Matches both standard functions and receiver methods:
      // func (r *Receiver) MethodName(params) returns {
      // func FunctionName(params) returns {
      const fnMatch = clean.match(/^func\s+(?:\((.+?)\)\s+)?(\w+)\s*\((.*?)\)\s*(.*?)\s*\{/);
      if (fnMatch) {
        const receiverRaw = fnMatch[1] || "";
        const name = fnMatch[2] || "anonymous";
        const paramsRaw = fnMatch[3] || "";
        const retRaw = fnMatch[4]?.trim() || "void";

        // Extract receiver name without pointer structure, e.g. "s *AuthService" -> "AuthService"
        let receiver = "";
        if (receiverRaw) {
          const parts = receiverRaw.trim().split(/\s+/);
          const rType = parts[1] || parts[0] || "";
          receiver = rType.replace(/^\*/, "").trim();
        }

        // Standardize params list: name type
        const params = paramsRaw
          .split(",")
          .map(p => p.trim())
          .filter(Boolean)
          .map(p => {
            const parts = p.split(/\s+/);
            if (parts.length === 2) {
              return `${parts[0]}:${mapGoType(parts[1])}`;
            }
            return `param:${mapGoType(p)}`;
          })
          .join(", ");

        let ret = mapGoType(retRaw);
        if (retRaw.startsWith("(")) {
          const cleanedRet = retRaw.replace(/[()]/g, "");
          ret = cleanedRet.split(",").map(r => mapGoType(r.trim())).join("|");
        }

        const isExported = isCapitalized(name);

        activeBlock = {
          name,
          isExported,
          receiver,
          params,
          ret,
          bodyLines: [],
          startBraceLevel: clean.includes("{") ? braceCount : braceCount + 1
        };
        continue;
      }

      // 5. Global Constant & Variable parsing
      const singleConst = clean.match(/^const\s+(\w+)\s*(?:[^\s=]*)\s*=\s*(.+)/);
      if (singleConst) {
        const name = singleConst[1] || "";
        const val = singleConst[2] || "";
        const prefix = isCapitalized(name) ? "EXPORT " : "";
        state.push(`${prefix}CONST ${name}:any = ${val}`);
        if (isCapitalized(name)) exportsList.push(name);
        continue;
      }

      const singleVar = clean.match(/^var\s+(\w+)\s*(?:[^\s=]*)\s*=\s*(.+)/);
      if (singleVar) {
        const name = singleVar[1] || "";
        const val = singleVar[2] || "";
        const prefix = isCapitalized(name) ? "EXPORT " : "";
        state.push(`${prefix}${name}:any = ${val}`);
        if (isCapitalized(name)) exportsList.push(name);
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

    return {
      imports,
      types,
      state,
      ops,
      privateOps,
      exports: exportsList
    };
  }
}
