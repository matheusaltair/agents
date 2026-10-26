"use client";

import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useState } from "react";
import type { Agent, BoardColumn, Task } from "@/lib/db/types";
import { BOARD_COLUMNS } from "@/lib/db/types";
import { COLUMN_LABELS, positionBetween, ROLE_OF_COLUMN } from "@/lib/kanban/columns";
import { useLiveTable } from "@/lib/realtime";

type AgentSummary = Pick<Agent, "id" | "role" | "name" | "status" | "current_task_id" | "budget_usd" | "spent_usd">;

export function Board({ initialTasks, initialAgents }: { initialTasks: Task[]; initialAgents: AgentSummary[] }) {
  const [tasks, setTasks] = useLiveTable<Task>("tasks", initialTasks);
  const [agents] = useLiveTable<AgentSummary>("agents", initialAgents);
  const [dragging, setDragging] = useState<Task | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const byColumn = useMemo(() => {
    const map = Object.fromEntries(BOARD_COLUMNS.map((c) => [c, [] as Task[]])) as Record<BoardColumn, Task[]>;
    for (const t of tasks) if (!t.closed_on_github) map[t.column_key].push(t);
    for (const c of BOARD_COLUMNS) map[c].sort((a, b) => a.position - b.position);
    return map;
  }, [tasks]);

  const workingOn = new Map(agents.filter((a) => a.current_task_id).map((a) => [a.current_task_id!, a]));

  function onDragStart(e: DragStartEvent) {
    setDragging(tasks.find((t) => t.id === e.active.id) ?? null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const task = tasks.find((t) => t.id === e.active.id);
    if (!task || !e.over) return;

    // "over" pode ser uma coluna (vazia) ou outro cartão
    const overId = String(e.over.id);
    const column = (BOARD_COLUMNS as readonly string[]).includes(overId)
      ? (overId as BoardColumn)
      : tasks.find((t) => t.id === overId)?.column_key;
    if (!column) return;

    const siblings = byColumn[column].filter((t) => t.id !== task.id);
    const index = siblings.findIndex((t) => t.id === overId);
    const position =
      index === -1
        ? positionBetween(siblings.at(-1)?.position, undefined)
        : positionBetween(siblings[index - 1]?.position, siblings[index].position);

    if (column === task.column_key && position === task.position) return;

    const previous = tasks;
    setTasks((ts) => ts.map((t) => (t.id === task.id ? { ...t, column_key: column, position } : t)));
    const res = await fetch(`/api/tasks/${task.id}/move`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ column, position }),
    });
    if (!res.ok) setTasks(previous);
  }

  return (
    <div className="space-y-4">
      <AgentStrip agents={agents} />
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="grid grid-flow-col auto-cols-[minmax(240px,1fr)] gap-4 overflow-x-auto pb-4">
          {BOARD_COLUMNS.map((c) => (
            <Column key={c} column={c} tasks={byColumn[c]} workingOn={workingOn} agents={agents} />
          ))}
        </div>
        <DragOverlay>{dragging ? <Card task={dragging} /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}

function AgentStrip({ agents }: { agents: AgentSummary[] }) {
  return (
    <div className="flex flex-wrap gap-3">
      {agents.map((a) => {
        const pct = a.budget_usd > 0 ? Math.min(100, (Number(a.spent_usd) / Number(a.budget_usd)) * 100) : 100;
        return (
          <div key={a.id} className="min-w-52 rounded-lg bg-card px-3 py-2 text-sm shadow-sm">
            <div className="flex justify-between">
              <span className="font-medium">{a.name}</span>
              <span className="opacity-70">{a.status}</span>
            </div>
            <div className="mt-1 h-1.5 rounded bg-black/10 dark:bg-white/10">
              <div className={`h-1.5 rounded ${pct > 90 ? "bg-red-500" : "bg-emerald-500"}`} style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1 text-xs opacity-70">
              US$ {Number(a.spent_usd).toFixed(2)} de {Number(a.budget_usd).toFixed(2)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Column({
  column,
  tasks,
  workingOn,
  agents,
}: {
  column: BoardColumn;
  tasks: Task[];
  workingOn: Map<string, AgentSummary>;
  agents: AgentSummary[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  const owner = agents.find((a) => a.role === ROLE_OF_COLUMN[column]);
  return (
    <section ref={setNodeRef} className={`rounded-xl p-3 ${isOver ? "bg-black/10 dark:bg-white/10" : "bg-black/5 dark:bg-white/5"}`}>
      <h2 className="mb-1 flex justify-between text-sm font-semibold">
        {COLUMN_LABELS[column]} <span className="opacity-60">{tasks.length}</span>
      </h2>
      <p className="mb-3 h-4 text-xs opacity-60">{owner ? owner.name : ""}</p>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-24 flex-col gap-2">
          {tasks.map((t) => (
            <SortableCard key={t.id} task={t} agent={workingOn.get(t.id)} />
          ))}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableCard({ task, agent }: { task: Task; agent?: AgentSummary }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
    >
      <Card task={task} agent={agent} />
    </div>
  );
}

function Card({ task, agent }: { task: Task; agent?: AgentSummary }) {
  return (
    <article className="cursor-grab rounded-lg bg-card p-3 text-sm shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{task.title}</span>
        {task.github_issue_url && (
          <a href={task.github_issue_url} target="_blank" rel="noreferrer" className="shrink-0 text-xs opacity-60 hover:underline">
            #{task.github_issue_number}
          </a>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-xs opacity-75">
        {agent && <span className="anim-thinking">● {agent.name} {agent.status}</span>}
        {task.trust_score !== null && <span title="Trust score">🛡 {Number(task.trust_score).toFixed(0)}</span>}
        {Number(task.cost_usd) > 0 && <span title="Custo acumulado">US$ {Number(task.cost_usd).toFixed(3)}</span>}
        {task.pr_url && (
          <a href={task.pr_url} target="_blank" rel="noreferrer" className="hover:underline">
            PR #{task.pr_number}
          </a>
        )}
      </div>
    </article>
  );
}
