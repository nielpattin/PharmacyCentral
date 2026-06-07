import { useSyncExternalStore } from "react";
import { fetchMe, login as apiLogin, logout as apiLogout, resetCsrfToken, setupFirstAdmin as apiSetupFirstAdmin } from "../api/pharmacyClient";

export type AuthUser = {
   id: string;
   displayName: string;
   email: string;
   roles: string[];
   siteIds: string[];
   isPlatformAdmin: boolean;
};

export type LoginCredentials = {
   email: string;
   password: string;
};

export type FirstAdminSetupCredentials = {
   email: string;
   password: string;
   displayName: string;
};

export type LoginValidationResult = {
   isValid: boolean;
   fieldErrors: {
      email?: string;
      password?: string;
   };
};

const listeners = new Set<() => void>();

let currentUser: AuthUser | null = null;
let isInitializing = true;
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

export function isAuthInitializing() {
   return isInitializing;
}

export function useAuth() {
   return useSyncExternalStore(subscribe, getCurrentUser, getCurrentUser);
}

export function useAuthLoading() {
   return useSyncExternalStore(
      subscribe,
      () => isInitializing,
      () => isInitializing,
   );
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
   const trimmedEmail = credentials.email.trim();
   const trimmedPassword = credentials.password.trim();
   const fieldErrors: LoginValidationResult["fieldErrors"] = {};

   if (trimmedEmail.length === 0) {
      fieldErrors.email = "Email is required.";
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
   isInitializing = false;
   emit();
}

export async function initializeAuth(): Promise<void> {
   try {
      const user = await fetchMe();
      setCurrentUser(user);
      return;
   } catch {
      // Not authenticated — that's fine
   }

   setCurrentUser(null);
}

export async function login(credentials: LoginCredentials): Promise<AuthUser> {
   const user = await apiLogin({
      email: credentials.email.trim(),
      password: credentials.password,
   });

   setCurrentUser(user);
   return user;
}

export async function setupFirstAdmin(credentials: FirstAdminSetupCredentials): Promise<AuthUser> {
   const user = await apiSetupFirstAdmin({
      email: credentials.email.trim(),
      password: credentials.password,
      displayName: credentials.displayName.trim(),
   });

   setCurrentUser(user);
   return user;
}

export async function logout(): Promise<void> {
   try {
      await apiLogout();
   } catch {
      // Ignore network errors during logout
   }

   resetCsrfToken();
   postLoginRedirectPath = "/dashboard";
   setCurrentUser(null);
}
