/** Scales a vector to unit length. Embedding models return unit vectors only at their full output size. */
export const normalizeVector = (values: number[]): number[] => {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  // Huge finite components overflow to Infinity when squared, so the norm check catches them.
  if (!Number.isFinite(norm) || norm === 0) throw new Error("Embedding has a zero or non-finite norm");
  return values.map((value) => value / norm);
};
