import type { Response } from "express";
import { z } from "zod";

/** Every error body the system routes send: `{ title, status, code }`, the same shape at every status. */
export const problem = (response: Response, status: number, title: string, code: string): void => {
  response.status(status).json({ title, status, code });
};

/** The windows the metric views offer, in minutes. */
export const windowMinutes = z.enum(["15", "60", "360", "1440"]).transform((value) => Number(value));
