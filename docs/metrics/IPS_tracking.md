# Information Preservation Score (IPS) Tracking

The Information Preservation Score (IPS) is a parser-quality metric independent of LLM behavior. It tracks what percentage of high-value architectural semantics and codebase structures the Cognitive Graph Encoding (CGE) compiler successfully preserves from the raw Abstract Syntax Tree (AST).

## Feature Preservation Matrix

| Feature | Description | Status |
|---|---|---|
| **Types** | Interfaces, type aliases, and structs. | ✅ |
| **State** | Global variables, constants, and module state. | ✅ |
| **Imports** | Dependency imports and aliases. | ✅ |
| **Operations** | Exported and private functions/methods. | ✅ |
| **Control Flow** | Guard bounds (`if`), throws, loops (`SCAN`). | ✅ |
| **Routes** | Explicit API endpoint mappings. | ✅ |
| **Middleware** | Global and route-level request interceptors. | ⏳ In Progress |
| **Permissions** | Role checks, auth tokens, decorators. | ⏳ In Progress |
| **Dependencies** | Database/Service client instantiations. | ⏳ In Progress |
| **React Hooks** | Dependency arrays for `useEffect`/`useMemo`. | ❌ Pending |
| **Decorators** | Python `@decorator` annotations. | ❌ Pending |

## Historical IPS Scores

- **CGE v1.0**: ~45% (Types, State, Imports, Ops, Control Flow)
- **CGE v1.1**: ~54% (+ Routes)
- **CGE v1.2**: Target ~81% (+ Middleware, Permissions, Dependencies)
