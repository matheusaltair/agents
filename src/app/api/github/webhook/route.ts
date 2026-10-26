import { NextResponse } from "next/server";
import { upsertIssue, type IssueLike } from "@/lib/github/sync";
import { verifySignature } from "@/lib/github/webhook";

// Webhook do GitHub (evento "issues"): novas issues entram no Kanban na hora.
export async function POST(req: Request) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const raw = await req.text();
  if (!secret || !verifySignature(secret, raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "assinatura inválida" }, { status: 401 });
  }
  if (req.headers.get("x-github-event") !== "issues") return NextResponse.json({ ignored: true });

  const payload = JSON.parse(raw) as { issue: IssueLike; repository: { full_name: string } };
  const created = await upsertIssue(payload.repository.full_name, payload.issue);
  return NextResponse.json({ created });
}
