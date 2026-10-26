-- Segurança: o navegador (chave anon) só lê o que o quadro e o escritório mostram.
-- Toda escrita passa pelas rotas da API e pelo worker, que usam a service role.

alter table agents         enable row level security;
alter table tasks          enable row level security;
alter table task_events    enable row level security;
alter table agent_messages enable row level security;
alter table agent_jobs     enable row level security;
alter table agent_runs     enable row level security;

create policy "leitura pública dos agentes" on agents for select using (true);
create policy "leitura pública das tarefas" on tasks  for select using (true);
create policy "leitura pública das mensagens" on agent_messages for select using (true);
create policy "leitura pública das execuções" on agent_runs for select using (true);
