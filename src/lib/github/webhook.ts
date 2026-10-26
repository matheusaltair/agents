import { createHmac, timingSafeEqual } from "node:crypto";

export function verifySignature(secret: string, payload: string, signature: string | null): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from("sha256=" + createHmac("sha256", secret).update(payload).digest("hex"));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
