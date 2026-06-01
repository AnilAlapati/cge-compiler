import * as ts from "typescript";
import { CGEParser } from "./cge_parser";
import * as path from "path";

/**
 * TypeScript CGE Parser
 * Translates TypeScript AST elements into structured CGE blocks.
 */
export class TypeScriptParser implements CGEParser {
  public parse(code: string, fileName?: string): {
    imports: string[];
    types: string[];
    state: string[];
    ops: string[];
    privateOps: string[];
    exports: string[];
  } {
    const sourceFileName = fileName || "temp.ts";
    const sourceFile = ts.createSourceFile(
      sourceFileName,
      code,
      ts.ScriptTarget.ES2022,
      true
    );

    const componentName = path.basename(sourceFileName, path.extname(sourceFileName));

    const imports: string[] = [];
    const types: string[] = [];
    const state: string[] = [];
    const ops: string[] = [];
    const privateOps: string[] = [];
    const exportsList: string[] = [];

    ts.forEachChild(sourceFile, (node) => {
      // 1. Imports
      if (ts.isImportDeclaration(node)) {
        const importStr = this.formatImport(node);
        if (importStr) imports.push(importStr);
      }
      // 2. Interfaces / Types
      else if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
        types.push(this.formatTypeDeclaration(node));
        if (this.isExported(node)) {
          exportsList.push(node.name.text);
        }
      }
      // 3. Classes
      else if (ts.isClassDeclaration(node)) {
        const className = node.name ? node.name.text : "AnonymousClass";
        if (this.isExported(node)) {
          exportsList.push(className);
        }
        
        node.members.forEach((member) => {
          if (ts.isPropertyDeclaration(member)) {
            state.push(this.formatProperty(member));
          } else if (ts.isMethodDeclaration(member)) {
            const isPrivate = this.hasModifier(member, ts.SyntaxKind.PrivateKeyword);
            const methodStr = this.formatMethod(member);
            if (isPrivate) {
              privateOps.push(methodStr);
            } else {
              ops.push(methodStr);
            }
          }
        });
      }
      // 4. Global Variables (Module level state/constants)
      else if (ts.isVariableStatement(node)) {
        const isExport = this.isExported(node);
        const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
        
        node.declarationList.declarations.forEach((decl) => {
          if (isExport && ts.isIdentifier(decl.name) && decl.name.text.startsWith("use") && decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
            exportsList.push(decl.name.text);
            ops.push(this.formatExportedHook(decl.name.text, decl.initializer));
          } else {
            const name = decl.name.getText();
            const typeStr = decl.type ? this.mapType(decl.type) : "any";
            const initStr = decl.initializer ? this.exprToString(decl.initializer) : "";
            const prefix = isConst ? "CONST " : "";
            const formatted = `${prefix}${name}:${typeStr}${initStr ? " = " + initStr : ""}`;
            state.push(formatted);
            if (isExport) {
              exportsList.push(name);
            }
          }
        });
      }
      // 5. Global Functions
      else if (ts.isFunctionDeclaration(node)) {
        const funcName = node.name ? node.name.text : "anonymous";
        const isExport = this.isExported(node);
        const funcStr = this.formatFunction(node);
        if (isExport) {
          exportsList.push(funcName);
          ops.push(funcStr);
        } else {
          privateOps.push(funcStr);
        }
      }
    });

    return {
      imports,
      types,
      state,
      ops,
      privateOps,
      exports: exportsList,
    };
  }

  // --- NODE FORMATTERS ---

  private formatImport(node: ts.ImportDeclaration): string {
    const moduleSpecifier = node.moduleSpecifier.getText().replace(/['"]/g, "");
    if (!node.importClause) return "";

    const clause = node.importClause;
    const parts: string[] = [];

    if (clause.name) {
      parts.push(clause.name.text);
    }

    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) {
        parts.push(`* as ${clause.namedBindings.name.text}`);
      } else if (ts.isNamedImports(clause.namedBindings)) {
        const specifiers = clause.namedBindings.elements.map((el) => el.name.text);
        parts.push(specifiers.join(","));
      }
    }

    return `${parts.join(", ")} from ${moduleSpecifier}`;
  }

  private formatTypeDeclaration(node: ts.InterfaceDeclaration | ts.TypeAliasDeclaration): string {
    const name = node.name.text;
    if (ts.isInterfaceDeclaration(node)) {
      const fields = node.members
        .filter(ts.isPropertySignature)
        .map((member) => {
          const fieldName = member.name.getText();
          const optional = member.questionToken ? "?" : "";
          const typeStr = this.mapType(member.type);
          return `${fieldName}${optional}:${typeStr}`;
        });
      return `${name}{${fields.join(", ")}}`;
    } else {
      const typeStr = this.mapType(node.type);
      if (ts.isTypeLiteralNode(node.type)) {
        const fields = node.type.members
          .filter(ts.isPropertySignature)
          .map((member) => {
            const fieldName = member.name.getText();
            const optional = member.questionToken ? "?" : "";
            const typeStr = this.mapType(member.type);
            return `${fieldName}${optional}:${typeStr}`;
          });
        return `${name}{${fields.join(", ")}}`;
      }
      return `${name} = ${typeStr}`;
    }
  }

  private formatProperty(node: ts.PropertyDeclaration): string {
    const name = node.name.getText();
    const typeStr = node.type ? this.mapType(node.type) : "any";
    const initStr = node.initializer ? this.exprToString(node.initializer) : "";
    const isConst = this.hasModifier(node, ts.SyntaxKind.ReadonlyKeyword);
    const prefix = isConst ? "CONST " : "";
    
    return `${prefix}${name}:${typeStr}${initStr ? " = " + initStr : ""}`;
  }

  private formatMethod(node: ts.MethodDeclaration): string {
    const name = node.name.getText();
    const params = node.parameters.map((p) => {
      const pName = p.name.getText();
      const pType = p.type ? this.mapType(p.type) : "any";
      return `${pName}:${pType}`;
    }).join(", ");
    
    const retType = node.type ? this.mapType(node.type) : "void";
    const bodyStr = node.body ? this.summarizeBody(node.body, "    ") : "";
    
    return `${name}(${params})->${retType}:${bodyStr ? "\n" + bodyStr : " void"}`;
  }

  private formatFunction(node: ts.FunctionDeclaration): string {
    const name = node.name ? node.name.getText() : "anonymous";
    const params = node.parameters.map((p) => {
      const pName = p.name.getText();
      const pType = p.type ? this.mapType(p.type) : "any";
      return `${pName}:${pType}`;
    }).join(", ");
    
    const retType = node.type ? this.mapType(node.type) : "void";
    const bodyStr = node.body ? this.summarizeBody(node.body, "    ") : "";
    
    return `${name}(${params})->${retType}:${bodyStr ? "\n" + bodyStr : " void"}`;
  }

  private formatExportedHook(name: string, init: ts.ArrowFunction | ts.FunctionExpression): string {
    const params = init.parameters.map((p) => {
      const pName = p.name.getText();
      const pType = p.type ? this.mapType(p.type) : "any";
      return `${pName}:${pType}`;
    }).join(", ");

    let bodyStr = "";
    if (init.body) {
      if (ts.isBlock(init.body)) {
        bodyStr = this.summarizeBody(init.body, "    ");
      } else {
        bodyStr = `    RETURN ${this.exprToString(init.body)}`;
      }
    }

    return `${name}(${params}) ->\n${bodyStr}`;
  }

  // --- TYPE MAPPER ---

  private mapType(node: ts.TypeNode | undefined): string {
    if (!node) return "any";

    switch (node.kind) {
      case ts.SyntaxKind.StringKeyword: return "S";
      case ts.SyntaxKind.NumberKeyword: return "N";
      case ts.SyntaxKind.BooleanKeyword: return "B";
      case ts.SyntaxKind.VoidKeyword: return "void";
      case ts.SyntaxKind.AnyKeyword: return "any";
      case ts.SyntaxKind.UnknownKeyword: return "unknown";
      case ts.SyntaxKind.UndefinedKeyword: return "undefined";
      case ts.SyntaxKind.NullKeyword: return "null";
    }

    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText();
      if (name === "string") return "S";
      if (name === "number") return "N";
      if (name === "boolean") return "B";
      if (name === "Date") return "D";

      if (node.typeArguments && node.typeArguments.length > 0) {
        const args = node.typeArguments.map((t) => this.mapType(t)).join(", ");
        return `${name}<${args}>`;
      }
      return name;
    }

    if (ts.isArrayTypeNode(node)) {
      return `${this.mapType(node.elementType)}[]`;
    }

    if (ts.isUnionTypeNode(node)) {
      return node.types.map((t) => this.mapType(t)).join("|");
    }

    if (ts.isLiteralTypeNode(node)) {
      return node.literal.getText();
    }

    if (ts.isFunctionTypeNode(node)) {
      const params = node.parameters.map((p) => this.mapType(p.type)).join(", ");
      const ret = this.mapType(node.type);
      return `(${params})->${ret}`;
    }

    return node.getText();
  }

  // --- EXPRESSION AND STATEMENT SUMMARIZERS ---

  private exprToString(expr: ts.Expression): string {
    if (ts.isIdentifier(expr)) {
      return expr.text;
    }
    if (ts.isStringLiteral(expr)) {
      return `"${expr.text}"`;
    }
    if (ts.isNoSubstitutionTemplateLiteral(expr)) {
      return `\`${expr.text}\``;
    }
    if (ts.isNumericLiteral(expr) || expr.kind === ts.SyntaxKind.TrueKeyword || expr.kind === ts.SyntaxKind.FalseKeyword || expr.kind === ts.SyntaxKind.NullKeyword) {
      return expr.getText();
    }
    if (ts.isPropertyAccessExpression(expr)) {
      return `${this.exprToString(expr.expression)}.${expr.name.text}`;
    }
    if (ts.isAwaitExpression(expr)) {
      return `await ${this.exprToString(expr.expression)}`;
    }
    if (ts.isCallExpression(expr)) {
      const caller = this.exprToString(expr.expression);
      const args = expr.arguments.map((a) => this.exprToString(a)).join(",");
      
      if (caller === "useCallback") {
        const callback = expr.arguments[0];
        const deps = expr.arguments[1] ? this.exprToString(expr.arguments[1]) : "";
        if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
          const params = callback.parameters.map((p) => p.name.getText()).join(",");
          const body = ts.isBlock(callback.body) 
            ? this.summarizeBody(callback.body, "").trim()
            : this.exprToString(callback.body);
          return `useCallback((${params})=>${body},${deps})`;
        }
      }
      return `${caller}(${args})`;
    }
    if (ts.isBinaryExpression(expr)) {
      return `${this.exprToString(expr.left)}${expr.operatorToken.getText()}${this.exprToString(expr.right)}`;
    }
    if (ts.isPrefixUnaryExpression(expr)) {
      return `${ts.tokenToString(expr.operator)}${this.exprToString(expr.operand)}`;
    }
    if (ts.isPostfixUnaryExpression(expr)) {
      return `${this.exprToString(expr.operand)}${ts.tokenToString(expr.operator)}`;
    }
    if (ts.isNewExpression(expr)) {
      const cls = this.exprToString(expr.expression);
      const args = expr.arguments ? expr.arguments.map((a) => this.exprToString(a)).join(",") : "";
      return `new ${cls}(${args})`;
    }
    if (ts.isObjectLiteralExpression(expr)) {
      const props = expr.properties.map((p) => {
        if (ts.isPropertyAssignment(p)) {
          const name = p.name.getText();
          const val = this.exprToString(p.initializer);
          return `${name}:${val}`;
        }
        if (ts.isShorthandPropertyAssignment(p)) {
          return p.name.getText();
        }
        if (ts.isSpreadAssignment(p)) {
          return `...${this.exprToString(p.expression)}`;
        }
        return p.getText();
      }).join(",");
      return `{${props}}`;
    }
    if (ts.isArrayLiteralExpression(expr)) {
      const elems = expr.elements.map((e) => this.exprToString(e)).join(",");
      return `[${elems}]`;
    }
    if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
      const params = expr.parameters.map((p) => p.name.getText()).join(",");
      let body = "...";
      if (expr.body) {
        if (ts.isBlock(expr.body)) {
          body = this.summarizeBody(expr.body, "").trim();
        } else {
          body = this.exprToString(expr.body);
        }
      }
      return `(${params})=>${body}`;
    }
    if (ts.isTemplateExpression(expr)) {
      let result = "\`" + expr.head.text;
      expr.templateSpans.forEach((span) => {
        result += `\$\{${this.exprToString(span.expression)}\}${span.literal.text}`;
      });
      return result + "\`";
    }
    return expr.getText().replace(/\s+/g, "");
  }

  private summarizeBody(body: ts.Block, indent: string): string {
    const lines: string[] = [];
    body.statements.forEach((stmt) => {
      const summarized = this.summarizeStatement(stmt, indent);
      if (summarized) {
        lines.push(summarized);
      }
    });
    return lines.join("\n");
  }

  private summarizeStatement(stmt: ts.Statement, indent: string): string {
    if (ts.isIfStatement(stmt)) {
      const cond = this.exprToString(stmt.expression);
      const isGuard = this.checkIfGuard(stmt.thenStatement);
      if (isGuard) {
        const action = this.summarizeStatement(stmt.thenStatement, "").trim();
        return `${indent}GUARD ${cond} ${action}`;
      } else {
        const thenStr = this.summarizeStatement(stmt.thenStatement, "").trim();
        let elseStr = "";
        if (stmt.elseStatement) {
          elseStr = " ELSE " + this.summarizeStatement(stmt.elseStatement, "").trim();
        }
        return `${indent}IF ${cond}: ${thenStr}${elseStr}`;
      }
    }

    if (ts.isThrowStatement(stmt)) {
      const expr = stmt.expression ? this.exprToString(stmt.expression) : "";
      return `${indent}THROW ${expr}`;
    }

    if (ts.isReturnStatement(stmt)) {
      const expr = stmt.expression ? this.exprToString(stmt.expression) : "void";
      return `${indent}RETURN ${expr}`;
    }

    if (ts.isTryStatement(stmt)) {
      const tryLines: string[] = [];
      stmt.tryBlock.statements.forEach((s) => {
        const line = this.summarizeStatement(s, "").trim();
        if (line) tryLines.push(line);
      });
      let catchStr = "";
      if (stmt.catchClause) {
        const catchLines: string[] = [];
        stmt.catchClause.block.statements.forEach((s) => {
          const line = this.summarizeStatement(s, "").trim();
          if (line) catchLines.push(line);
        });
        catchStr = ` CATCH: ${catchLines.join(", ")}`;
      }
      return `${indent}TRY: ${tryLines.join(", ")}${catchStr}`;
    }

    if (ts.isVariableStatement(stmt)) {
      const decls = stmt.declarationList.declarations;
      const summaries = decls.map((decl) => {
        const name = decl.name.getText();
        const init = decl.initializer ? this.exprToString(decl.initializer) : "";
        if (init) {
          if (ts.isObjectBindingPattern(decl.name) || ts.isArrayBindingPattern(decl.name)) {
            return `DESTRUCTURE ${name} = ${init}`;
          }
          return `${name} = ${init}`;
        }
        return name;
      });
      return `${indent}${summaries.join(", ")}`;
    }

    if (ts.isExpressionStatement(stmt)) {
      const exprStr = this.exprToString(stmt.expression);
      if (exprStr.startsWith("console.") || exprStr.startsWith("logger.")) {
        return "";
      }
      return `${indent}${exprStr}`;
    }

    if (ts.isBlock(stmt)) {
      const sep = indent === "" ? ", " : "\n";
      return stmt.statements.map((s) => this.summarizeStatement(s, indent)).filter(Boolean).join(sep);
    }

    if (ts.isForOfStatement(stmt) || ts.isForInStatement(stmt) || ts.isForStatement(stmt)) {
      const loopVar = ts.isForOfStatement(stmt) || ts.isForInStatement(stmt) ? stmt.initializer.getText() : "i";
      const expr = ts.isForOfStatement(stmt) || ts.isForInStatement(stmt) ? this.exprToString(stmt.expression) : "";
      const body = this.summarizeStatement(stmt.statement, "").trim();
      return `${indent}SCAN ${expr} FOR ${loopVar} -> ${body}`;
    }

    return `${indent}${stmt.getText().trim().substring(0, 80)}`;
  }

  private checkIfGuard(stmt: ts.Statement): boolean {
    if (ts.isThrowStatement(stmt) || ts.isReturnStatement(stmt)) {
      return true;
    }
    if (ts.isBlock(stmt) && stmt.statements.length === 1) {
      const first = stmt.statements[0];
      return !!first && this.checkIfGuard(first);
    }
    return false;
  }

  private isExported(node: ts.Node): boolean {
    return (
      (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0 ||
      (!!node.parent && node.parent.kind === ts.SyntaxKind.SourceFile && ts.isExportAssignment(node))
    );
  }

  private hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    return !!modifiers && modifiers.some((m) => m.kind === kind);
  }
}
