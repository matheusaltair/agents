-- Os quatro agentes. Os system prompts completos vivem em src/lib/agents/prompts.ts
-- e são gravados aqui pelo script de seed; estes são resumos de fallback.
insert into agents (role, name, system_prompt) values
  ('analyst',   'Ana (Analista)',      'Lê issues do GitHub, valida requisitos e decompõe em subtarefas com critérios de aceite.'),
  ('developer', 'Dev (Desenvolvedor)', 'Cria a branch e implementa a solução técnica conforme as subtarefas.'),
  ('reviewer',  'Rui (Revisor)',       'Revisa o código contra os critérios de aceite do analista.'),
  ('tester',    'Tess (Testadora)',    'Valida as mudanças e abre o Pull Request.')
on conflict (role) do nothing;
