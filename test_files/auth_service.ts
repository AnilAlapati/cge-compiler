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
