import { NextResponse } from "next/server";
import { db, must } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const [tasks, agents] = await Promise.all([
    db().from("tasks").select("*").eq("closed_on_github", false).order("position"),
    db().from("agents").select("id, role, name, status, current_task_id, budget_usd, spent_usd, budget_tokens, spent_tokens"),
  ]);
  return NextResponse.json({ tasks: must(tasks), agents: must(agents) });
}
