# Cognitive Graph Encoding (CGE) Specification v1.0

This document defines the formal grammar, syntax rules, and token mapping standards for **Cognitive Graph Encoding (CGE) version 1.0**. 

CGE/1.0 is a highly dense, LLM-optimized pseudo-code notation designed to represent the structural layout, type interfaces, state properties, and logic control flows of software programs. Its primary goal is to minimize token consumption in Large Language Model (LLM) context windows while preserving high-fidelity semantic comprehension and reasoning capability.

---

## 1. Document Structure & Core Sections

A CGE/1.0 document is represented as a plain text block divided into distinct, standardized uppercase sections. Each section must be formatted as follows:

```
CGE/1.0 <ComponentName> [<ContextDetails>]

IMPORTS:
  <import_declaration_1>
  <import_declaration_2>

TYPES:
  <type_definition_1>
  <type_definition_2>

STATE:
  <state_property_1>
  <state_property_2>

OPS:
  <public_operation_1>
  <public_operation_2>

PRIVATE:
  <private_helper_1>
  <private_helper_2>

EXPORTS: <export_list>
```

---

## 2. Structural Types & Native Mappings

To maximize token density, CGE/1.0 collapses standard programming primitives into single-character tokens:

| Verbatim TypeScript Type | CGE/1.0 Token | Description |
|---|---|---|
| `string` | `S` | Represents all text/string primitives |
| `number` | `N` | Represents integer and floating-point primitives |
| `boolean` | `B` | Represents logical true/false primitives |
| `Date` | `D` | Represents dates, timestamps, and datetime objects |
| `void` | `void` | Represents empty/non-returning operations |
| `any` / `unknown` | `any` / `unknown` | Preserved for wildcards |
| `Promise<T>` | `Promise<T>` | Generic wrapper for asynchronous tasks |
| `Array<T>` / `T[]` | `T[]` | Flat collections of a specific type |
| `Map<K, V>` | `Map<K, V>` | Hash/dictionary collections |
| `Set<T>` | `Set<T>` | Collections of unique items |

---

## 3. Structural Grammar & Rules

### 3.1 Type & Interface Definitions
Types and interfaces are serialized into unified structural notations using curly braces `{}`. Keys are separated by commas. Optional fields are marked with `?`.

* **Syntax**: `TypeName{key1: Type, key2?: Type}`
* **TypeScript Original**:
  ```typescript
  interface UserProfile {
    id: string;
    email: string;
    displayName?: string;
    createdAt: Date;
  }
  ```
* **CGE/1.0 Representation**:
  ```
  UserProfile{id:S, email:S, displayName?:S, createdAt:D}
  ```

### 3.2 State & Constants
Class variables and module scope declarations are placed under `STATE:`. 
* Constants are explicitly prefixed with `CONST`.
* Types are mapped using our primitive dictionary.
* Default initializers are simplified.
* **CGE/1.0 Representation**:
  ```
  STATE:
    users:Map<S, UserProfile> = new Map()
    CONST TOKEN_EXPIRY_MS:N = 900000
  ```

### 3.3 Operations (OPS & PRIVATE)
Methods and functions are placed under `OPS:` (public/exported entry points) or `PRIVATE:` (internal helpers).

* **Signature Syntax**: `functionName(param1: Type, param2: Type)->ReturnType:`
* **Function Body Summary Rules**:
  * **Sequential Statements**: Code blocks are collapsed into single, comma-separated statements on a single line where possible to compress whitespace.
  * **Variables**: Prefixed by direct assignments, stripping keywords like `let`, `var`, or `const`. Destructuring is marked with `DESTRUCTURE`.
    * *Example*: `DESTRUCTURE { uid } = authUser`

---

## 4. Logical Control Flow Compressors

To eliminate raw language boilerplate, CGE/1.0 introduces semantic logic compressors:

### 4.1 The `GUARD` Operator
Replaces standard defensive check conditionals (`if-throw` or `if-return` blocks) into a flat, highly readable conditional check.
* **Syntax**: `GUARD <condition> [THROW <error>] / [RETURN <value>]`
* **TypeScript Original**:
  ```typescript
  if (!user) {
    throw new Error("User not found");
  }
  ```
* **CGE/1.0 Representation**:
  ```
  GUARD !user THROW "not_found"
  ```

### 4.2 The `SCAN` Operator
Collapses recursive traversals, loops, and iterations into a high-level query expression.
* **Syntax**: `SCAN <collection> FOR <iterator> -> <block>`
* **TypeScript Original**:
  ```typescript
  for (const [email, user] of this.users) {
    if (user.id === targetId) return user;
  }
  ```
* **CGE/1.0 Representation**:
  ```
  SCAN users FOR [email, user] -> GUARD user.id==targetId RETURN user
  ```

### 4.3 The `TRY / CATCH` Operator
Combines multi-line exception handling blocks into a flat, inline expression.
* **Syntax**: `TRY: <statements> CATCH: <statements>`
* **TypeScript Original**:
  ```typescript
  try {
    const cred = await signIn(email, pass);
    return cred.user;
  } catch (error) {
    report(error);
    return null;
  }
  ```
* **CGE/1.0 Representation**:
  ```
  TRY: cred = signIn(email, pass), RETURN cred.user CATCH: report(error), RETURN null
  ```
