import type { NextRequest } from "next/server";

/** The request body as a plain object. Broken JSON, null, arrays and strings all become {}. */
export async function readBody<T extends object>(req: NextRequest): Promise<Partial<T>> {
  const v: unknown = await req.json().catch(() => null);
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Partial<T>) : {};
}
