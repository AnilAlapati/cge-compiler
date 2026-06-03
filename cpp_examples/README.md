# C++ CGE Compilation Example

This folder contains a concrete, production-style C++ module and its compiled CGE/1.0 output to demonstrate the compiler's capability and boundaries when parsing C++.

## Files
- [auth_manager.cpp](file:///Users/anilalapati/Development/cge-compiler/cpp_examples/auth_manager.cpp): Source code featuring namespaces, standard types (`std::string`, `std::vector`, `std::map`), structs, classes, access modifiers (`private`/`public`), structured loops, and conditionals.
- [auth_manager.cge](file:///Users/anilalapati/Development/cge-compiler/cpp_examples/auth_manager.cge): Compiled CGE structural graph.

## Mappings Demonstrated

1. **Primitive & Collection Type Folding**:
   - `std::string` folds to `S`
   - `long` folds to `N`
   - `std::vector<std::string>` folds to `S[]`
   - Access modifiers (like `public:`) are parsed, adding `EXPORT` prefixes to members and method signatures.
   
2. **State Isolation**:
   - Class-level member variables (e.g., `secretKey`, `activeSessions`) are detached and serialized into the `STATE:` block.
   - Global constants (e.g., `const int MAX_LOGIN_ATTEMPTS`) are prefixed with `CONST` and mapped to CGE state.

3. **Operations & Control Flow**:
   - Method signatures are unified (e.g. `bool login(...)` becomes `AuthManager.login(email:S, password:S)->B:`).
   - Early `if-throw` and `if-return` boundaries are collapsed into flat `GUARD` expressions.
   - Private helpers are routed under `PRIVATE:` (e.g. `AuthManager.logEvent`).

---

## Technical Limitations with C++ Parsing

C++ is notoriously difficult to parse without a full compiler frontend (like Clang). Because the CGE parser currently relies on a lightweight **Heuristic Extraction Parser** for client-side execution speed, it operates with the following constraints:

1. **Preprocessor Macros**: Directives like `#define`, `#ifdef`, or `#pragma` are ignored by the heuristic engine.
2. **Template Metaprogramming**: High-level templates (e.g., SFINAE, concepts, or complex trait types) will simplify down to `any` or the literal template text without expansion.
3. **Deeply Nested Code Blocks**: As shown in the `verifySession` method, nested loops/if checks (such as a double-nested loop checking conditions) are preserved with literal code indentation rather than collapsed into clean `SCAN` operators, as the heuristic engine does not maintain a complete block-scope stack.
4. **Header Files (.h/.hpp)**: Headers and implementation files must compile independently; inline definitions inside headers parse cleanly, but external references are mapped based on local syntax.

To run full AST resolution for enterprise C++ repositories, CGE plans to integrate a **Tree-sitter** backend in version 1.1.
