import type { Agent, AgentMessage, Task } from "@/lib/db/types";

/** Monta a mensagem inicial de uma execução: dados da tarefa + caixa de entrada. */
export function taskBrief(task: Task, inbox: AgentMessage[], names: Map<string, string>): string {
  const parts = [
    `Repositório: ${task.repo}`,
    `Issue #${task.github_issue_number ?? "-"}: ${task.title}`,
    task.branch_name ? `Branch da tarefa: ${task.branch_name}` : null,
    "",
    "<issue_body>",
    task.body || "(sem descrição)",
    "</issue_body>",
  ];
  if (task.subtasks.length) {
    parts.push("", "Subtarefas do analista:", ...task.subtasks.map((s) => `- [${s.done ? "x" : " "}] ${s.title}`));
  }
  if (task.acceptance_criteria.length) {
    parts.push("", "Critérios de aceite:", ...task.acceptance_criteria.map((c) => `- (${c.id}) ${c.description}`));
  }
  if (task.pr_url) parts.push("", `PR: ${task.pr_url}`);
  if (inbox.length) {
    parts.push("", "Mensagens recebidas:");
    for (const m of inbox) {
      const from = m.from_agent_id ? (names.get(m.from_agent_id) ?? "agente") : "humano/sistema";
      parts.push(`- [${m.kind}] de ${from}: ${m.body}`);
    }
  }
  return parts.filter((p) => p !== null).join("\n");
}

export function agentNames(agents: Pick<Agent, "id" | "name">[]): Map<string, string> {
  return new Map(agents.map((a) => [a.id, a.name]));
}
