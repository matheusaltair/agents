import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

const root = join(__dirname, "..");
const migration = readFileSync(join(root, "supabase/migrations/0001_init.sql"), "utf8");
const rls = readFileSync(join(root, "supabase/migrations/0002_rls.sql"), "utf8");
const seed = readFileSync(join(root, "supabase/seed.sql"), "utf8");

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(migration);
  await db.exec(rls);
  await db.exec(seed);
});

async function newTask(column = "todo") {
  const { rows } = await db.query<{ id: string }>(
    `insert into tasks (repo, github_issue_number, title, column_key) values ('o/r', 1, 'Issue', $1) returning id`,
    [column],
  );
  return rows[0].id;
}

describe("esquema", () => {
  it("cria os quatro agentes", async () => {
    const { rows } = await db.query<{ role: string }>("select role from agents order by role");
    expect(rows.map((r) => r.role)).toEqual(["analyst", "developer", "reviewer", "tester"]);
  });

  it("mover para in_progress enfileira o desenvolvedor e registra o histórico", async () => {
    const id = await newTask();
    await db.query(`update tasks set column_key = 'in_progress' where id = $1`, [id]);
    const jobs = await db.query<{ role: string; status: string }>(
      "select role, status from agent_jobs where task_id = $1", [id]);
    expect(jobs.rows).toEqual([{ role: "developer", status: "pending" }]);
    const events = await db.query<{ from_column: string | null; to_column: string }>(
      "select from_column, to_column from task_events where task_id = $1 order by id", [id]);
    expect(events.rows).toEqual([
      { from_column: null, to_column: "todo" },
      { from_column: "todo", to_column: "in_progress" },
    ]);
  });

  it("sair da coluna cancela o job pendente", async () => {
    const id = await newTask("in_progress");
    await db.query(`update tasks set column_key = 'review' where id = $1`, [id]);
    const { rows } = await db.query<{ role: string; status: string }>(
      "select role, status from agent_jobs where task_id = $1 order by id", [id]);
    expect(rows).toEqual([
      { role: "developer", status: "cancelled" },
      { role: "reviewer", status: "pending" },
    ]);
  });

  it("claim_next_job reserva um job por vez", async () => {
    await newTask("analysis");
    const first = await db.query<{ status: string }>("select * from claim_next_job()");
    expect(first.rows[0].status).toBe("running");
    const second = await db.query("select * from claim_next_job()");
    expect(second.rows).toHaveLength(0);
  });

  it("execução finalizada soma gasto no agente e na tarefa", async () => {
    const id = await newTask();
    await db.query(`update agents set budget_usd = 0.01 where role = 'analyst'`);
    await db.query(
      `insert into agent_runs (agent_id, task_id, model, input_tokens, output_tokens, cost_usd, trust_score, outcome, finished_at)
       select id, $1, model, 1000, 500, 0.02, 92, 'ok', now() from agents where role = 'analyst'`, [id]);
    const agent = await db.query<{ spent_tokens: number; over_budget: boolean }>(
      "select spent_tokens, over_budget from agent_budget where role = 'analyst'");
    expect(Number(agent.rows[0].spent_tokens)).toBe(1500);
    expect(agent.rows[0].over_budget).toBe(true);
    const task = await db.query<{ tokens_used: number; trust_score: string }>(
      "select tokens_used, trust_score from tasks where id = $1", [id]);
    expect(Number(task.rows[0].tokens_used)).toBe(1500);
    expect(Number(task.rows[0].trust_score)).toBe(92);
  });
});
