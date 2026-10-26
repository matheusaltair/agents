// Sincronização GitHub Issues -> Kanban.
// Issues novas entram em "todo"; cartões existentes mantêm a coluna em que estão.

import { db, must } from "@/lib/db/client";
import { octokit, splitRepo } from "./client";

export interface IssueLike {
  number: number;
  html_url: string;
  title: string;
  body?: string | null;
  state: string;
  labels: (string | { name?: string })[];
  pull_request?: unknown;
}

function labelNames(labels: IssueLike["labels"]): string[] {
  return labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean);
}

/** Cria ou atualiza o cartão de uma issue. Retorna true se o cartão foi criado. */
export async function upsertIssue(repo: string, issue: IssueLike): Promise<boolean> {
  if (issue.pull_request) return false;

  const existing = must(
    await db().from("tasks").select("id").eq("repo", repo).eq("github_issue_number", issue.number).maybeSingle(),
  ) as { id: string } | null;

  const fields = {
    title: issue.title,
    body: issue.body ?? "",
    labels: labelNames(issue.labels),
    github_issue_url: issue.html_url,
    closed_on_github: issue.state === "closed",
  };

  if (existing) {
    must(await db().from("tasks").update(fields).eq("id", existing.id));
    return false;
  }
  if (issue.state === "closed") return false;

  // Novo cartão vai para o fim da coluna "todo"
  const last = must(
    await db().from("tasks").select("position").eq("column_key", "todo").order("position", { ascending: false }).limit(1),
  ) as { position: number }[];
  must(
    await db()
      .from("tasks")
      .insert({ ...fields, repo, github_issue_number: issue.number, column_key: "todo", position: (last[0]?.position ?? 0) + 1 }),
  );
  return true;
}

export async function syncIssues(repo: string): Promise<{ created: number; seen: number }> {
  const gh = octokit();
  const issues = (await gh.paginate(gh.rest.issues.listForRepo, {
    ...splitRepo(repo),
    state: "open",
    per_page: 100,
  })) as IssueLike[];

  let created = 0;
  for (const issue of issues) if (await upsertIssue(repo, issue)) created++;
  return { created, seen: issues.length };
}
