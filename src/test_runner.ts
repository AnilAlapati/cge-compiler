import { CGECompiler } from "./cge_compiler";
import * as assert from "assert";

/**
 * Automated test suite for CGE Compiler Multi-Language Adapters.
 */
function runTests() {
  console.log("🧬 Starting CGE Compiler Multi-Language Test Suite...\n");

  const compiler = new CGECompiler();

  // =========================================================================
  // 1. TypeScript Compiler Tests
  // =========================================================================
  console.log("🔹 Running TypeScript Parser Tests...");
  const tsCode = `
    import { useState } from "react";
    
    export interface User {
      id: string;
      email: string;
      isActive: boolean;
    }

    export const useAuth = (email: string) => {
      if (!email) throw new Error("no_email");
      return { loggedIn: true };
    };

    export class AuthService {
      private endpoint: string = "api/auth";

      public async login(email: string): Promise<string> {
        if (!email) {
          throw new Error("invalid");
        }
        return "token123";
      }
    }
  `;

  const tsCGE = compiler.compileCode(tsCode, "typescript", "AuthService.ts");
  console.log("TypeScript CGE Output:\n", tsCGE);
  
  assert.ok(tsCGE.includes("CGE/1.0 AuthService (TypeScript)"), "TS Header assertion failed");
  assert.ok(tsCGE.includes("EXPORT User{id:S, email:S, isActive:B}"), "TS Interface type folding assertion failed");
  assert.ok(tsCGE.includes("EXPORT useAuth(email:S)"), "TS Exported Hook assertion failed");
  assert.ok(tsCGE.includes("GUARD !email THROW new Error(\"no_email\")"), "TS Hook Guard statement assertion failed");
  assert.ok(tsCGE.includes("EXPORT AuthService.login(email:S)->Promise<S>:\n    GUARD !email THROW new Error(\"invalid\")"), "TS Method Guard statement assertion failed");
  assert.ok(tsCGE.includes("EXPORTS: User, useAuth, AuthService"), "TS Exports list assertion failed");
  console.log("✅ TypeScript Parser: PASSED");

  // =========================================================================
  // 2. Python Compiler Tests
  // =========================================================================
  console.log("🔹 Running Python Parser Tests...");
  const pyCode = `
from datetime import datetime
from typing import List, Optional

class UserProfile:
    id: str
    email: str
    created_at: datetime

TOKEN_EXPIRY = 900000

def _get_hash(password: str) -> str:
    return "hashed"

def verify_user(user: UserProfile) -> bool:
    if not user:
        raise ValueError("missing_user")
    
    for item in user.items:
        if item.val == 10:
            return True
            
    return False
  `;

  const pyCGE = compiler.compileCode(pyCode, "python", "user_profile.py");
  console.log("Python CGE Output:\n", pyCGE);
  
  assert.ok(pyCGE.includes("CGE/1.0 user_profile (Python)"), "Python Header assertion failed");
  assert.ok(pyCGE.includes("UserProfile{id:S, email:S, created_at:D}"), "Python Class mapping failed");
  assert.ok(pyCGE.includes("CONST TOKEN_EXPIRY:any = 900000"), "Python Constant mapping failed");
  assert.ok(pyCGE.includes("PRIVATE:\n  _get_hash(password:S)->S:"), "Python Private Op mapping failed");
  assert.ok(pyCGE.includes("verify_user(user:UserProfile)->B:"), "Python Public Op mapping failed");
  assert.ok(pyCGE.includes("GUARD not user THROW ValueError(\"missing_user\")"), "Python Guard statement failed");
  assert.ok(pyCGE.includes("SCAN user.items FOR item -> GUARD item.val == 10 RETURN True"), "Python SCAN loop statement failed");
  console.log("✅ Python Parser: PASSED");

  // =========================================================================
  // 3. Rust Compiler Tests
  // =========================================================================
  console.log("🔹 Running Rust Parser Tests...");
  const rustCode = `
    use std::collections::HashMap;

    pub struct UserSession {
        pub token: String,
        pub user_id: u64,
    }

    pub enum UserRole {
        Admin,
        User,
    }

    const MAX_ATTEMPTS: u32 = 5;

    pub fn validate(session: UserSession) -> bool {
        if session.token.is_empty() {
            return false;
        }
        true
    }

    fn internal_check() -> () {
        println!("internal");
    }
  `;

  const rustCGE = compiler.compileCode(rustCode, "rust", "session.rs");
  console.log("Rust CGE Output:\n", rustCGE);
  
  assert.ok(rustCGE.includes("CGE/1.0 session (Rust)"), "Rust Header assertion failed");
  assert.ok(rustCGE.includes("UserSession{token:S, user_id:N}"), "Rust Struct mapping failed");
  assert.ok(rustCGE.includes("UserRole = Admin|User"), "Rust Enum mapping failed");
  assert.ok(rustCGE.includes("CONST MAX_ATTEMPTS:N = 5"), "Rust Constant mapping failed");
  assert.ok(rustCGE.includes("validate(session:UserSession)->B:"), "Rust Public Op signature failed");
  assert.ok(rustCGE.includes("GUARD session.token.is_empty() RETURN false"), "Rust Guard statement mapping failed");
  assert.ok(rustCGE.includes("PRIVATE:\n  internal_check()->void:"), "Rust Private Op mapping failed");
  console.log("✅ Rust Parser: PASSED");

  console.log("\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🧬");
}

try {
  runTests();
} catch (error) {
  console.error("\n❌ TEST FAILURE ENCOUNTERED:");
  console.error(error);
  process.exit(1);
}
