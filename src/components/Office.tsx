"use client";

import type { Agent } from "@/lib/db/types";
import { OFFICE, placement } from "@/lib/office/map";
import { useLiveTable } from "@/lib/realtime";

type AgentSummary = Pick<Agent, "id" | "role" | "name" | "status" | "current_task_id">;

export function Office({ initialAgents, taskTitles }: { initialAgents: AgentSummary[]; taskTitles: Record<string, string> }) {
  const [agents] = useLiveTable<AgentSummary>("agents", initialAgents);
  const { columns, rows, tileSize } = OFFICE.grid;

  return (
    <div className="overflow-x-auto">
      <div className="relative rounded-xl" style={{ width: columns * tileSize, height: rows * tileSize }}>
        {OFFICE.rooms.map((r) => (
          <div
            key={r.id}
            className="absolute rounded-lg border border-black/10 p-2 text-xs font-medium text-black/70"
            style={{ left: r.x * tileSize, top: r.y * tileSize, width: r.w * tileSize - 4, height: r.h * tileSize - 4, background: r.color }}
          >
            {r.label}
          </div>
        ))}
        {(Object.keys(OFFICE.agents) as (keyof typeof OFFICE.agents)[]).map((role) => (
          <div
            key={`desk-${role}`}
            className="absolute rounded bg-amber-800/40"
            style={{ left: OFFICE.agents[role].desk.x * tileSize - 8, top: OFFICE.agents[role].desk.y * tileSize + 30, width: tileSize + 16, height: 12 }}
          />
        ))}
        {agents.map((a) => {
          const p = placement(a.role, a.status);
          return (
            <div
              key={a.id}
              className="absolute flex flex-col items-center text-center transition-all duration-700 ease-in-out"
              style={{ left: p.x * tileSize, top: p.y * tileSize, width: tileSize }}
              title={a.current_task_id ? taskTitles[a.current_task_id] : undefined}
            >
              <span className="text-lg leading-none">{p.bubble}</span>
              <span className={`text-3xl leading-none ${p.animationClass}`}>{p.avatar}</span>
              <span className="mt-1 whitespace-nowrap rounded bg-white/80 px-1 text-[10px] text-black">
                {a.name.split(" ")[0]} · {p.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
