import { Board } from "@/components/Board";
import { db, must } from "@/lib/db/client";
import type { Agent, Task } from "@/lib/db/types";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [tasks, agents] = await Promise.all([
    db().from("tasks").select("*").eq("closed_on_github", false).order("position"),
    db().from("agents").select("id, role, name, status, current_task_id, budget_usd, spent_usd").order("role"),
  ]);
  return <Board initialTasks={must(tasks) as Task[]} initialAgents={must(agents) as Agent[]} />;
}
