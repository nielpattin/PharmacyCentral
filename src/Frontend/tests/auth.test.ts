/// <reference types="node" />

import assert from "node:assert/strict";
import { test } from "node:test";
import {
   getCurrentUser,
   getPostLoginRedirectPath,
   isProtectedPath,
   setPostLoginRedirectPath,
   signIn,
   signOut,
   validateLoginCredentials,
} from "../src/lib/auth";

test("validateLoginCredentials requires username and password", () => {
   const result = validateLoginCredentials({ username: "  ", password: "" });

   assert.equal(result.isValid, false);
   assert.equal(result.fieldErrors.username, "Username is required.");
   assert.equal(result.fieldErrors.password, "Password is required.");
});

test("isProtectedPath matches dashboard routes only", () => {
   assert.equal(isProtectedPath("/"), false);
   assert.equal(isProtectedPath("/login"), false);
   assert.equal(isProtectedPath("/dashboard"), true);
   assert.equal(isProtectedPath("/dashboard/sites"), true);
});

test("getPostLoginRedirectPath defaults to dashboard", () => {
   assert.equal(getPostLoginRedirectPath(), "/dashboard");
});

test("signIn stores the trimmed username and signOut clears it", () => {
   signOut();

   const result = signIn({ username: "  quang  ", password: "secret" });

   assert.equal(result.isValid, true);
   assert.equal(getCurrentUser()?.username, "quang");

   signOut();
   assert.equal(getCurrentUser(), null);
});

test("signOut resets the post login redirect path", () => {
   setPostLoginRedirectPath("/dashboard/sites");
   signOut();

   assert.equal(getPostLoginRedirectPath(), "/dashboard");
});
