-- Fábrica de agentes autônomos: esquema inicial
-- Perfis de agentes, orçamento, quadro Kanban, histórico de tarefas,
-- mensageria entre agentes, fila de execução e registro de execuções (Trust/ROI).

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------
create type agent_role as enum ('analyst', 'developer', 'reviewer', 'tester');

-- Estados de animação usados pelo escritório virtual
create type agent_status as enum ('idle', 'thinking', 'typing', 'working', 'reviewing', 'testing', 'blocked');

-- Colunas do Kanban, na ordem do fluxo
create type board_column as enum ('todo', 'analysis', 'in_progress', 'review', 'testing', 'done');

create type job_status as enum ('pending', 'running', 'succeeded', 'failed', 'cancelled');

create type message_kind as enum ('handoff', 'question', 'answer', 'rejection', 'done', 'info');

-- ---------------------------------------------------------------------------
-- Agentes
-- ---------------------------------------------------------------------------
create table agents (
  id               uuid primary key default gen_random_uuid(),
  role             agent_role   not null unique,
  name             text         not null,
  model            text         not null default 'claude-sonnet-5-5',
  system_prompt    text         not null,
  status           agent_status not null default 'idle',
  current_task_id  uuid,
  -- Orçamento (ROI): limites e gasto acumulado no período corrente
  budget_tokens    bigint       not null default 2000000 check (budget_tokens >= 0),
  budget_usd       numeric(12,4) not null default 20 check (budget_usd >= 0),
  spent_tokens     bigint       not null default 0,
  spent_usd        numeric(12,4) not null default 0,
  budget_period_start timestamptz not null default now(),
  created_at       timestamptz  not null default now(),
  updated_at       timestamptz  not null default now()
);

-- ---------------------------------------------------------------------------
-- Tarefas (cartões do Kanban, espelhando issues do GitHub)
-- ---------------------------------------------------------------------------
create table tasks (
  id                   uuid primary key default gen_random_uuid(),
  repo                 text         not null,          -- "owner/repo"
  github_issue_number  integer,
  github_issue_url     text,
  title                text         not null,
  body                 text         not null default '',
  labels               text[]       not null default '{}',
  column_key           board_column not null default 'todo',
  position             double precision not null default 0,  -- ordem dentro da coluna (DND Kit)
  assigned_agent_id    uuid references agents(id) on delete set null,
  -- Saída do analista: subtarefas e critérios de aceite usados pelo revisor
  acceptance_criteria  jsonb        not null default '[]'::jsonb,
  subtasks             jsonb        not null default '[]'::jsonb,
  branch_name          text,
  pr_number            integer,
  pr_url               text,
  trust_score          numeric(5,2),                   -- último score de confiança (0-100)
  cost_usd             numeric(12,4) not null default 0,
  tokens_used          bigint       not null default 0,
  closed_on_github     boolean      not null default false,
  created_at           timestamptz  not null default now(),
  updated_at           timestamptz  not null default now(),
  unique (repo, github_issue_number)
);

create index tasks_board_idx on tasks (column_key, position);

alter table agents
  add constraint agents_current_task_fk
  foreign key (current_task_id) references tasks(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Histórico de tarefas (auditoria de tudo que acontece num cartão)
-- ---------------------------------------------------------------------------
create table task_events (
  id           bigint generated always as identity primary key,
  task_id      uuid not null references tasks(id) on delete cascade,
  agent_id     uuid references agents(id) on delete set null,
  kind         text not null,   -- 'moved', 'synced', 'run_started', 'run_finished', 'trust_flag', ...
  from_column  board_column,
  to_column    board_column,
  payload      jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index task_events_task_idx on task_events (task_id, created_at);

-- ---------------------------------------------------------------------------
-- Mensageria entre agentes
-- ---------------------------------------------------------------------------
create table agent_messages (
  id             bigint generated always as identity primary key,
  task_id        uuid references tasks(id) on delete cascade,
  from_agent_id  uuid references agents(id) on delete set null,  -- null = sistema / humano
  to_agent_id    uuid references agents(id) on delete set null,  -- null = broadcast
  kind           message_kind not null default 'info',
  body           text not null,
  payload        jsonb not null default '{}'::jsonb,
  read_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index agent_messages_inbox_idx on agent_messages (to_agent_id, read_at, created_at);

-- ---------------------------------------------------------------------------
-- Fila de jobs: criada por trigger quando um cartão muda de coluna
-- ---------------------------------------------------------------------------
create table agent_jobs (
  id            bigint generated always as identity primary key,
  task_id       uuid not null references tasks(id) on delete cascade,
  role          agent_role not null,
  status        job_status not null default 'pending',
  attempts      integer not null default 0,
  last_error    text,
  locked_at     timestamptz,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);

-- No máximo um job ativo por tarefa e função
create unique index agent_jobs_active_uidx on agent_jobs (task_id, role)
  where status in ('pending', 'running');
create index agent_jobs_queue_idx on agent_jobs (status, created_at);

-- ---------------------------------------------------------------------------
-- Execuções (cada chamada de agente: tokens, custo e resultado do Trust scan)
-- ---------------------------------------------------------------------------
create table agent_runs (
  id              bigint generated always as identity primary key,
  job_id          bigint references agent_jobs(id) on delete set null,
  agent_id        uuid not null references agents(id) on delete cascade,
  task_id         uuid references tasks(id) on delete cascade,
  model           text not null,
  input_tokens    bigint not null default 0,
  output_tokens   bigint not null default 0,
  cost_usd        numeric(12,6) not null default 0,
  trust_score     numeric(5,2),
  trust_findings  jsonb not null default '[]'::jsonb,
  outcome         text,     -- 'ok', 'blocked_by_trust', 'over_budget', 'error'
  summary         text,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz
);

create index agent_runs_agent_idx on agent_runs (agent_id, started_at);
create index agent_runs_task_idx on agent_runs (task_id);

-- ---------------------------------------------------------------------------
-- Funções e triggers
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger agents_touch before update on agents
  for each row execute function touch_updated_at();
create trigger tasks_touch before update on tasks
  for each row execute function touch_updated_at();

-- Qual função de agente responde por cada coluna
create or replace function role_for_column(col board_column) returns agent_role
language sql immutable as $$
  select case col
    when 'analysis'    then 'analyst'::agent_role
    when 'in_progress' then 'developer'::agent_role
    when 'review'      then 'reviewer'::agent_role
    when 'testing'     then 'tester'::agent_role
    else null
  end
$$;

-- Ao mudar de coluna: registra no histórico e enfileira o agente responsável
create or replace function on_task_column_change() returns trigger
language plpgsql as $$
declare
  target_role agent_role;
begin
  if tg_op = 'UPDATE' and new.column_key is not distinct from old.column_key then
    return new;
  end if;

  insert into task_events (task_id, kind, from_column, to_column)
  values (new.id, 'moved', case when tg_op = 'UPDATE' then old.column_key end, new.column_key);

  -- Saiu de uma coluna com job pendente: cancela
  if tg_op = 'UPDATE' then
    update agent_jobs set status = 'cancelled', finished_at = now()
    where task_id = new.id and status = 'pending' and role is distinct from role_for_column(new.column_key);
  end if;

  target_role := role_for_column(new.column_key);
  if target_role is not null then
    insert into agent_jobs (task_id, role) values (new.id, target_role)
    on conflict do nothing;
  end if;

  return new;
end $$;

create trigger tasks_column_change
  after insert or update of column_key on tasks
  for each row execute function on_task_column_change();

-- Ao finalizar uma execução: soma tokens e custo no agente e na tarefa
create or replace function on_run_finished() returns trigger
language plpgsql as $$
begin
  if new.finished_at is null or (tg_op = 'UPDATE' and old.finished_at is not null) then
    return new;
  end if;

  update agents
     set spent_tokens = spent_tokens + new.input_tokens + new.output_tokens,
         spent_usd    = spent_usd + new.cost_usd
   where id = new.agent_id;

  if new.task_id is not null then
    update tasks
       set tokens_used = tokens_used + new.input_tokens + new.output_tokens,
           cost_usd    = cost_usd + new.cost_usd,
           trust_score = coalesce(new.trust_score, trust_score)
     where id = new.task_id;

    insert into task_events (task_id, agent_id, kind, payload)
    values (new.task_id, new.agent_id, 'run_finished', jsonb_build_object(
      'run_id', new.id, 'outcome', new.outcome, 'cost_usd', new.cost_usd,
      'tokens', new.input_tokens + new.output_tokens, 'trust_score', new.trust_score));
  end if;

  return new;
end $$;

create trigger agent_runs_finished
  after insert or update of finished_at on agent_runs
  for each row execute function on_run_finished();

-- Reserva o próximo job da fila (seguro para vários workers)
create or replace function claim_next_job() returns setof agent_jobs
language plpgsql as $$
begin
  return query
  update agent_jobs j
     set status = 'running', locked_at = now(), attempts = j.attempts + 1
   where j.id = (
     select id from agent_jobs
      where status = 'pending'
      order by created_at
      limit 1
      for update skip locked)
  returning j.*;
end $$;

-- Orçamento restante do agente (o worker consulta antes de cada execução)
create or replace view agent_budget as
select id, role, name,
       budget_tokens, spent_tokens, greatest(budget_tokens - spent_tokens, 0) as remaining_tokens,
       budget_usd, spent_usd, greatest(budget_usd - spent_usd, 0) as remaining_usd,
       (spent_tokens >= budget_tokens or spent_usd >= budget_usd) as over_budget
  from agents;

-- ---------------------------------------------------------------------------
-- Tempo real (Supabase Realtime): front-end escuta essas tabelas
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table agents, tasks, agent_messages, agent_runs;
  end if;
end $$;
