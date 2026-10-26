# Fábrica de Agentes

Uma "empresa" de quatro agentes de IA que trabalha as issues de um repositório GitHub num quadro Kanban:

| Coluna | Agente | O que faz |
|---|---|---|
| To-do | — | Issues abertas entram aqui pela sincronização |
| Análise | Analista | Valida requisitos, decompõe em subtarefas e escreve critérios de aceite |
| In Progress | Desenvolvedor | Cria a branch `agent/issue-N` e faz commits com a solução |
| Revisão | Revisor | Confere o diff contra os critérios; aprova ou devolve ao desenvolvedor |
| Testes | Testador | Confere testes e CI e abre o Pull Request |
| Done | — | PR aberto |

Mover um cartão para uma coluna (arrastando no quadro ou pelo próprio fluxo) dispara o agente daquela coluna.

## Como funciona

```
GitHub Issues ──sync/webhook──▶ tasks (todo)
                                   │ arrastar no Kanban (DND Kit)
                                   ▼
           trigger tasks_column_change ──▶ agent_jobs (fila)
                                   │ worker: claim_next_job()
                                   ▼
   Trust scan da issue ─▶ orçamento ok? ─▶ Claude (tool runner) com as ferramentas do papel
                                   │ finish(done | rejected | blocked)
                                   ▼
   agent_runs (tokens, custo, trust) ─▶ mensagem ao próximo agente ─▶ cartão muda de coluna
                                   │
             Supabase Realtime ────┴──▶ Kanban e escritório virtual atualizam sozinhos
```

- **Banco** (`supabase/migrations`): agentes e orçamento, tarefas, histórico (`task_events`), mensagens entre agentes, fila de jobs e execuções. Os triggers fazem o enfileiramento e a contabilidade de gasto.
- **Agentes** (`src/lib/agents`): system prompts distintos em `prompts.ts`, ferramentas por papel em `tools.ts`, executor em `runner.ts`. O modelo padrão é `claude-opus-5-5`, com fallback do servidor em caso de recusa.
- **Mensageria**: cada agente tem caixa de entrada (`agent_messages`). Ao concluir, o agente manda um `handoff` ao próximo; o revisor e o testador mandam `rejection` ao desenvolvedor quando devolvem o cartão. Mensagens não lidas entram no início da próxima execução. Depois de 3 devoluções o cartão para e pede um humano.
- **Trust** (`src/lib/guard/trust.ts`): o texto da issue é varrido contra prompt injection antes de chegar ao modelo, e cada `write_file` do desenvolvedor é varrido contra vulnerabilidades antes do commit. O score fica no cartão.
- **ROI** (`src/lib/guard/roi.ts`): custo por execução pela tabela de preços, saldo por agente (tokens e US$). Sem saldo o agente não começa; se o saldo acaba no meio, a execução para.
- **Escritório virtual** (`src/lib/office/office-map.json`): salas, mesa de cada agente e animação de cada estado (`digitando`, `pensando`, `revisando`...). A página `/office` posiciona os agentes conforme o `status` no banco, em tempo real.

### Sobre o Switch AI

O Switch Trust e o Switch ROI são da plataforma Switch, da SandboxAQ, que não tem SDK público. Por isso Trust e ROI estão implementados localmente atrás das interfaces `TrustScanner` (troque com `setTrustScanner`) e `RunMeter`. Com acesso ao Switch, basta escrever um adaptador para essas interfaces.

## Rodando

1. Crie um projeto no Supabase e aplique as migrações (`supabase db push`, ou cole os arquivos de `supabase/migrations` no SQL editor), depois `supabase/seed.sql`.
2. Copie `.env.example` para `.env.local` e preencha. O `GITHUB_TOKEN` precisa de permissão de leitura de issues e escrita de conteúdo e pull requests no repositório de `GITHUB_REPO`.
3. `npm install`, `npm run seed:agents` (grava os prompts completos), `npm run dev`.
4. Sincronize as issues: `curl -X POST localhost:3000/api/github/sync`. Para tempo real, configure um webhook do GitHub (evento *Issues*) para `/api/github/webhook` com o `GITHUB_WEBHOOK_SECRET`.
5. Rode o worker em outro terminal: `npm run worker`. Em produção, também dá para chamar `POST /api/worker/tick` por cron.

`npm test` roda o SQL num Postgres embarcado (PGlite) e testa Trust e ROI.

## Pendências conhecidas

- Não há login: qualquer pessoa com acesso à URL pode mover cartões (e assim gastar orçamento). Antes de expor publicamente, proteja `/api/tasks/*` com Supabase Auth.
- Os agentes trabalham via API do GitHub e não executam código; a validação de testes depende do CI do repositório.
- O orçamento não reinicia sozinho por período (`budget_period_start` existe para isso).
