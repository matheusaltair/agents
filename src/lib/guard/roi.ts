// ROI: custo por execução e controle de orçamento por agente.
// A interface BudgetGuard permite trocar esta implementação local pelo Switch ROI.

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

interface Price {
  input: number; // USD por 1M tokens
  output: number;
}

// Preços de tabela da API da Anthropic (USD por 1M tokens)
export const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

export function totalTokens(u: Usage): number {
  return (
    u.input_tokens + u.output_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
  );
}

export function costUsd(model: string, u: Usage): number {
  const price = PRICES[model];
  if (!price) throw new Error(`Modelo sem preço cadastrado: ${model}`);
  const perToken = (usd: number) => usd / 1_000_000;
  return (
    u.input_tokens * perToken(price.input) +
    (u.cache_creation_input_tokens ?? 0) * perToken(price.input) * 1.25 +
    (u.cache_read_input_tokens ?? 0) * perToken(price.input) * 0.1 +
    u.output_tokens * perToken(price.output)
  );
}

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
    cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
  };
}

export const ZERO_USAGE: Usage = { input_tokens: 0, output_tokens: 0 };

export interface BudgetSnapshot {
  remaining_tokens: number;
  remaining_usd: number;
}

/** Acompanha o gasto de uma execução contra o saldo do agente. */
export class RunMeter {
  usage: Usage = ZERO_USAGE;

  constructor(
    private readonly model: string,
    private readonly budget: BudgetSnapshot,
  ) {}

  add(u: Usage) {
    this.usage = addUsage(this.usage, u);
  }

  get cost(): number {
    return costUsd(this.model, this.usage);
  }

  get tokens(): number {
    return totalTokens(this.usage);
  }

  get exceeded(): boolean {
    return this.tokens >= this.budget.remaining_tokens || this.cost >= this.budget.remaining_usd;
  }
}
