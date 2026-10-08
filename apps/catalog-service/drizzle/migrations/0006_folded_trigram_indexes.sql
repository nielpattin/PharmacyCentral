-- The product match folds case and Vietnamese diacritics before comparing trigrams. `unaccent()` looks its
-- dictionary up through the search path, which makes it only STABLE, so an expression index cannot be built on it
-- directly; this wrapper pins the dictionary and is the exact expression the queries and the indexes below use.
CREATE FUNCTION catalog_fold(text)
  RETURNS text
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  STRICT
  AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1)) $$;--> statement-breakpoint
CREATE INDEX products_name_folded_trgm_idx ON products USING gin (catalog_fold(name) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX products_generic_name_folded_trgm_idx ON products USING gin (catalog_fold(generic_name) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX products_active_ingredient_folded_trgm_idx ON products USING gin (catalog_fold(active_ingredient) gin_trgm_ops);
