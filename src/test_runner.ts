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
  
  // =========================================================================
  // 4. Go Compiler Tests
  // =========================================================================
  console.log("🔹 Running Go Parser Tests...");
  const goCode = `
    package main
    import "time"

    type Config struct {
        Endpoint string
        Timeout  int
    }

    type Processor interface {
        Process(data string) (bool, error)
    }

    const DefaultLimit = 100
    var activeSession = "active"

    func (c *Config) Setup(endpoint string) bool {
        if endpoint == "" {
            panic("empty_endpoint")
        }
        return true
    }

    func doWork(items []string) {
        for _, val := range items {
            if val == "skip" {
                continue
            }
        }
    }
  `;

  const goCGE = compiler.compileCode(goCode, "go", "Config.go");
  console.log("Go CGE Output:\n", goCGE);

  assert.ok(goCGE.includes("CGE/1.0 Config (Go)"), "Go Header assertion failed");
  assert.ok(goCGE.includes("EXPORT Config{Endpoint:S, Timeout:N}"), "Go Struct mapping failed");
  assert.ok(goCGE.includes("EXPORT Processor{Process(data:S)->B|error}"), "Go Interface mapping failed");
  assert.ok(goCGE.includes("EXPORT CONST DefaultLimit:any = 100"), "Go Constant mapping failed");
  assert.ok(goCGE.includes("activeSession:any = \"active\""), "Go Global Variable mapping failed");
  assert.ok(goCGE.includes("EXPORT Config.Setup(endpoint:S)->B:"), "Go Struct Method signature failed");
  assert.ok(goCGE.includes("GUARD endpoint == \"\" THROW \"empty_endpoint\""), "Go Guard panic translation failed");
  assert.ok(goCGE.includes("doWork(items:S[])->void:"), "Go global function signature failed");
  assert.ok(goCGE.includes("SCAN items FOR val -> GUARD val == \"skip\""), "Go range SCAN loop translation failed");
  console.log("✅ Go Parser: PASSED");

  // =========================================================================
  // 5. C++ Compiler Tests
  // =========================================================================
  console.log("🔹 Running C++ Parser Tests...");
  const cppCode = `
    #include <string>
    #include <vector>

    struct AuthSession {
        std::string token;
        int expiry;
    };

    class AuthManager {
    private:
        std::string secretKey;
        void internalInit() {
            // init
        }
    public:
        int activeAttempts = 0;
        bool login(std::string email) {
            if (email.empty()) {
                throw std::invalid_argument("empty_email");
            }
            return true;
        }
    };

    const int MAX_LIMIT = 50;

    int main() {
        return 0;
    }
  `;

  const cppCGE = compiler.compileCode(cppCode, "cpp", "auth_manager.cpp");
  console.log("C++ CGE Output:\n", cppCGE);

  assert.ok(cppCGE.includes("CGE/1.0 auth_manager (Cpp)"), "C++ Header assertion failed");
  assert.ok(cppCGE.includes("EXPORT AuthSession{token:S, expiry:N}"), "C++ Struct mapping failed");
  assert.ok(cppCGE.includes("EXPORT AuthManager{activeAttempts:N}"), "C++ Class mapping failed");
  assert.ok(cppCGE.includes("AuthManager.secretKey:S"), "C++ Class Private Member failed");
  assert.ok(cppCGE.includes("EXPORT AuthManager.login(email:S)->B:"), "C++ Class Method signature failed");
  assert.ok(cppCGE.includes("GUARD email.empty() THROW std::invalid_argument(\"empty_email\")"), "C++ Guard throw failed");
  assert.ok(cppCGE.includes("AuthManager.internalInit()->void:"), "C++ Private Method failed");
  assert.ok(cppCGE.includes("EXPORT CONST MAX_LIMIT:N = 50"), "C++ Global Constant failed");
  console.log("✅ C++ Parser: PASSED");

  console.log("\n🎉 ALL TESTS PASSED SUCCESSFULLY! 🧬");
}

try {
  runTests();
} catch (error) {
  console.error("\n❌ TEST FAILURE ENCOUNTERED:");
  console.error(error);
  process.exit(1);
}
