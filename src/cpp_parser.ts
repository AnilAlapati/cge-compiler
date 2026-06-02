import { CGEParser } from "./cge_parser";
import * as path from "path";

/**
 * C++ CGE Parser
 * Translates C++ code structures (class, struct, enum, public/private members, namespace-level functions) into CGE/1.0.
 */
export class CppParser implements CGEParser {
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

    // Helper to map C++ types to CGE shorthand
    const mapCppType = (cppType: string | undefined): string => {
      if (!cppType) return "any";
      let clean = cppType.trim();
      
      // Remove const, references, and pointers
      clean = clean.replace(/\bconst\b/g, "").replace(/[&*]/g, "").trim();

      // Remove std:: namespace prefix if present
      if (clean.startsWith("std::")) {
        clean = clean.substring(5);
      }

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

      // Templates: vector<type> or list<type>
      if (clean.startsWith("vector<") || clean.startsWith("list<")) {
        const inner = clean.substring(clean.indexOf("<") + 1, clean.lastIndexOf(">"));
        return `${mapCppType(inner)}[]`;
      }

      // Maps: map<K, V> or unordered_map<K, V>
      if (clean.startsWith("map<") || clean.startsWith("unordered_map<")) {
        const inner = clean.substring(clean.indexOf("<") + 1, clean.lastIndexOf(">"));
        const parts = inner.split(",");
        const key = parts[0]?.trim() || "S";
        const val = parts[1]?.trim() || "any";
        return `Map<${mapCppType(key)}, ${mapCppType(val)}>`;
      }

      return clean;
    };

    const translateStatement = (stmt: string): string => {
      const clean = stmt.trim().replace(/;$/, "");
      if (!clean) return "";

      // 1. Guard check with return: if (cond) return val;
      const guardReturn = clean.match(/^if\s*\((.+?)\)\s*return\s*(.*?)$/);
      if (guardReturn) {
        const cond = guardReturn[1] || "";
        const val = guardReturn[2] || "void";
        return `GUARD ${cond} RETURN ${val}`;
      }

      // 2. Guard check with throw: if (cond) throw ...
      const guardThrow = clean.match(/^if\s*\((.+?)\)\s*throw\s+(.*?)$/);
      if (guardThrow) {
        const cond = guardThrow[1] || "";
        const err = guardThrow[2] || "";
        return `GUARD ${cond} THROW ${err}`;
      }

      // 3. Simple return
      if (clean.startsWith("return ")) {
        return `RETURN ${clean.substring(7)}`;
      }
      if (clean === "return") {
        return "RETURN void";
      }

      // 4. Throw
      if (clean.startsWith("throw ")) {
        return `THROW ${clean.substring(6)}`;
      }

      return clean;
    };

    let activeClass: { name: string; isStruct: boolean; fields: string[] } | null = null;
    let activeEnum: { name: string; variants: string[] } | null = null;
    let activeBlock: { name: string; isPublic: boolean; className: string; params: string; ret: string; bodyLines: string[]; startBraceLevel: number } | null = null;
    let currentAccess: "public" | "private" | "protected" = "private";
    let braceCount = 0;

    const flushClass = () => {
      if (!activeClass) return;
      const prefix = "EXPORT "; // By default export classes/structs
      types.push(`${prefix}${activeClass.name}{${activeClass.fields.join(", ")}}`);
      exportsList.push(activeClass.name);
      activeClass = null;
    };

    const flushEnum = () => {
      if (!activeEnum) return;
      const prefix = "EXPORT ";
      types.push(`${prefix}${activeEnum.name} = ${activeEnum.variants.join("|")}`);
      exportsList.push(activeEnum.name);
      activeEnum = null;
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
        // if (cond) {
        //     return val;
        // }
        if (clean.startsWith("if ") && clean.endsWith("{") && i + 2 < activeBlock.bodyLines.length) {
          const nextLine = activeBlock.bodyLines[i + 1];
          const thirdLine = activeBlock.bodyLines[i + 2];
          if (nextLine !== undefined && thirdLine !== undefined) {
            const nextClean = nextLine.trim().replace(/;$/, "");
            const thirdClean = thirdLine.trim();
            if ((nextClean.startsWith("return ") || nextClean === "return") && thirdClean === "}") {
              const cond = clean.substring(clean.indexOf("(") + 1, clean.lastIndexOf(")")).trim();
              const val = nextClean.startsWith("return ") ? nextClean.substring(7).trim() : "void";
              bodyTranslated.push(`    GUARD ${cond} RETURN ${val}`);
              i += 3;
              continue;
            }
            if (nextClean.startsWith("throw ") && thirdClean === "}") {
              const cond = clean.substring(clean.indexOf("(") + 1, clean.lastIndexOf(")")).trim();
              const err = nextClean.substring(6).trim();
              bodyTranslated.push(`    GUARD ${cond} THROW ${err}`);
              i += 3;
              continue;
            }
          }
        }

        // Loop translation: for (auto& item : items) { ... }
        const forMatch = clean.match(/^for\s*\((.+?)\s*:\s*(.+?)\)\s*\{$/);
        if (forMatch) {
          const decl = forMatch[1] || "";
          const collection = forMatch[2] || "";
          const declParts = decl.trim().split(/\s+/);
          const iterator = declParts[declParts.length - 1]?.replace(/[&*]/g, "") || "item";

          // Pattern A: nested 3-line if block inside loop (5 lines total)
          if (i + 4 < activeBlock.bodyLines.length) {
            const next = (activeBlock.bodyLines[i + 1] || "").trim();
            const third = (activeBlock.bodyLines[i + 2] || "").trim().replace(/;$/, "");
            const fourth = (activeBlock.bodyLines[i + 3] || "").trim();
            const fifth = (activeBlock.bodyLines[i + 4] || "").trim();
            if (next.startsWith("if ") && next.endsWith("{") && fourth === "}" && fifth === "}") {
              const cond = next.substring(next.indexOf("(") + 1, next.lastIndexOf(")")).trim();
              const body = translateStatement(third);
              bodyTranslated.push(`    SCAN ${collection} FOR ${iterator} -> GUARD ${cond} ${body}`);
              i += 5;
              continue;
            }
          }

          // Pattern B: single statement loop body (3 lines total)
          if (i + 2 < activeBlock.bodyLines.length) {
            const next = (activeBlock.bodyLines[i + 1] || "").trim().replace(/;$/, "");
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

      // Format method name with class name if applicable, e.g. AuthService.login
      const nameWithClass = activeBlock.className ? `${activeBlock.className}.${activeBlock.name}` : activeBlock.name;
      const signature = `${activeBlock.isPublic ? "EXPORT " : ""}${nameWithClass}(${activeBlock.params})->${activeBlock.ret}:${bodyTranslated.length > 0 ? "\n" + bodyTranslated.join("\n") : " void"}`;

      if (activeBlock.isPublic) {
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

      if (activeClass) {
        if (clean.startsWith("};")) {
          flushClass();
          continue;
        }

        // Visbility mode change
        if (clean === "public:") {
          currentAccess = "public";
          continue;
        }
        if (clean === "private:") {
          currentAccess = "private";
          continue;
        }
        if (clean === "protected:") {
          currentAccess = "protected";
          continue;
        }

        // Inside class: check for method declaration with body or inline
        // Matches e.g.: "void login(string email) {"
        const classMethodMatch = clean.match(/^(?:virtual\s+)?([^\s]+)\s+(\w+)\s*\((.*?)\)(?:\s*const)?\s*\{/);
        if (classMethodMatch) {
          const ret = mapCppType(classMethodMatch[1]);
          const name = classMethodMatch[2] || "anonymous";
          const paramsRaw = classMethodMatch[3] || "";
          const isPublic = activeClass.isStruct || currentAccess === "public";

          const params = paramsRaw
            .split(",")
            .map(p => p.trim())
            .filter(Boolean)
            .map(p => {
              const parts = p.split(/\s+/);
              if (parts.length >= 2) {
                const pName = parts[parts.length - 1]?.replace(/[&*]/g, "") || "";
                const pType = mapCppType(parts.slice(0, -1).join(" "));
                return `${pName}:${pType}`;
              }
              return `param:${mapCppType(p)}`;
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

        // Check for class member property
        // Matches e.g.: "string email;" or "int age = 0;"
        const propMatch = clean.match(/^([^\s]+)\s+(\w+)\s*(?:=\s*[^;]+)?\s*;/);
        if (propMatch) {
          const type = mapCppType(propMatch[1]);
          const name = propMatch[2] || "";
          
          if (activeClass.isStruct || currentAccess === "public") {
            activeClass.fields.push(`${name}:${type}`);
          }
          // Also track state variables
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
        if (val) {
          activeEnum.variants.push(val);
        }
        continue;
      }

      // 1. Includes
      const includeMatch = clean.match(/^#include\s+["<](.+?)[">]/);
      if (includeMatch) {
        imports.push(includeMatch[1] || "");
        continue;
      }

      // 2. Class declarations
      const classMatch = clean.match(/^class\s+(\w+)\s*\{/);
      if (classMatch) {
        flushClass();
        flushEnum();
        activeClass = {
          name: classMatch[1] || "Unknown",
          isStruct: false,
          fields: []
        };
        currentAccess = "private"; // default is private in class
        continue;
      }

      // Struct declarations
      const structMatch = clean.match(/^struct\s+(\w+)\s*\{/);
      if (structMatch) {
        flushClass();
        flushEnum();
        activeClass = {
          name: structMatch[1] || "Unknown",
          isStruct: true,
          fields: []
        };
        currentAccess = "public"; // default is public in struct
        continue;
      }

      // 3. Enum declarations
      const enumMatch = clean.match(/^enum\s+(\w+)\s*\{/) || clean.match(/^enum\s+class\s+(\w+)\s*\{/);
      if (enumMatch) {
        flushClass();
        flushEnum();
        activeEnum = {
          name: enumMatch[1] || "Unknown",
          variants: []
        };
        continue;
      }

      // 4. Global / Namespace functions
      // Matches e.g.: "void check(int count) {" or "int main() {"
      const globalFnMatch = clean.match(/^([^\s]+)\s+(\w+)\s*\((.*?)\)\s*\{/);
      if (globalFnMatch) {
        const ret = mapCppType(globalFnMatch[1]);
        const name = globalFnMatch[2] || "anonymous";
        const paramsRaw = globalFnMatch[3] || "";

        // Filter out main function from general exporting
        const isPublic = name !== "main";

        const params = paramsRaw
          .split(",")
          .map(p => p.trim())
          .filter(Boolean)
          .map(p => {
            const parts = p.split(/\s+/);
            if (parts.length >= 2) {
              const pName = parts[parts.length - 1]?.replace(/[&*]/g, "") || "";
              const pType = mapCppType(parts.slice(0, -1).join(" "));
              return `${pName}:${pType}`;
            }
            return `param:${mapCppType(p)}`;
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

      // 5. Global constants & variables
      // Matches: "const int MAX = 5;" or "string endpoint = \"...\";"
      const constMatch = clean.match(/^const\s+([^\s]+)\s+(\w+)\s*=\s*(.+?);/);
      if (constMatch) {
        const type = mapCppType(constMatch[1]);
        const name = constMatch[2] || "";
        const val = constMatch[3] || "";
        state.push(`EXPORT CONST ${name}:${type} = ${val}`);
        exportsList.push(name);
        continue;
      }

      const varMatch = clean.match(/^([^\s]+)\s+(\w+)\s*=\s*(.+?);/);
      if (varMatch) {
        const type = mapCppType(varMatch[1]);
        const name = varMatch[2] || "";
        const val = varMatch[3] || "";
        if (name !== "using" && type !== "namespace") { // prevent namespace mappings
          state.push(`EXPORT ${name}:${type} = ${val}`);
          exportsList.push(name);
        }
        continue;
      }
    }

    flushClass();
    flushEnum();
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
