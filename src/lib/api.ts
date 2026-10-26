import { NextResponse } from "next/server";

/** Protege rotas internas (sync, worker) com um segredo compartilhado. */
export function requireInternal(req: Request): NextResponse | null {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return null; // desenvolvimento local
  return req.headers.get("authorization") === `Bearer ${secret}`
    ? null
    : NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
