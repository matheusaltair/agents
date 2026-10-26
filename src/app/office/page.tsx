import { Office } from "@/components/Office";
import { db, must } from "@/lib/db/client";
import type { Agent } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export default async function OfficePage() {
  const agents = must(await db().from("agents").select("id, role, name, status, current_task_id").order("role")) as Agent[];
  const ids = agents.map((a) => a.current_task_id).filter((id): id is string => !!id);
  const tasks = ids.length ? (must(await db().from("tasks").select("id, title").in("id", ids)) as { id: string; title: string }[]) : [];
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Escritório virtual</h1>
      <Office initialAgents={agents} taskTitles={Object.fromEntries(tasks.map((t) => [t.id, t.title]))} />
    </div>
  );
}
