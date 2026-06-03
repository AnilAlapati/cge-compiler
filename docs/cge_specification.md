# Cognitive Graph Encoding (CGE) Specification v1.0

This document defines the formal grammar, reserved keywords, syntax rules, and type mapping standards for **Cognitive Graph Encoding (CGE) version 1.0**.

CGE/1.0 is a highly dense, deterministic, AST-derived pseudo-code notation designed to represent the structural layout, type interfaces, state properties, and logic control flows of software programs. Its primary goal is to minimize token consumption in Large Language Model (LLM) context windows while preserving high-fidelity semantic comprehension and reasoning capability.

---

## 1. Formal Grammar (EBNF)

The structural grammar of CGE/1.0 is formally defined below using Extended Backus-Naur Form (EBNF):

```ebnf
(* Top-level document structure *)
cge_document     ::= header_line [newline] [imports_section] [types_section] [state_section] [ops_section] [private_section] [exports_line]

header_line      ::= "CGE/" version " " component_name " (" language ")"

version          ::= digit+ "." digit+
component_name   ::= identifier
language         ::= "TypeScript" | "Python" | "Rust" | "Go" | "Cpp" | identifier

(* Sections *)
imports_section  ::= "IMPORTS:" newline { import_item newline }
types_section    ::= "TYPES:" newline { type_definition newline }
state_section    ::= "STATE:" newline { state_definition newline }
ops_section      ::= "OPS:" newline { operation_definition [newline] }
private_section  ::= "PRIVATE:" newline { operation_definition [newline] }
exports_line     ::= "EXPORTS:" " " identifier { "," " " identifier }

(* Section Items & Core Grammars *)
import_item      ::= [ identifier_list " from " ] module_name
identifier_list  ::= identifier | "{" identifier { "," " " identifier } "}"
module_name      ::= identifier | string_literal | relative_path

type_definition  ::= [ "EXPORT " ] identifier ( structure_type | alias_type )
structure_type   ::= "{" member_field { "," " " member_field } "}"
alias_type       ::= " = " type_signature { "|" type_signature }
member_field     ::= identifier [ "?" ] ":" type_signature

state_definition ::= [ "EXPORT " ] [ "CONST " ] identifier ":" type_signature [ " = " expression ]

route_definition ::= method " " path [ "->" middleware_list ] [ "->" handler ]
method           ::= "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "ALL"
path             ::= string_literal
middleware_list  ::= identifier { "," " " identifier }
handler          ::= identifier

operation_definition ::= [ "EXPORT " ] identifier "(" [ parameter_list ] ")" "->" type_signature ":" ( " void" | newline block )

parameter_list   ::= parameter { "," " " parameter }
parameter        ::= identifier ":" type_signature

block            ::= { indent statement newline } | middleware_def | permissions_def | dependencies_def

middleware_def   ::= "MIDDLEWARE:" identifier_list
permissions_def  ::= "PERMISSIONS:" { statement newline }
dependencies_def ::= "DEPENDENCIES:" { statement newline }

(* Statements & Control Flow Operators *)
statement        ::= guard_statement
                   | scan_statement
                   | try_catch_statement
                   | assignment_statement
                   | return_statement
                   | throw_statement
                   | expression

guard_statement  ::= "GUARD " expression ( " RETURN " expression | " THROW " expression )
scan_statement   ::= "SCAN " expression " FOR " identifier " -> " statement
try_catch_statement ::= "TRY: " statement_list " CATCH: " statement_list
statement_list   ::= statement { "," " " statement }

assignment_statement ::= [ "DESTRUCTURE " ] expression " = " expression
return_statement ::= "RETURN " ( "void" | expression )
throw_statement  ::= "THROW " expression

(* Basic Primitives *)
type_signature   ::= primitive_type | collection_type | custom_type
primitive_type   ::= "S" | "N" | "B" | "D" | "void" | "any" | "unknown"
collection_type  ::= type_signature "[]" | "Map<" type_signature "," " " type_signature ">" | "Set<" type_signature ">"
custom_type      ::= identifier [ "<" type_signature { "," " " type_signature } ">" ]

identifier       ::= ( letter | "_" ) { letter | digit | "_" | "." }
expression       ::= (* Standard algebraic and boolean expressions, method calls, and property paths *)
string_literal   ::= '"' { all_characters - '"' } '"' | "'" { all_characters - "'" } "'"
relative_path    ::= { "." | "/" | identifier }

digit            ::= "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
letter           ::= "a" | "b" | ... | "z" | "A" | "B" | ... | "Z"
newline          ::= "\n"
indent           ::= "    "
```

---

## 2. Reserved Keywords

The following tokens are reserved keywords in CGE/1.0. They represent structural boundaries, primitive shorthands, and semantic compressors:

| Keyword | Category | Description |
|---|---|---|
| `CGE/` | Document Header | Document indicator (must be at index 0 of line 1) |
| `IMPORTS:` | Section Header | Precedes dependency references |
| `TYPES:` | Section Header | Precedes interface and type structure mappings |
| `STATE:` | Section Header | Precedes constants and global state declarations |
| `ROUTES:` | Section Header | Precedes endpoint mappings and middleware definitions |
| `MIDDLEWARE:` | Section Header | Precedes global middleware and interceptors |
| `PERMISSIONS:` | Section Header | Precedes authorization bounds and role checks |
| `DEPENDENCIES:` | Section Header | Precedes external service instantiation (DBs, Clients) |
| `OPS:` | Section Header | Precedes public operations and method signatures |
| `PRIVATE:` | Section Header | Precedes internal helper functions and private methods |
| `EXPORTS:` | Document Footer | Lists exported symbols for dependency graph compilation |
| `EXPORT` | Modifier | Explicitly tags a type, state, or operation as exported |
| `CONST` | Modifier | Tag indicating read-only/immutable state |
| `GUARD` | Control Operator | Collapses condition checks and guard clauses |
| `SCAN` | Control Operator | Collapses iterator loops and collections queries |
| `TRY:` | Control Operator | Signals flat inline exception handler checks |
| `CATCH:` | Control Operator | Signals flat fallback behavior for exceptions |
| `RETURN` | Flow Keyword | Directs execution output |
| `THROW` | Flow Keyword | Raises error/exception blocks |
| `DESTRUCTURE` | Statement Prefix | Demarcates object/array destructured assignments |

---

## 3. Primitives & Shorthands

To maximize token density, standard primitives are folded into single-character symbols:

| Primitive Code | Verbatim Type Equivalence | Description |
|---|---|---|
| `S` | `string` / `char` / `std::string` | Represents all text/string primitives |
| `N` | `number` / `int` / `float` / `double` | Represents numeric primitives |
| `B` | `boolean` / `bool` | Represents logical true/false primitives |
| `D` | `Date` / `datetime` / `time.Time` | Represents timestamps and datetimes |
| `void` | `void` / `()` | Represents empty/non-returning operations |
| `any` | `any` / `interface{}` / `unknown` | Wildcards and untyped structures |

---

## 4. Syntax & Normalization Rules

To ensure deterministic, reproducible compilation, all parsers must adhere to the following normalization criteria:

### 4.1 Whitespace Compression
- A single indent level must be exactly 4 spaces (`    `).
- Statements within operations are collapsed into single comma-separated lists where possible (e.g. under `TRY/CATCH` blocks) to compress lines.
- All empty lines within operation bodies are stripped.

### 4.2 Expression Literalism
To maintain semantic clarity while compressing syntax, literal sub-expressions within conditional bounds (such as method checks or property checks) must be preserved verbatim.
- **Example**: `if (user.role === "admin")` compiles to `GUARD user.role === "admin"`
- **Example**: `if (user.permissions.includes("admin"))` compiles to `GUARD user.permissions.includes("admin")`
- *Parser Warning*: Parsers must not abstract these into identical CGE shorthand, as doing so would hide functional implementation differences from LLM attention heads.

---

## 5. Versioning & Compatibility Rules

Future iterations of the CGE specification must adhere to the following rules:

1. **Semantic Versioning**: Standard major.minor naming (e.g., CGE/1.1, CGE/2.0).
2. **Backward Compatibility**: Any document written in CGE/1.0 must be parseable by a CGE/1.x reader. New syntax or modifiers (e.g., pragma preserves) will be introduced as optional modifiers.
3. **Major Upgrades**: If keyword behaviors or primitive codes change (e.g., redefining `S` or deprecating `GUARD`), the major version will increment (CGE/2.0). Downstream reasoning models must be prompted with the corresponding spec version when parsing.
