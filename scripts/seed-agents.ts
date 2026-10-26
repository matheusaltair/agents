// Grava os system prompts completos (src/lib/agents/prompts.ts) na tabela agents.
// Uso: npx tsx --env-file=.env.local scripts/seed-agents.ts
import { SYSTEM_PROMPTS, AGENT_NAMES } from "@/lib/agents/prompts";
import { db, must } from "@/lib/db/client";
import { AGENT_ROLES } from "@/lib/db/types";

async function main() {
  for (const role of AGENT_ROLES) {
    must(
      await db()
        .from("agents")
        .upsert({ role, name: AGENT_NAMES[role], system_prompt: SYSTEM_PROMPTS[role] }, { onConflict: "role" }),
    );
    console.log(`agente ${role} atualizado`);
  }
}

void main();
