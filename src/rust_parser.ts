import { CGEParser } from "./cge_parser";

/**
 * Rust CGE Parser
 * Translates Rust code structures (struct, enum, impl, pub fn) into CGE/1.0.
 */
export class RustParser implements CGEParser {
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

    // Helper to map Rust types to CGE shorthand
    const mapRustType = (rustType: string | undefined): string => {
      if (!rustType) return "any";
      const clean = rustType.trim();
      switch (clean) {
        case "String":
        case "&str": return "S";
        case "i32":
        case "i64":
        case "u32":
        case "u64":
        case "f32":
        case "f64":
        case "usize": return "N";
        case "bool": return "B";
        case "()": return "void";
      }
      if (clean.startsWith("Vec<")) {
        const inner = clean.substring(4, clean.length - 1);
        return `${mapRustType(inner)}[]`;
      }
      if (clean.startsWith("Option<")) {
        return mapRustType(clean.substring(7, clean.length - 1)) + "?";
      }
      if (clean.startsWith("Result<")) {
        const inner = clean.substring(7, clean.length - 1).split(",")[0];
        return mapRustType(inner);
      }
      return clean;
    };

    let activeStruct: { name: string; fields: string[] } | null = null;
    let activeEnum: { name: string; variants: string[] } | null = null;
    let activeBlock: { name: string; isPublic: boolean; params: string; ret: string; bodyLines: string[] } | null = null;
    let braceCount = 0;

    // Helper to clean up expressions
    const translateStatement = (stmt: string): string => {
      const clean = stmt.trim().replace(/;$/, "");
      if (!clean) return "";

      // 1. Guard return
      const guardReturn = clean.match(/^if\s+(.+?)\s*\{\s*return\s*(.*?)\s*;?\s*\}/);
      if (guardReturn) {
        const cond = guardReturn[1] || "";
        const val = guardReturn[2] || "void";
        return `GUARD ${cond} RETURN ${val}`;
      }

      // 2. Guard Err/Panic
      const guardPanic = clean.match(/^if\s+(.+?)\s*\{\s*panic!\((.*?)\)\s*;?\s*\}/);
      if (guardPanic) {
        const cond = guardPanic[1] || "";
        const err = guardPanic[2] || "";
        return `GUARD ${cond} THROW ${err}`;
      }

      // 3. Simple return
      if (clean.startsWith("return ")) {
        return `RETURN ${clean.substring(7)}`;
      }

      return clean;
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

        // Handle multi-line if-return or if-panic in Rust:
        // if cond {
        //     return val;
        // }
        if (clean.startsWith("if ") && clean.endsWith("{") && i + 2 < activeBlock.bodyLines.length) {
          const nextLine = activeBlock.bodyLines[i + 1];
          const thirdLine = activeBlock.bodyLines[i + 2];
          if (nextLine !== undefined && thirdLine !== undefined) {
            const nextClean = nextLine.trim();
            const thirdClean = thirdLine.trim();
            if ((nextClean.startsWith("return ") || nextClean === "return") && thirdClean === "}") {
              const cond = clean.substring(3, clean.length - 1).trim();
              const val = nextClean.startsWith("return ") ? nextClean.substring(7).replace(/;$/, "").trim() : "void";
              bodyTranslated.push(`    GUARD ${cond} RETURN ${val}`);
              i += 3;
              continue;
            }
            if (nextClean.startsWith("panic!") && thirdClean === "}") {
              const cond = clean.substring(3, clean.length - 1).trim();
              const err = nextClean.replace(/;$/, "").trim();
              bodyTranslated.push(`    GUARD ${cond} THROW ${err}`);
              i += 3;
              continue;
            }
          }
        }

        // Check for loops (SCAN mapping)
        const forMatch = clean.match(/^for\s+(.+?)\s+in\s+(.+?)\s*\{$/);
        if (forMatch && i + 1 < activeBlock.bodyLines.length) {
          const nextLine = activeBlock.bodyLines[i + 1];
          if (nextLine !== undefined) {
            const nextClean = nextLine.trim();
            if (nextClean.endsWith("}")) {
              const iterator = forMatch[1] || "";
              const collection = forMatch[2] || "";
              const body = translateStatement(nextClean);
              bodyTranslated.push(`    SCAN ${collection} FOR ${iterator} -> ${body}`);
              i += 2;
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

      const retType = mapRustType(activeBlock.ret);
      const signature = `${activeBlock.name}(${activeBlock.params})->${retType}:${bodyTranslated.length > 0 ? "\n" + bodyTranslated.join("\n") : " void"}`;

      if (activeBlock.isPublic) {
        ops.push(signature);
      } else {
        privateOps.push(signature);
      }

      activeBlock = null;
    };

    const flushStruct = () => {
      if (!activeStruct) return;
      types.push(`${activeStruct.name}{${activeStruct.fields.join(", ")}}`);
      exportsList.push(activeStruct.name);
      activeStruct = null;
    };

    const flushEnum = () => {
      if (!activeEnum) return;
      types.push(`${activeEnum.name} = ${activeEnum.variants.join("|")}`);
      exportsList.push(activeEnum.name);
      activeEnum = null;
    };

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      if (line === undefined) continue;

      const clean = line.trim();
      if (!clean || clean.startsWith("//") || clean.startsWith("/*")) continue;

      // Track braces
      const opens = (line.match(/\{/g) || []).length;
      const closes = (line.match(/\}/g) || []).length;
      braceCount += opens - closes;

      if (activeBlock) {
        if (braceCount > 0 || (braceCount === 0 && opens > 0)) {
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
        const fieldMatch = clean.match(/^pub\s+(\w+)\s*:\s*([^,]+)/) || clean.match(/^(\w+)\s*:\s*([^,]+)/);
        if (fieldMatch) {
          const name = fieldMatch[1] || "";
          const type = mapRustType(fieldMatch[2]);
          activeStruct.fields.push(`${name}:${type}`);
        }
        continue;
      }

      if (activeEnum) {
        if (clean.startsWith("}")) {
          flushEnum();
          continue;
        }
        const variant = clean.replace(/,$/, "");
        if (variant && !variant.startsWith("pub")) {
          activeEnum.variants.push(variant);
        }
        continue;
      }

      // 1. Imports
      const useMatch = clean.match(/^use\s+(.+);/);
      if (useMatch) {
        const imp = useMatch[1] || "";
        imports.push(imp);
        continue;
      }

      // 2. Structs
      const structMatch = clean.match(/^pub\s+struct\s+(\w+)/) || clean.match(/^struct\s+(\w+)/);
      if (structMatch) {
        flushStruct();
        const sName = structMatch[1] || "UnknownStruct";
        activeStruct = {
          name: sName,
          fields: [],
        };
        continue;
      }

      // 3. Enums
      const enumMatch = clean.match(/^pub\s+enum\s+(\w+)/) || clean.match(/^enum\s+(\w+)/);
      if (enumMatch) {
        flushEnum();
        const eName = enumMatch[1] || "UnknownEnum";
        activeEnum = {
          name: eName,
          variants: [],
        };
        continue;
      }

      // 4. Functions / Methods
      const fnMatch = clean.match(/^(pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\((.*?)\)(?:\s*->\s*(.+?))?\s*\{/);
      if (fnMatch) {
        const isPublic = !!fnMatch[1];
        const name = fnMatch[2] || "anonymous";
        const paramsRaw = fnMatch[3] || "";
        const ret = fnMatch[4]?.trim() || "()";

        const params = paramsRaw
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p && p !== "self" && p !== "&self" && p !== "&mut self")
          .map((p) => {
            const parts = p.split(":");
            const pName = parts[0]?.trim() || "";
            const pType = parts[1] ? mapRustType(parts[1]) : "any";
            return `${pName}:${pType}`;
          })
          .join(", ");

        activeBlock = {
          name,
          isPublic,
          params,
          ret,
          bodyLines: [],
        };

        if (isPublic) {
          exportsList.push(name);
        }
        continue;
      }

      // 5. Constants & Globals
      const constMatch = clean.match(/^(pub\s+)?const\s+(\w+)\s*:\s*(.+?)\s*=\s*(.+);/);
      if (constMatch) {
        const name = constMatch[2] || "";
        const type = mapRustType(constMatch[3]);
        const val = constMatch[4] || "";
        state.push(`CONST ${name}:${type} = ${val}`);
        if (constMatch[1]) {
          exportsList.push(name);
        }
        continue;
      }
    }

    // Flush any remaining active blocks
    flushBlock();
    flushStruct();
    flushEnum();

    return {
      imports,
      types,
      state,
      ops,
      privateOps,
      exports: exportsList,
    };
  }
}
