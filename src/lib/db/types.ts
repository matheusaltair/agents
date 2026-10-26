// Tipos espelhando supabase/migrations/0001_init.sql

export const AGENT_ROLES = ["analyst", "developer", "reviewer", "tester"] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_STATUSES = ["idle", "thinking", "typing", "working", "reviewing", "testing", "blocked"] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const BOARD_COLUMNS = ["todo", "analysis", "in_progress", "review", "testing", "done"] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";
export type MessageKind = "handoff" | "question" | "answer" | "rejection" | "done" | "info";

export interface Agent {
  id: string;
  role: AgentRole;
  name: string;
  model: string;
  system_prompt: string;
  status: AgentStatus;
  current_task_id: string | null;
  budget_tokens: number;
  budget_usd: number;
  spent_tokens: number;
  spent_usd: number;
  budget_period_start: string;
  created_at: string;
  updated_at: string;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
}

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  repo: string;
  github_issue_number: number | null;
  github_issue_url: string | null;
  title: string;
  body: string;
  labels: string[];
  column_key: BoardColumn;
  position: number;
  assigned_agent_id: string | null;
  acceptance_criteria: AcceptanceCriterion[];
  subtasks: Subtask[];
  branch_name: string | null;
  pr_number: number | null;
  pr_url: string | null;
  trust_score: number | null;
  cost_usd: number;
  tokens_used: number;
  closed_on_github: boolean;
  created_at: string;
  updated_at: string;
}

export interface AgentMessage {
  id: number;
  task_id: string | null;
  from_agent_id: string | null;
  to_agent_id: string | null;
  kind: MessageKind;
  body: string;
  payload: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface AgentJob {
  id: number;
  task_id: string;
  role: AgentRole;
  status: JobStatus;
  attempts: number;
  last_error: string | null;
  locked_at: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface TrustFinding {
  rule: string;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  location?: string;
}

export interface AgentRun {
  id: number;
  job_id: number | null;
  agent_id: string;
  task_id: string | null;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  trust_score: number | null;
  trust_findings: TrustFinding[];
  outcome: "ok" | "blocked_by_trust" | "over_budget" | "error" | null;
  summary: string | null;
  started_at: string;
  finished_at: string | null;
}
