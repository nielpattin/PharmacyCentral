import { describe, expect, it } from "vitest";

import { passwordProblem, profileChanges, profileProblem } from "./account-form.ts";

describe("profileProblem", () => {
  it("refuses a blank name, a missing phone and a malformed phone", () => {
    expect(profileProblem({ displayName: "  ", phoneNumber: "0901234567" })).toBe("Display name is required.");
    expect(profileProblem({ displayName: "Lan", phoneNumber: "  " })).toBe("Phone number is required.");
    expect(profileProblem({ displayName: "Lan", phoneNumber: "09ab" })).toMatch(/phone number/);
    expect(profileProblem({ displayName: "Lan", phoneNumber: "0901234567" })).toBeUndefined();
    expect(profileProblem({ displayName: "Lan", phoneNumber: "+84 (90) 123-4567" })).toBeUndefined();
  });
});

describe("profileChanges", () => {
  const saved = { displayName: "Phạm Thị Lan", phoneNumber: "0901234567" };

  it("sends nothing when only whitespace differs", () => {
    expect(profileChanges({ displayName: " Phạm Thị Lan ", phoneNumber: "0901234567 " }, saved)).toBeUndefined();
  });

  it("sends only the changed field", () => {
    expect(profileChanges({ displayName: "Lan", phoneNumber: "0901234567" }, saved)).toEqual({ displayName: "Lan" });
    expect(profileChanges({ displayName: saved.displayName, phoneNumber: " 0912345678 " }, saved)).toEqual({
      phoneNumber: "0912345678",
    });
  });
});

describe("passwordProblem", () => {
  it("enforces the length and the confirmation", () => {
    expect(passwordProblem("short", "short")).toMatch(/12 characters/);
    expect(passwordProblem("a".repeat(201), "a".repeat(201))).toMatch(/200/);
    expect(passwordProblem("a".repeat(12), "b".repeat(12))).toMatch(/do not match/);
    expect(passwordProblem("a".repeat(12), "a".repeat(12))).toBeUndefined();
  });
});
