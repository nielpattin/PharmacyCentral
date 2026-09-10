export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export const assertEmail = (email: string): string => {
  const normalized = normalizeEmail(email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw new Error("Invalid email address");
  }

  return normalized;
};
