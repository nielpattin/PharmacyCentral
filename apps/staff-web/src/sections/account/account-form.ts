import type { JsonRecord } from "../../staff-api.ts";

/** The identity service refuses a shorter or longer password, so the form never sends one it would refuse. */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 200;

/** Identity accepts a phone of digits and dial punctuation only (`updateProfileRequestSchema`). */
const PHONE_PATTERN = /^[0-9+()\s-]{8,20}$/;

export type ProfileForm = { displayName: string; phoneNumber: string };

/** The English message when an employee phone is empty or malformed, or `undefined` when identity would accept it. */
export const phoneProblem = (value: string): string | undefined => {
  const phoneNumber = value.trim();
  if (phoneNumber === "") return "Phone number is required.";
  if (!PHONE_PATTERN.test(phoneNumber)) return "The phone number may only hold digits and the characters + ( ) -";
  return undefined;
};

/** The English message for the first field the identity service would refuse, or `undefined` when the form is valid. */
export const profileProblem = (form: ProfileForm): string | undefined => {
  if (form.displayName.trim() === "") return "Display name is required.";
  return phoneProblem(form.phoneNumber);
};

/** The `PATCH /api/auth/me` body holding only the fields that differ from the saved profile, or `undefined` when none do. A staff phone is required, so the form never sends an empty one. */
export const profileChanges = (form: ProfileForm, saved: ProfileForm): JsonRecord | undefined => {
  const changes: JsonRecord = {};
  const displayName = form.displayName.trim();
  if (displayName !== saved.displayName) changes.displayName = displayName;
  const phoneNumber = form.phoneNumber.trim();
  if (phoneNumber !== saved.phoneNumber.trim()) changes.phoneNumber = phoneNumber;
  return Object.keys(changes).length > 0 ? changes : undefined;
};

/** The English message for the first reason the password form cannot be sent, or `undefined` when it can. */
export const passwordProblem = (nextPassword: string, confirmPassword: string): string | undefined => {
  if (nextPassword.length < MIN_PASSWORD_LENGTH) return "The new password needs at least 12 characters.";
  if (nextPassword.length > MAX_PASSWORD_LENGTH) return "The new password may not exceed 200 characters.";
  if (nextPassword !== confirmPassword) return "The new password and its confirmation do not match.";
  return undefined;
};
