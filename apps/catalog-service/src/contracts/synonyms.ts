import { z } from "zod";

export const SYNONYM_TERM_MAX_LENGTH = 60;
export const SYNONYM_TERMS_MIN = 2;
export const SYNONYM_TERMS_MAX = 20;

export const searchSynonymTermSchema = z.string().trim().min(1).max(SYNONYM_TERM_MAX_LENGTH);
export const searchSynonymTermsSchema = z.array(searchSynonymTermSchema).min(SYNONYM_TERMS_MIN).max(SYNONYM_TERMS_MAX);
export type SearchSynonymTerms = z.infer<typeof searchSynonymTermsSchema>;

export const createSearchSynonymRequestSchema = z.object({ terms: searchSynonymTermsSchema });
export type CreateSearchSynonymRequest = z.infer<typeof createSearchSynonymRequestSchema>;

export const updateSearchSynonymRequestSchema = z.object({
  terms: searchSynonymTermsSchema,
  version: z.number().int().min(1),
});
export type UpdateSearchSynonymRequest = z.infer<typeof updateSearchSynonymRequestSchema>;

export const approveSearchSynonymRequestSchema = z.object({ version: z.number().int().min(1) });
export type ApproveSearchSynonymRequest = z.infer<typeof approveSearchSynonymRequestSchema>;

export type SynonymReview = { status: "pending" } | { status: "approved"; approvedBy: string; approvedAt: string };

export type SearchSynonymGroup = {
  id: string;
  terms: SearchSynonymTerms;
  version: number;
  submittedBy: string;
  submittedAt: string;
} & SynonymReview;

export type SearchSynonymListView = { items: SearchSynonymGroup[] };
