import { requireSecret } from "../config/secrets.js";
import { safeExecSync } from "../security/command-exec.js";
import type { BuiltinTool } from "./builtin-tools.js";

const YAHOO_FINANCE_URL =
  "https://yahoo-finance15.p.rapidapi.com/api/v1/markets/stock/quotes";
const ALPHA_VANTAGE_URL = "https://www.alphavantage.co/query";
const TWELVE_DATA_URL = "https://api.twelvedata.com/quote";
const REQUEST_TIMEOUT_MS = 10_000;

/** Unified stock quote that all providers map into. */
interface StockQuote {
  symbol: string;
  name: string | null;
  exchange: string | null;
  price: number;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  previousClose: number | null;
  volume: number | null;
  marketCap: number | null;
}

// --- Provider response interfaces ---

interface YahooQuoteBody {
  symbol: string;
  shortName?: string;
  fullExchangeName?: string;
  regularMarketPrice?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  regularMarketOpen?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketPreviousClose?: number;
  regularMarketVolume?: number;
  marketCap?: number;
}

interface YahooQuoteResponse {
  body?: YahooQuoteBody[];
}

interface AlphaVantageGlobalQuote {
  "01. symbol"?: string;
  "02. open"?: string;
  "03. high"?: string;
  "04. low"?: string;
  "05. price"?: string;
  "06. volume"?: string;
  "08. previous close"?: string;
  "09. change"?: string;
  "10. change percent"?: string;
}

interface AlphaVantageResponse {
  "Global Quote"?: AlphaVantageGlobalQuote;
  Note?: string;
  Information?: string;
}

interface TwelveDataQuoteResponse {
  status?: string;
  message?: string;
  symbol?: string;
  name?: string;
  exchange?: string;
  close?: string;
  open?: string;
  high?: string;
  low?: string;
  previous_close?: string;
  change?: string;
  percent_change?: string;
  volume?: string;
}

/** JSON shape returned by the yfinance Python script. */
interface YfinanceJsonOutput {
  symbol?: string;
  shortName?: string;
  exchange?: string;
  currentPrice?: number;
  regularMarketPrice?: number;
  regularMarketChange?: number;
  regularMarketChangePercent?: number;
  regularMarketOpen?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketPreviousClose?: number;
  regularMarketVolume?: number;
  marketCap?: number;
}

/** A single finance provider entry. */
export interface FinanceProvider {
  provider: "yahoo" | "alphavantage" | "twelvedata" | "yfinance";
  apiKeyEnvVar?: string;
}

/** Execute a quote lookup against the RapidAPI Yahoo Finance endpoint. */
async function executeYahooQuote(
  symbol: string,
  apiKeyEnvVar: string,
): Promise<StockQuote> {
  const apiKey = requireSecret(apiKeyEnvVar);
  const url = new URL(YAHOO_FINANCE_URL);
  url.searchParams.set("ticker", symbol);

  const response = await fetch(url.toString(), {
    headers: {
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": "yahoo-finance15.p.rapidapi.com",
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Yahoo Finance API HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as YahooQuoteResponse;
  const quote = data.body?.[0];
  if (!quote) {
    throw new Error(`No quote data returned for symbol "${symbol}"`);
  }

  return {
    symbol: quote.symbol,
    name: quote.shortName ?? null,
    exchange: quote.fullExchangeName ?? null,
    price: quote.regularMarketPrice ?? 0,
    change: quote.regularMarketChange ?? null,
    changePercent: quote.regularMarketChangePercent ?? null,
    open: quote.regularMarketOpen ?? null,
    high: quote.regularMarketDayHigh ?? null,
    low: quote.regularMarketDayLow ?? null,
    previousClose: quote.regularMarketPreviousClose ?? null,
    volume: quote.regularMarketVolume ?? null,
    marketCap: quote.marketCap ?? null,
  };
}

/** Execute a quote lookup against the Alpha Vantage GLOBAL_QUOTE endpoint. */
async function executeAlphaVantageQuote(
  symbol: string,
  apiKeyEnvVar: string,
): Promise<StockQuote> {
  const apiKey = requireSecret(apiKeyEnvVar);
  const url = new URL(ALPHA_VANTAGE_URL);
  url.searchParams.set("function", "GLOBAL_QUOTE");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Alpha Vantage API HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as AlphaVantageResponse;

  if (data.Note) {
    throw new Error(`Alpha Vantage rate limit: ${data.Note}`);
  }
  if (data.Information) {
    throw new Error(`Alpha Vantage error: ${data.Information}`);
  }

  const gq = data["Global Quote"];
  if (!gq || !gq["05. price"]) {
    throw new Error(`No quote data returned for symbol "${symbol}"`);
  }

  const pctRaw = gq["10. change percent"]?.replace("%", "");

  return {
    symbol,
    name: null,
    exchange: null,
    price: Number.parseFloat(gq["05. price"]!),
    change: gq["09. change"] ? Number.parseFloat(gq["09. change"]) : null,
    changePercent: pctRaw ? Number.parseFloat(pctRaw) : null,
    open: gq["02. open"] ? Number.parseFloat(gq["02. open"]) : null,
    high: gq["03. high"] ? Number.parseFloat(gq["03. high"]) : null,
    low: gq["04. low"] ? Number.parseFloat(gq["04. low"]) : null,
    previousClose: gq["08. previous close"]
      ? Number.parseFloat(gq["08. previous close"])
      : null,
    volume: gq["06. volume"] ? Number.parseInt(gq["06. volume"], 10) : null,
    marketCap: null,
  };
}

/** Execute a quote lookup against the Twelve Data /quote endpoint. */
async function executeTwelveDataQuote(
  symbol: string,
  apiKeyEnvVar: string,
): Promise<StockQuote> {
  const apiKey = requireSecret(apiKeyEnvVar);
  const url = new URL(TWELVE_DATA_URL);
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("apikey", apiKey);

  const response = await fetch(url.toString(), {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Twelve Data API HTTP ${response.status}: ${response.statusText}`,
    );
  }

  const data = (await response.json()) as TwelveDataQuoteResponse;

  if (data.status === "error") {
    throw new Error(`Twelve Data error: ${data.message ?? "Unknown error"}`);
  }

  if (!data.close) {
    throw new Error(`No quote data returned for symbol "${symbol}"`);
  }

  return {
    symbol: data.symbol ?? symbol,
    name: data.name ?? null,
    exchange: data.exchange ?? null,
    price: Number.parseFloat(data.close),
    change: data.change ? Number.parseFloat(data.change) : null,
    changePercent: data.percent_change
      ? Number.parseFloat(data.percent_change)
      : null,
    open: data.open ? Number.parseFloat(data.open) : null,
    high: data.high ? Number.parseFloat(data.high) : null,
    low: data.low ? Number.parseFloat(data.low) : null,
    previousClose: data.previous_close
      ? Number.parseFloat(data.previous_close)
      : null,
    volume: data.volume ? Number.parseInt(data.volume, 10) : null,
    marketCap: null,
  };
}

/** Python script that fetches a quote via yfinance and prints JSON. */
const YFINANCE_SCRIPT = `
import json, sys
try:
    import yfinance
except ImportError:
    print(json.dumps({"error": "yfinance is not installed. Run: pip install yfinance"}))
    sys.exit(0)
t = yfinance.Ticker(sys.argv[1])
info = t.info or {}
fields = [
    "symbol","shortName","exchange","currentPrice","regularMarketPrice",
    "regularMarketChange","regularMarketChangePercent","regularMarketOpen",
    "regularMarketDayHigh","regularMarketDayLow","regularMarketPreviousClose",
    "regularMarketVolume","marketCap",
]
print(json.dumps({k: info.get(k) for k in fields}))
`;

/** Execute a quote lookup via the yfinance Python library (free, no API key). */
async function executeYfinanceQuote(symbol: string): Promise<StockQuote> {
  let output: string;
  try {
    output = safeExecSync("python3", ["-c", YFINANCE_SCRIPT, symbol], {
      timeout: REQUEST_TIMEOUT_MS,
    });
  } catch (err) {
    throw new Error(
      `yfinance execution failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const data = JSON.parse(output.trim()) as YfinanceJsonOutput & { error?: string };

  if (data.error) {
    throw new Error(`yfinance error: ${data.error}`);
  }

  const price = data.currentPrice ?? data.regularMarketPrice;
  if (price == null) {
    throw new Error(`No quote data returned for symbol "${symbol}"`);
  }

  return {
    symbol: data.symbol ?? symbol,
    name: data.shortName ?? null,
    exchange: data.exchange ?? null,
    price,
    change: data.regularMarketChange ?? null,
    changePercent: data.regularMarketChangePercent ?? null,
    open: data.regularMarketOpen ?? null,
    high: data.regularMarketDayHigh ?? null,
    low: data.regularMarketDayLow ?? null,
    previousClose: data.regularMarketPreviousClose ?? null,
    volume: data.regularMarketVolume ?? null,
    marketCap: data.marketCap ?? null,
  };
}

/** Dispatch a quote request to the appropriate provider. */
async function executeQuoteProvider(
  provider: FinanceProvider,
  symbol: string,
): Promise<StockQuote> {
  if (provider.provider === "alphavantage") {
    return executeAlphaVantageQuote(symbol, provider.apiKeyEnvVar!);
  }
  if (provider.provider === "twelvedata") {
    return executeTwelveDataQuote(symbol, provider.apiKeyEnvVar!);
  }
  if (provider.provider === "yfinance") {
    return executeYfinanceQuote(symbol);
  }
  return executeYahooQuote(symbol, provider.apiKeyEnvVar!);
}

/** Format a large number with T/B/M suffixes. */
function formatMarketCap(value: number): string {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`;
  return `$${value.toLocaleString("en-US")}`;
}

/** Format a StockQuote into a labeled text block. */
function formatQuoteResult(quote: StockQuote): string {
  const lines: string[] = [];
  lines.push(`Stock Quote: ${quote.symbol}`);

  if (quote.name !== null) {
    lines.push(`  Name: ${quote.name}`);
  }
  if (quote.exchange !== null) {
    lines.push(`  Exchange: ${quote.exchange}`);
  }

  lines.push(`  Price: ${quote.price.toFixed(2)}`);

  if (quote.change !== null && quote.changePercent !== null) {
    const sign = quote.change >= 0 ? "+" : "";
    lines.push(
      `  Change: ${sign}${quote.change.toFixed(2)} (${sign}${quote.changePercent.toFixed(2)}%)`,
    );
  }

  if (quote.open !== null) {
    lines.push(`  Open: ${quote.open.toFixed(2)}`);
  }
  if (quote.high !== null) {
    lines.push(`  High: ${quote.high.toFixed(2)}`);
  }
  if (quote.low !== null) {
    lines.push(`  Low: ${quote.low.toFixed(2)}`);
  }
  if (quote.previousClose !== null) {
    lines.push(`  Previous Close: ${quote.previousClose.toFixed(2)}`);
  }
  if (quote.volume !== null) {
    lines.push(`  Volume: ${quote.volume.toLocaleString("en-US")}`);
  }
  if (quote.marketCap !== null) {
    lines.push(`  Market Cap: ${formatMarketCap(quote.marketCap)}`);
  }

  return lines.join("\n");
}

/**
 * Create the stock_quote tool backed by one or more finance providers.
 * Providers are tried in order; on failure the next provider is attempted.
 */
export function createFinanceTools(
  providers: FinanceProvider[],
): BuiltinTool[] {
  return [
    {
      name: "stock_quote",
      description:
        "Get a real-time stock quote for a given ticker symbol. " +
        "Returns price, change, open, high, low, previous close, volume, and market cap when available.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          symbol: {
            type: "string",
            description:
              "The stock ticker symbol (e.g. AAPL, MSFT, TSLA)",
          },
        },
        required: ["symbol"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const rawSymbol = args.symbol as string;
        if (!rawSymbol) throw new Error("symbol is required");

        const symbol = rawSymbol.trim().toUpperCase();

        let lastError: Error | undefined;
        for (const provider of providers) {
          try {
            const quote = await executeQuoteProvider(provider, symbol);
            return formatQuoteResult(quote);
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
          }
        }

        throw lastError ?? new Error("No finance providers configured");
      },
    },
  ];
}
