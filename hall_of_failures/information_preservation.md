# Information Preservation Failures

# Hall of Failures

This document formalizes parser extraction failures to guide the CGE compiler's evolution. Every missing architectural semantic becomes an empirical test case for the next version.

## 1. Express Middleware Routes

**Repository:** `express-middleware`

**Question:**
Which endpoint is public?

**Failure:**
Route callback omitted (`app.get('/health', ...)`), leading the agent to hallucinate that there were no public endpoints.

**Root Cause:**
Route architecture was not represented as a top-level construct; AST expression statements were stripped by the heuristic.

**Fix:**
Introduced the `ROUTES:` block to capture endpoints natively.

**Version Introduced:**
CGE 1.1

---

## 2. React Hook Dependencies

**Repository:** `react-dashboard`

**Question:**
What triggers the dashboard to re-fetch data?

**Failure:**
Hook dependency arrays (`useEffect(..., [deps])`) were omitted.

**Root Cause:**
React hooks were flattened into single-line operations without tracking the dependency array argument.

**Fix:**
Pending

**Version Introduced:**
CGE 1.0

---

## 3. Python Decorators

**Repository:** `flask-api`

**Question:**
Which endpoints require authentication?

**Failure:**
`@require_auth` decorators were completely omitted from the CGE output.

**Root Cause:**
The Python heuristic parser did not look for `@` symbols preceding method definitions.

**Fix:**
Pending

**Version Introduced:**
CGE 1.0
