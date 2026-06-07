# Phase 3 Anomaly Analysis: nestjs-realworld Gen Map+Raw Regression

> **Date:** 2026-06-03
> **Commit:** 551f76445230c1eaedb07288aaa4d7ef3eef8625

---

## Anomaly Summary

The `nestjs-realworld` repository exhibited an unexpected pattern: **Raw=100%, Gen Map=100%, Gen Map+Raw=90%**. Adding the architecture map to the raw source context *reduced* accuracy by 10% (1 out of 10 questions failed), despite both individual modes achieving perfect scores.

---

## Failure Detail

| Field | Value |
| ----- | ----- |
| **Failure ID** | `nestjs-realworld/task_6` |
| **Question** | What middleware is applied to the Profile module routes? |
| **Expected Answer** | `AuthMiddleware` |
| **Model Answer** | "The middleware applied to the Profile module routes is the `AuthMiddleware`. It is configured to be applied for all routes under the path `profiles/:username/follow`." |
| **Mode** | Gen Map + Raw |
| **Raw Only Result** | ✅ Pass (100%) |
| **Gen Map Only Result** | ✅ Pass (100%) |

---

## Root Cause Analysis

### 1. The model's answer is factually correct

The model correctly identified `AuthMiddleware` as the middleware applied to Profile module routes. This is verifiable from the source code — the `ProfileModule` class uses `configure(consumer)` to apply `AuthMiddleware` via `consumer.apply(AuthMiddleware).forRoutes(...)`.

### 2. The failure is a **judge false-negative**, not a reasoning regression

The semantic judge (`gpt-4o-mini`) compared the model's response against the expected answer `"AuthMiddleware"`. While the model's answer *contains* the expected value, the judge appears to have rejected it because:

- **Extra contextual explanation**: The model added explanatory text — *"It is configured to be applied for all routes under the path `profiles/:username/follow`"* — which introduced noise for the judge's semantic matching.
- **Strict matching semantics**: The judge likely interprets the answer as containing more than just the expected keyword, and the additional route-specific detail may have been interpreted as a *different* or *narrowed* answer (i.e., middleware only for `follow` routes rather than all profile routes).

### 3. Why does this only fail in Gen Map+Raw mode?

When the architecture map is prepended to raw source, the model has **more context about route structures**. This likely prompted the LLM to be more specific in its answer — elaborating on *which* routes the middleware covers — rather than giving the terse answer `"AuthMiddleware"` that the judge expects.

In Raw-only and Gen Map-only modes, the model gave a sufficiently concise answer that passed the judge. The combined context encouraged over-explanation.

### 4. Classification

| Category | Assessment |
| -------- | ---------- |
| **Reasoning regression?** | ❌ No — the model correctly identified the middleware |
| **Generator failure?** | ❌ No — the architecture map data was accurate |
| **Judge false-negative?** | ✅ **Yes** — the judge penalized a correct but verbose answer |
| **Extra explanation issue?** | ✅ **Yes** — additional route context triggered the false negative |

---

## Impact Assessment

- **Severity**: Low — the underlying LLM reasoning is correct
- **Affected metric**: Gen Map+Raw accuracy for `nestjs-realworld` drops from 100% to 90%
- **True accuracy** (accounting for false negative): 100%
- **Adjusted Phase 3 lift**: Without this false negative, Gen Map+Raw would match or exceed Raw on **all 4** repositories

---

## Recommendations

1. **Judge improvement**: Implement a more robust "contains expected answer" check for single-value expected answers (strings, not arrays). The judge should pass if the expected value appears as a semantic match within the response, regardless of additional explanatory text.
2. **Prompt engineering**: Consider instructing the LLM to give concise, keyword-only answers for identification questions (e.g., "Name the middleware" → expect just the name).
3. **No generator changes needed**: The architecture map correctly captured middleware information.

---

## Conclusion

This is a **judge false-negative**, not a reasoning regression. The model's answer is factually correct and contains the expected value. The combined Gen Map+Raw context encouraged the LLM to provide additional (correct) detail that the strict semantic judge rejected. The true Gen Map+Raw accuracy for `nestjs-realworld` is effectively **100%**.
