// Operações de código usadas pelas ferramentas dos agentes.
// Tudo acontece via API do GitHub, na branch da tarefa: os agentes nunca tocam a branch padrão.

import { octokit, splitRepo } from "./client";

export async function defaultBranch(repo: string): Promise<string> {
  const { data } = await octokit().rest.repos.get(splitRepo(repo));
  return data.default_branch;
}

export async function ensureBranch(repo: string, branch: string): Promise<void> {
  const gh = octokit();
  const r = splitRepo(repo);
  try {
    await gh.rest.git.getRef({ ...r, ref: `heads/${branch}` });
    return;
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e;
  }
  const base = await defaultBranch(repo);
  const { data } = await gh.rest.git.getRef({ ...r, ref: `heads/${base}` });
  await gh.rest.git.createRef({ ...r, ref: `refs/heads/${branch}`, sha: data.object.sha });
}

export async function listFiles(repo: string, branch: string, prefix = ""): Promise<string[]> {
  const gh = octokit();
  const { data } = await gh.rest.git.getTree({ ...splitRepo(repo), tree_sha: branch, recursive: "true" });
  return data.tree
    .filter((t) => t.type === "blob" && t.path?.startsWith(prefix))
    .map((t) => t.path!)
    .slice(0, 500);
}

export async function readFile(repo: string, branch: string, path: string): Promise<string | null> {
  try {
    const { data } = await octokit().rest.repos.getContent({ ...splitRepo(repo), path, ref: branch });
    if (Array.isArray(data) || data.type !== "file") return null;
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}

export async function writeFile(repo: string, branch: string, path: string, content: string, message: string) {
  const gh = octokit();
  const r = splitRepo(repo);
  let sha: string | undefined;
  try {
    const { data } = await gh.rest.repos.getContent({ ...r, path, ref: branch });
    if (!Array.isArray(data)) sha = data.sha;
  } catch (e) {
    if ((e as { status?: number }).status !== 404) throw e;
  }
  await gh.rest.repos.createOrUpdateFileContents({
    ...r,
    path,
    branch,
    message,
    sha,
    content: Buffer.from(content, "utf8").toString("base64"),
  });
}

export interface ChangedFile {
  path: string;
  status: string;
  patch: string;
}

/** Arquivos alterados na branch da tarefa em relação à branch padrão. */
export async function branchDiff(repo: string, branch: string): Promise<ChangedFile[]> {
  const base = await defaultBranch(repo);
  const { data } = await octokit().rest.repos.compareCommits({ ...splitRepo(repo), base, head: branch });
  return (data.files ?? []).map((f) => ({ path: f.filename, status: f.status, patch: f.patch ?? "" }));
}

export async function checkStatus(repo: string, branch: string): Promise<{ name: string; conclusion: string | null; status: string }[]> {
  const { data } = await octokit().rest.checks.listForRef({ ...splitRepo(repo), ref: branch });
  return data.check_runs.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion }));
}

export async function openPullRequest(repo: string, branch: string, title: string, body: string) {
  const gh = octokit();
  const r = splitRepo(repo);
  const existing = await gh.rest.pulls.list({ ...r, head: `${r.owner}:${branch}`, state: "open" });
  if (existing.data[0]) return { number: existing.data[0].number, url: existing.data[0].html_url };
  const { data } = await gh.rest.pulls.create({ ...r, head: branch, base: await defaultBranch(repo), title, body });
  return { number: data.number, url: data.html_url };
}
