// Worker contínuo: processa a fila de jobs dos agentes.
// Uso: npx tsx --env-file=.env.local scripts/worker.ts
import { runNextJob } from "@/lib/agents/runner";

const IDLE_MS = 5000;

async function main() {
  console.log("worker iniciado");
  for (;;) {
    try {
      if (await runNextJob()) continue;
    } catch (e) {
      console.error("job falhou:", e);
    }
    await new Promise((r) => setTimeout(r, IDLE_MS));
  }
}

void main();
