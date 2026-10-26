import { db, must } from "@/lib/db/client";
import type { BoardColumn, Task } from "@/lib/db/types";

/**
 * Move um cartão. A mudança de coluna dispara, no banco, o enfileiramento
 * do agente responsável (trigger tasks_column_change).
 */
export async function moveTask(id: string, column: BoardColumn, position?: number): Promise<Task> {
  let pos = position;
  if (pos === undefined) {
    const last = must(
      await db().from("tasks").select("position").eq("column_key", column).order("position", { ascending: false }).limit(1),
    ) as { position: number }[];
    pos = (last[0]?.position ?? 0) + 1;
  }
  return must(
    await db().from("tasks").update({ column_key: column, position: pos }).eq("id", id).select().single(),
  ) as Task;
}
