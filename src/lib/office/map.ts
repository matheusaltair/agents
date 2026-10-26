import type { AgentRole, AgentStatus } from "@/lib/db/types";
import raw from "./office-map.json";

export interface Point {
  x: number;
  y: number;
}

export interface OfficeMap {
  grid: { columns: number; rows: number; tileSize: number };
  rooms: { id: string; label: string; x: number; y: number; w: number; h: number; color: string }[];
  agents: Record<AgentRole, { room: string; desk: Point; idleSpot: Point; avatar: string }>;
  states: Record<AgentStatus, { label: string; animation: string; atDesk: boolean; bubble: string }>;
}

export const OFFICE = raw as OfficeMap;

/** Posição e animação de um agente no escritório, a partir do estado no banco. */
export function placement(role: AgentRole, status: AgentStatus) {
  const spot = OFFICE.agents[role];
  const state = OFFICE.states[status];
  return {
    ...(state.atDesk ? spot.desk : spot.idleSpot),
    avatar: spot.avatar,
    animationClass: `anim-${state.animation}`,
    label: state.label,
    bubble: state.bubble,
  };
}
