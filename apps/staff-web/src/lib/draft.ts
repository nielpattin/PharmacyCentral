import { z } from "zod";

/**
 * Draft autosave rules: which form values may be stored, and how a stored draft is validated. Passwords, tokens, files,
 * and other non-text values never enter a draft.
 *
 * Usage: see hooks/useDraft.tsx.
 */
export const draftEnvelopeSchema = z.object({
  savedAt: z.iso.datetime(),
  values: z.record(z.string(), z.unknown()),
});

export type DraftPrimitive = string | number | boolean | null;

const SECRET_FIELD_NAME = /password|secret|token/i;

export const draftStorageKey = (userId: string, key: string): string => `pharmacy-central:draft:${userId}:${key}`;

export const pickDraftValues = (
  values: Readonly<Record<string, unknown>>,
  exclude: readonly string[] = [],
): Record<string, DraftPrimitive> => {
  const picked: Record<string, DraftPrimitive> = {};
  for (const [key, value] of Object.entries(values)) {
    if (exclude.includes(key) || SECRET_FIELD_NAME.test(key)) continue;
    if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      picked[key] = value;
    }
  }
  return picked;
};

/** A malformed envelope, or values that fail the form's own schema, read as no draft. */
export const parseDraft = <T>(raw: unknown, schema: z.ZodType<T>): { savedAt: string; values: T } | undefined => {
  const envelope = draftEnvelopeSchema.safeParse(raw);
  if (!envelope.success) return undefined;
  const values = schema.safeParse(envelope.data.values);
  return values.success ? { savedAt: envelope.data.savedAt, values: values.data } : undefined;
};
