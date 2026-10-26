import type { AgentRole, BoardColumn } from "@/lib/db/types";

export const COLUMN_LABELS: Record<BoardColumn, string> = {
  todo: "To-do",
  analysis: "Análise",
  in_progress: "In Progress",
  review: "Revisão",
  testing: "Testes",
  done: "Done",
};

/** Agente responsável por cada coluna (espelha role_for_column no banco). */
export const ROLE_OF_COLUMN: Partial<Record<BoardColumn, AgentRole>> = {
  analysis: "analyst",
  in_progress: "developer",
  review: "reviewer",
  testing: "tester",
};

/** Para onde o cartão vai quando o agente conclui com sucesso. */
export const NEXT_COLUMN: Record<AgentRole, BoardColumn> = {
  analyst: "in_progress",
  developer: "review",
  reviewer: "testing",
  tester: "done",
};

/** Posição entre dois vizinhos, para reordenar sem renumerar a coluna. */
export function positionBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 1;
  if (before === undefined) return after! - 1;
  if (after === undefined) return before + 1;
  return (before + after) / 2;
}
