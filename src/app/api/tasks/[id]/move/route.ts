import { NextResponse } from "next/server";
import { z } from "zod";
import { BOARD_COLUMNS } from "@/lib/db/types";
import { moveTask } from "@/lib/kanban/move";

const Body = z.object({ column: z.enum(BOARD_COLUMNS), position: z.number().optional() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { id } = await params;
  return NextResponse.json(await moveTask(id, parsed.data.column, parsed.data.position));
}
