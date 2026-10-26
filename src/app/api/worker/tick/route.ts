import { NextResponse } from "next/server";
import { runNextJob } from "@/lib/agents/runner";
import { requireInternal } from "@/lib/api";

// Executa um job da fila. Chame por cron (ex.: a cada minuto) ou use scripts/worker.ts.
export const maxDuration = 300;

export async function POST(req: Request) {
  const denied = requireInternal(req);
  if (denied) return denied;
  return NextResponse.json({ ran: await runNextJob() });
}
