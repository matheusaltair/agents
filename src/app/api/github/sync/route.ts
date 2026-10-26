import { NextResponse } from "next/server";
import { requireInternal } from "@/lib/api";
import { syncIssues } from "@/lib/github/sync";

export async function POST(req: Request) {
  const denied = requireInternal(req);
  if (denied) return denied;
  const repo = process.env.GITHUB_REPO;
  if (!repo) return NextResponse.json({ error: "Defina GITHUB_REPO" }, { status: 500 });
  return NextResponse.json(await syncIssues(repo));
}
