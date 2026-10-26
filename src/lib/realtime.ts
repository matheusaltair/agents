"use client";

import { useEffect, useState } from "react";
import { browserDb } from "@/lib/db/browser";

/**
 * Lista de linhas de uma tabela sincronizada via Supabase Realtime.
 * Carrega o estado inicial e aplica INSERT/UPDATE/DELETE conforme chegam.
 */
export function useLiveTable<T extends { id: string | number }>(table: string, initial: T[]) {
  const [rows, setRows] = useState<T[]>(initial);

  useEffect(() => setRows(initial), [initial]);

  useEffect(() => {
    const channel = browserDb()
      .channel(`live-${table}`)
      .on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
        setRows((current) => {
          if (payload.eventType === "DELETE") return current.filter((r) => r.id !== (payload.old as T).id);
          const row = payload.new as T;
          const i = current.findIndex((r) => r.id === row.id);
          if (i === -1) return [...current, row];
          const next = current.slice();
          next[i] = row;
          return next;
        });
      })
      .subscribe();
    return () => {
      void browserDb().removeChannel(channel);
    };
  }, [table]);

  return [rows, setRows] as const;
}
