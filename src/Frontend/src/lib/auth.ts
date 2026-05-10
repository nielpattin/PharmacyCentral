import { useSyncExternalStore } from "react";

export type AuthUser = {
   username: string;
};

export type LoginCredentials = {
   username: string;
   password: string;
};

export type LoginValidationResult = {
   isValid: boolean;
   fieldErrors: {
      username?: string;
      password?: string;
   };
};

const listeners = new Set<() => void>();

let currentUser: AuthUser | null = null;
let postLoginRedirectPath = "/dashboard";

function emit() {
   for (const listener of listeners) {
      listener();
   }
}

function subscribe(listener: () => void) {
   listeners.add(listener);
   return () => {
      listeners.delete(listener);
   };
}

export function getCurrentUser() {
   return currentUser;
}

export function useAuth() {
   return useSyncExternalStore(subscribe, getCurrentUser, getCurrentUser);
}

export function setPostLoginRedirectPath(pathname: string) {
   postLoginRedirectPath = pathname;
}

export function getPostLoginRedirectPath() {
   return postLoginRedirectPath;
}

export function isProtectedPath(pathname: string) {
   return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

export function validateLoginCredentials(credentials: LoginCredentials): LoginValidationResult {
   const trimmedUsername = credentials.username.trim();
   const trimmedPassword = credentials.password.trim();
   const fieldErrors: LoginValidationResult["fieldErrors"] = {};

   if (trimmedUsername.length === 0) {
      fieldErrors.username = "Username is required.";
   }

   if (trimmedPassword.length === 0) {
      fieldErrors.password = "Password is required.";
   }

   return {
      isValid: Object.keys(fieldErrors).length === 0,
      fieldErrors,
   };
}

function setCurrentUser(user: AuthUser | null) {
   currentUser = user;
   emit();
}

export function signIn(credentials: LoginCredentials) {
   const validation = validateLoginCredentials(credentials);

   if (!validation.isValid) {
      return validation;
   }

   setCurrentUser({
      username: credentials.username.trim(),
   });

   return validation;
}

export function signOut() {
   postLoginRedirectPath = "/dashboard";
   setCurrentUser(null);
}
