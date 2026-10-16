import type { z } from "zod";

export class ApiError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 422, readonly code: string, message: string) {
    super(message);
  }
}

export const notFound = (what: string, id: string) => new ApiError(404, "not_found", `${what} ${id} not found`);
export const conflict = (code: string, message: string) => new ApiError(409, code, message);
export const unprocessable = (code: string, message: string) => new ApiError(422, code, message);

export function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    throw new ApiError(400, "invalid_body", msg);
  }
  return r.data;
}
