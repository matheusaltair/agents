import { Octokit } from "@octokit/rest";

export function octokit(): Octokit {
  const auth = process.env.GITHUB_TOKEN;
  if (!auth) throw new Error("Defina GITHUB_TOKEN");
  return new Octokit({ auth });
}

export function splitRepo(full: string): { owner: string; repo: string } {
  const [owner, repo] = full.split("/");
  if (!owner || !repo) throw new Error(`Repositório inválido: ${full}`);
  return { owner, repo };
}
