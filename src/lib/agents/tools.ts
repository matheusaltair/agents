// Ferramentas de cada agente. Cada função de agente recebe só o que precisa.

import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { db, must } from "@/lib/db/client";
import type { AgentRole, Task } from "@/lib/db/types";
import * as gh from "@/lib/github/repo";
import { getTrustScanner } from "@/lib/guard/trust";
import { sendMessage } from "./messaging";

export type FinishOutcome = "done" | "rejected" | "blocked";

/** Estado que as ferramentas preenchem durante uma execução. */
export interface RunState {
  finish?: { outcome: FinishOutcome; summary: string };
  writtenFiles: Map<string, string>;
}

const MAX_FILE_CHARS = 60_000;

export function toolsFor(role: AgentRole, task: Task, agentId: string, state: RunState) {
  const branch = task.branch_name ?? undefined;
  const ref = () => branch ?? "HEAD";

  const listFiles = betaZodTool({
    name: "list_files",
    description: "Lista arquivos do repositório (até 500), opcionalmente filtrando por prefixo de caminho.",
    inputSchema: z.object({ prefix: z.string().optional().describe("Ex.: src/components/") }),
    run: async ({ prefix }) => (await gh.listFiles(task.repo, ref(), prefix ?? "")).join("\n") || "(nenhum arquivo)",
  });

  const readFile = betaZodTool({
    name: "read_file",
    description: "Lê um arquivo do repositório na branch da tarefa.",
    inputSchema: z.object({ path: z.string() }),
    run: async ({ path }) => {
      const content = await gh.readFile(task.repo, ref(), path);
      if (content === null) return `Arquivo não encontrado: ${path}`;
      return content.length > MAX_FILE_CHARS ? content.slice(0, MAX_FILE_CHARS) + "\n[...arquivo truncado...]" : content;
    },
  });

  const writeFile = betaZodTool({
    name: "write_file",
    description: "Cria ou substitui um arquivo inteiro na branch da tarefa, com um commit.",
    inputSchema: z.object({
      path: z.string(),
      content: z.string().describe("Conteúdo completo do arquivo"),
      commit_message: z.string(),
    }),
    run: async ({ path, content, commit_message }) => {
      if (!branch) return "Erro: a tarefa não tem branch.";
      // Trust: o código é varrido antes do commit
      const report = await getTrustScanner().scanCode([{ path, content }]);
      if (report.blocked) {
        return `Commit recusado pelo Trust scan (score ${report.score}): ${report.findings.map((f) => f.message).join("; ")}. Corrija e tente de novo.`;
      }
      await gh.writeFile(task.repo, branch, path, content, commit_message);
      state.writtenFiles.set(path, content);
      return `Commit feito em ${branch}: ${path}`;
    },
  });

  const getDiff = betaZodTool({
    name: "get_diff",
    description: "Mostra os arquivos alterados na branch da tarefa em relação à branch padrão, com patch.",
    inputSchema: z.object({}),
    run: async () => {
      if (!branch) return "A tarefa não tem branch.";
      const files = await gh.branchDiff(task.repo, branch);
      if (!files.length) return "Nenhuma alteração na branch.";
      return files.map((f) => `### ${f.path} (${f.status})\n${f.patch}`).join("\n\n").slice(0, 120_000);
    },
  });

  const checkStatus = betaZodTool({
    name: "get_check_status",
    description: "Resultado dos checks de CI na branch da tarefa.",
    inputSchema: z.object({}),
    run: async () => {
      if (!branch) return "A tarefa não tem branch.";
      const checks = await gh.checkStatus(task.repo, branch);
      return checks.length ? JSON.stringify(checks) : "Nenhum check de CI configurado para esta branch.";
    },
  });

  const saveAnalysis = betaZodTool({
    name: "save_analysis",
    description: "Grava a decomposição da issue em subtarefas e os critérios de aceite.",
    inputSchema: z.object({
      subtasks: z.array(z.string()).min(1),
      acceptance_criteria: z.array(z.string()).min(1),
    }),
    run: async ({ subtasks, acceptance_criteria }) => {
      must(
        await db()
          .from("tasks")
          .update({
            subtasks: subtasks.map((title, i) => ({ id: `S${i + 1}`, title, done: false })),
            acceptance_criteria: acceptance_criteria.map((description, i) => ({ id: `AC${i + 1}`, description })),
          })
          .eq("id", task.id),
      );
      return "Análise gravada.";
    },
  });

  const openPr = betaZodTool({
    name: "open_pull_request",
    description: "Abre (ou reaproveita) o Pull Request da branch da tarefa para a branch padrão.",
    inputSchema: z.object({ title: z.string(), body: z.string() }),
    run: async ({ title, body }) => {
      if (!branch) return "A tarefa não tem branch.";
      const pr = await gh.openPullRequest(task.repo, branch, title, body);
      must(await db().from("tasks").update({ pr_number: pr.number, pr_url: pr.url }).eq("id", task.id));
      return `PR #${pr.number}: ${pr.url}`;
    },
  });

  const send = betaZodTool({
    name: "send_message",
    description: "Envia uma mensagem a outro agente (ou ao humano, com to = null) sobre esta tarefa.",
    inputSchema: z.object({
      to: z.enum(["analyst", "developer", "reviewer", "tester"]).nullable(),
      kind: z.enum(["question", "answer", "info"]),
      body: z.string(),
    }),
    run: async ({ to, kind, body }) => {
      await sendMessage({ taskId: task.id, from: agentId, to, kind, body });
      return "Mensagem enviada.";
    },
  });

  const finish = betaZodTool({
    name: "finish",
    description:
      'Conclui sua parte. "done" = entregue ao próximo; "rejected" = devolve ao desenvolvedor (revisor/testador); "blocked" = precisa de um humano.',
    inputSchema: z.object({ outcome: z.enum(["done", "rejected", "blocked"]), summary: z.string() }),
    run: async (input) => {
      state.finish = input;
      return "Registrado. Encerre sua resposta.";
    },
  });

  const byRole = {
    analyst: [listFiles, readFile, saveAnalysis, send, finish],
    developer: [listFiles, readFile, writeFile, getDiff, send, finish],
    reviewer: [readFile, getDiff, send, finish],
    tester: [readFile, getDiff, checkStatus, openPr, send, finish],
  } satisfies Record<AgentRole, unknown[]>;

  return byRole[role];
}
