// Mensageria entre agentes: cada agente tem uma caixa de entrada no banco.
// O runner injeta as mensagens não lidas no início de cada execução e as marca como lidas.

import { db, must } from "@/lib/db/client";
import type { AgentMessage, AgentRole, MessageKind } from "@/lib/db/types";

export async function agentIdByRole(role: AgentRole): Promise<string> {
  const row = must(await db().from("agents").select("id").eq("role", role).single()) as { id: string };
  return row.id;
}

export async function sendMessage(msg: {
  taskId: string | null;
  from: string | null;
  to: AgentRole | null;
  kind: MessageKind;
  body: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  const toId = msg.to ? await agentIdByRole(msg.to) : null;
  must(
    await db().from("agent_messages").insert({
      task_id: msg.taskId,
      from_agent_id: msg.from,
      to_agent_id: toId,
      kind: msg.kind,
      body: msg.body,
      payload: msg.payload ?? {},
    }),
  );
}

/** Mensagens não lidas do agente sobre a tarefa (ou gerais), marcando-as como lidas. */
export async function takeInbox(agentId: string, taskId: string): Promise<AgentMessage[]> {
  const rows = must(
    await db()
      .from("agent_messages")
      .select("*")
      .eq("to_agent_id", agentId)
      .is("read_at", null)
      .or(`task_id.eq.${taskId},task_id.is.null`)
      .order("created_at"),
  ) as AgentMessage[];
  if (rows.length) {
    must(await db().from("agent_messages").update({ read_at: new Date().toISOString() }).in("id", rows.map((r) => r.id)));
  }
  return rows;
}
