/**
 * A counter lookup compares one canonical phone form. Staff type the number the way the patient reads it, so the
 * spaces, dots and dashes go first; then a country-code number written `84` plus nine digits is folded onto the same
 * digits as its `0` form, because both spellings are the same Vietnamese mobile number.
 */
export const canonicalPhoneDigits = (value: string): string => {
  const digits = value.replace(/\D/g, "");
  return digits.replace(/^84([0-9]{9})$/, "0$1");
};
