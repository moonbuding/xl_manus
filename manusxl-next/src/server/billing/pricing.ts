export interface CostEstimate {
  estimatedCostUsd: number;
  estimatedCostCny: number;
}

interface ModelPrice {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  cacheReadUsdPerMillion: number;
}

const cnyPerUsd = Number(process.env.MANUSXL_CNY_PER_USD ?? 7.2);

const defaultPrice: ModelPrice = {
  inputUsdPerMillion: Number(process.env.MANUSXL_DEFAULT_INPUT_USD_PER_1M ?? 0.1),
  outputUsdPerMillion: Number(process.env.MANUSXL_DEFAULT_OUTPUT_USD_PER_1M ?? 0.3),
  cacheReadUsdPerMillion: Number(process.env.MANUSXL_DEFAULT_CACHE_USD_PER_1M ?? 0.02)
};

const priceTable: Record<string, ModelPrice> = {
  "deepseek-v4-flash": {
    inputUsdPerMillion: Number(process.env.MANUSXL_DEEPSEEK_INPUT_USD_PER_1M ?? 0.07),
    outputUsdPerMillion: Number(process.env.MANUSXL_DEEPSEEK_OUTPUT_USD_PER_1M ?? 0.27),
    cacheReadUsdPerMillion: Number(process.env.MANUSXL_DEEPSEEK_CACHE_USD_PER_1M ?? 0.014)
  },
  "deepseek-chat": {
    inputUsdPerMillion: Number(process.env.MANUSXL_DEEPSEEK_INPUT_USD_PER_1M ?? 0.07),
    outputUsdPerMillion: Number(process.env.MANUSXL_DEEPSEEK_OUTPUT_USD_PER_1M ?? 0.27),
    cacheReadUsdPerMillion: Number(process.env.MANUSXL_DEEPSEEK_CACHE_USD_PER_1M ?? 0.014)
  }
};

function resolvePrice(model: string) {
  const key = model.trim().toLowerCase();
  return priceTable[key] ?? defaultPrice;
}

export function estimateCost(input: {
  model: string;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
}): CostEstimate {
  const price = resolvePrice(input.model);
  const paidInputTokens = Math.max(0, input.promptTokens - input.cacheReadTokens);
  const usd =
    (paidInputTokens / 1_000_000) * price.inputUsdPerMillion +
    (input.cacheReadTokens / 1_000_000) * price.cacheReadUsdPerMillion +
    (input.completionTokens / 1_000_000) * price.outputUsdPerMillion;

  return {
    estimatedCostUsd: Number(usd.toFixed(8)),
    estimatedCostCny: Number((usd * cnyPerUsd).toFixed(6))
  };
}
