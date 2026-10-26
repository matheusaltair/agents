// Executor de jobs: pega um job da fila, roda o agente da coluna e entrega o cartão adiante.

import Anthropic from "@anthropic-ai/sdk";
import { db, must } from "@/lib/db/client";
import type { Agent, AgentJob, AgentRole, AgentStatus, Task, TrustFinding } from "@/lib/db/types";
import { ensureBranch } from "@/lib/github/repo";
import { RunMeter } from "@/lib/guard/roi";
import { getTrustScanner } from "@/lib/guard/trust";
import { NEXT_COLUMN, ROLE_OF_COLUMN } from "@/lib/kanban/columns";
import { moveTask } from "@/lib/kanban/move";
import { agentNames, taskBrief } from "./context";
import { sendMessage, takeInbox } from "./messaging";
import { toolsFor, type RunState } from "./tools";

const MAX_ITERATIONS = 30;
/** Depois de tantas devoluções ao desenvolvedor, o cartão para e pede um humano. */
const MAX_REJECTIONS = 3;

const WORKING_STATUS: Record<AgentRole, AgentStatus> = {
  analyst: "thinking",
  developer: "typing",
  reviewer: "reviewing",
  tester: "testing",
};

let anthropic: Anthropic | null = null;
function client() {
  return (anthropic ??= new Anthropic());
}

async function setAgent(agentId: string, status: AgentStatus, taskId: string | null) {
  must(await db().from("agents").update({ status, current_task_id: taskId }).eq("id", agentId));
}

async function finishJob(jobId: number, status: "succeeded" | "failed", error?: string) {
  must(
    await db()
      .from("agent_jobs")
      .update({ status, last_error: error ?? null, finished_at: new Date().toISOString() })
      .eq("id", jobId),
  );
}

async function recordRun(run: {
  jobId: number;
  agent: Agent;
  taskId: string;
  meter?: RunMeter;
  trustScore: number | null;
  findings: TrustFinding[];
  outcome: "ok" | "blocked_by_trust" | "over_budget" | "error";
  summary: string;
}) {
  // O trigger agent_runs_finished soma tokens e custo no agente e na tarefa
  must(
    await db().from("agent_runs").insert({
      job_id: run.jobId,
      agent_id: run.agent.id,
      task_id: run.taskId,
      model: run.agent.model,
      input_tokens: run.meter?.usage.input_tokens ?? 0,
      output_tokens: run.meter?.usage.output_tokens ?? 0,
      cost_usd: run.meter?.cost ?? 0,
      trust_score: run.trustScore,
      trust_findings: run.findings,
      outcome: run.outcome,
      summary: run.summary,
      finished_at: new Date().toISOString(),
    }),
  );
}

async function rejectionCount(taskId: string): Promise<number> {
  const { count, error } = await db()
    .from("agent_messages")
    .select("id", { count: "exact", head: true })
    .eq("task_id", taskId)
    .eq("kind", "rejection");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Reserva e executa o próximo job. Retorna false se a fila estava vazia. */
export async function runNextJob(): Promise<boolean> {
  const jobs = must(await db().rpc("claim_next_job")) as AgentJob[];
  const job = jobs[0];
  if (!job) return false;
  try {
    await runJob(job);
  } catch (e) {
    await finishJob(job.id, "failed", e instanceof Error ? e.message : String(e));
    throw e;
  }
  return true;
}

export async function runJob(job: AgentJob): Promise<void> {
  let task = must(await db().from("tasks").select("*").eq("id", job.task_id).single()) as Task;
  const agents = must(await db().from("agents").select("*")) as Agent[];
  const agent = agents.find((a) => a.role === job.role);
  if (!agent) throw new Error(`Agente ${job.role} não cadastrado`);

  // ROI: sem saldo, o agente nem começa
  const budget = must(
    await db().from("agent_budget").select("remaining_tokens, remaining_usd, over_budget").eq("id", agent.id).single(),
  ) as { remaining_tokens: number; remaining_usd: number; over_budget: boolean };
  if (budget.over_budget) {
    await setAgent(agent.id, "blocked", null);
    await recordRun({ jobId: job.id, agent, taskId: task.id, trustScore: null, findings: [], outcome: "over_budget", summary: "Orçamento esgotado" });
    await sendMessage({ taskId: task.id, from: agent.id, to: null, kind: "info", body: `${agent.name} está sem orçamento. Aumente o limite para continuar.` });
    await finishJob(job.id, "failed", "over_budget");
    return;
  }

  // Trust: a issue é entrada não confiável; varre antes de entregar ao modelo
  const trust = await getTrustScanner().scanPrompt(`${task.title}\n\n${task.body}`, `issue#${task.github_issue_number}`);
  if (trust.blocked) {
    await recordRun({ jobId: job.id, agent, taskId: task.id, trustScore: trust.score, findings: trust.findings, outcome: "blocked_by_trust", summary: "Issue bloqueada pelo Trust scan" });
    await sendMessage({
      taskId: task.id,
      from: agent.id,
      to: null,
      kind: "info",
      body: `Issue bloqueada pelo Trust scan (score ${trust.score}): ${trust.findings.map((f) => f.message).join("; ")}`,
      payload: { findings: trust.findings },
    });
    await finishJob(job.id, "failed", "blocked_by_trust");
    return;
  }

  if (job.role === "developer" && !task.branch_name) {
    const branch = `agent/issue-${task.github_issue_number ?? task.id.slice(0, 8)}`;
    await ensureBranch(task.repo, branch);
    task = must(await db().from("tasks").update({ branch_name: branch }).eq("id", task.id).select().single()) as Task;
  }

  await setAgent(agent.id, WORKING_STATUS[job.role], task.id);
  must(await db().from("tasks").update({ assigned_agent_id: agent.id }).eq("id", task.id));

  const inbox = await takeInbox(agent.id, task.id);
  const state: RunState = { writtenFiles: new Map() };
  const meter = new RunMeter(agent.model, budget);
  let outcome: "ok" | "over_budget" | "error" = "ok";
  let errorText: string | undefined;

  try {
    const runner = client().beta.messages.toolRunner({
      model: agent.model,
      max_tokens: 16000,
      max_iterations: MAX_ITERATIONS,
      system: [{ type: "text", text: agent.system_prompt, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: taskBrief(task, inbox, agentNames(agents)) }],
      tools: toolsFor(job.role, task, agent.id, state),
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    for await (const message of runner) {
      meter.add(message.usage);
      if (message.stop_reason === "refusal") {
        outcome = "error";
        errorText = "O modelo recusou a tarefa";
        break;
      }
      if (state.finish) break;
      if (meter.exceeded) {
        outcome = "over_budget";
        break;
      }
    }
  } catch (e) {
    outcome = "error";
    errorText = e instanceof Error ? e.message : String(e);
  }

  // Trust: score final do código escrito nesta execução
  let trustScore = trust.score;
  let findings = trust.findings;
  if (state.writtenFiles.size) {
    const code = await getTrustScanner().scanCode([...state.writtenFiles].map(([path, content]) => ({ path, content })));
    trustScore = Math.min(trustScore, code.score);
    findings = [...findings, ...code.findings];
  }

  const summary = state.finish?.summary ?? errorText ?? (outcome === "over_budget" ? "Orçamento da execução esgotado" : "Terminou sem chamar finish");
  await recordRun({ jobId: job.id, agent, taskId: task.id, meter, trustScore, findings, outcome, summary });

  const result = outcome === "ok" ? state.finish?.outcome : undefined;
  if (result === "done") {
    const next = NEXT_COLUMN[job.role];
    await sendMessage({ taskId: task.id, from: agent.id, to: ROLE_OF_COLUMN[next] ?? null, kind: next === "done" ? "done" : "handoff", body: summary });
    await moveTask(task.id, next);
  } else if (result === "rejected" && (job.role === "reviewer" || job.role === "tester")) {
    if ((await rejectionCount(task.id)) >= MAX_REJECTIONS) {
      await sendMessage({ taskId: task.id, from: agent.id, to: null, kind: "info", body: `Cartão devolvido ${MAX_REJECTIONS} vezes; precisa de um humano. Último motivo: ${summary}` });
    } else {
      await sendMessage({ taskId: task.id, from: agent.id, to: "developer", kind: "rejection", body: summary });
      await moveTask(task.id, "in_progress");
    }
  } else {
    // blocked, erro ou sem orçamento: o cartão fica parado e o humano é avisado
    await sendMessage({ taskId: task.id, from: agent.id, to: null, kind: "info", body: `${agent.name} parou: ${summary}` });
  }

  await setAgent(agent.id, outcome === "over_budget" ? "blocked" : "idle", null);
  await finishJob(job.id, outcome === "ok" && result !== "blocked" ? "succeeded" : "failed", errorText);
}
