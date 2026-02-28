import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFinanceTools } from "./finance-tools.js";

vi.mock("../config/secrets.js", () => ({
  requireSecret: vi.fn().mockReturnValue("test-api-key"),
}));


describe("createFinanceTools", () => {
  it("returns one tool named stock_quote", () => {
    const tools = createFinanceTools([
      { provider: "yahoo", apiKeyEnvVar: "RAPIDAPI_KEY" },
    ]);
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("stock_quote");
  });

  it("tool has required fields", () => {
    const tools = createFinanceTools([
      { provider: "yahoo", apiKeyEnvVar: "RAPIDAPI_KEY" },
    ]);
    const tool = tools[0];
    expect(tool.description).toBeTruthy();
    expect(tool.defaultPolicy).toBe("allow");
    expect(tool.parameters).toBeTruthy();
    expect(typeof tool.execute).toBe("function");
  });
});

describe("stock_quote (yahoo)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const yahooResponse = (body: unknown) => ({
    ok: true,
    json: vi.fn().mockResolvedValue(body),
  });

  it("calls Yahoo Finance API with correct URL and RapidAPI headers", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      yahooResponse({
        body: [
          {
            symbol: "AAPL",
            shortName: "Apple Inc.",
            fullExchangeName: "NASDAQ",
            regularMarketPrice: 178.72,
            regularMarketChange: 2.34,
            regularMarketChangePercent: 1.33,
            regularMarketOpen: 176.5,
            regularMarketDayHigh: 179.1,
            regularMarketDayLow: 176.2,
            regularMarketPreviousClose: 176.38,
            regularMarketVolume: 54321000,
            marketCap: 2800000000000,
          },
        ],
      }),
    );

    const tools = createFinanceTools([
      { provider: "yahoo", apiKeyEnvVar: "RAPIDAPI_KEY" },
    ]);
    const result = await tools[0].execute({ symbol: "AAPL" });

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("yahoo-finance15.p.rapidapi.com");
    expect(callUrl).toContain("ticker=AAPL");

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-RapidAPI-Key": "test-api-key",
        }),
      }),
    );

    expect(result).toContain("Stock Quote: AAPL");
    expect(result).toContain("Name: Apple Inc.");
    expect(result).toContain("Exchange: NASDAQ");
    expect(result).toContain("Price: 178.72");
    expect(result).toContain("+2.34");
    expect(result).toContain("+1.33%");
    expect(result).toContain("Volume: 54,321,000");
    expect(result).toContain("Market Cap: $2.80T");
  });

  it("throws on API error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    });

    const tools = createFinanceTools([
      { provider: "yahoo", apiKeyEnvVar: "RAPIDAPI_KEY" },
    ]);
    await expect(tools[0].execute({ symbol: "AAPL" })).rejects.toThrow(
      "Yahoo Finance API HTTP 429",
    );
  });

  it("throws if symbol is missing", async () => {
    const tools = createFinanceTools([
      { provider: "yahoo", apiKeyEnvVar: "RAPIDAPI_KEY" },
    ]);
    await expect(tools[0].execute({})).rejects.toThrow("symbol is required");
  });

  it("throws on empty response body", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      yahooResponse({ body: [] }),
    );

    const tools = createFinanceTools([
      { provider: "yahoo", apiKeyEnvVar: "RAPIDAPI_KEY" },
    ]);
    await expect(tools[0].execute({ symbol: "XYZ" })).rejects.toThrow(
      'No quote data returned for symbol "XYZ"',
    );
  });

  it("normalizes symbol to uppercase and trimmed", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      yahooResponse({
        body: [
          {
            symbol: "MSFT",
            regularMarketPrice: 400,
          },
        ],
      }),
    );

    const tools = createFinanceTools([
      { provider: "yahoo", apiKeyEnvVar: "RAPIDAPI_KEY" },
    ]);
    await tools[0].execute({ symbol: "  msft  " });

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("ticker=MSFT");
  });
});

describe("stock_quote (alphavantage)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const avResponse = (body: unknown) => ({
    ok: true,
    json: vi.fn().mockResolvedValue(body),
  });

  it("calls Alpha Vantage API with correct URL and query params", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      avResponse({
        "Global Quote": {
          "01. symbol": "AAPL",
          "02. open": "176.50",
          "03. high": "179.10",
          "04. low": "176.20",
          "05. price": "178.72",
          "06. volume": "54321000",
          "08. previous close": "176.38",
          "09. change": "2.34",
          "10. change percent": "1.33%",
        },
      }),
    );

    const tools = createFinanceTools([
      { provider: "alphavantage", apiKeyEnvVar: "AV_KEY" },
    ]);
    const result = await tools[0].execute({ symbol: "AAPL" });

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("alphavantage.co/query");
    expect(callUrl).toContain("function=GLOBAL_QUOTE");
    expect(callUrl).toContain("symbol=AAPL");
    expect(callUrl).toContain("apikey=test-api-key");

    expect(result).toContain("Stock Quote: AAPL");
    expect(result).toContain("Price: 178.72");
    expect(result).toContain("+2.34");
  });

  it("throws on rate limit Note field", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      avResponse({
        Note: "Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute.",
      }),
    );

    const tools = createFinanceTools([
      { provider: "alphavantage", apiKeyEnvVar: "AV_KEY" },
    ]);
    await expect(tools[0].execute({ symbol: "AAPL" })).rejects.toThrow(
      "Alpha Vantage rate limit",
    );
  });

  it("throws on Information error field", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      avResponse({
        Information: "Invalid API key.",
      }),
    );

    const tools = createFinanceTools([
      { provider: "alphavantage", apiKeyEnvVar: "AV_KEY" },
    ]);
    await expect(tools[0].execute({ symbol: "AAPL" })).rejects.toThrow(
      "Alpha Vantage error",
    );
  });

  it("throws on API error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const tools = createFinanceTools([
      { provider: "alphavantage", apiKeyEnvVar: "AV_KEY" },
    ]);
    await expect(tools[0].execute({ symbol: "AAPL" })).rejects.toThrow(
      "Alpha Vantage API HTTP 500",
    );
  });

  it("throws on empty Global Quote", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      avResponse({ "Global Quote": {} }),
    );

    const tools = createFinanceTools([
      { provider: "alphavantage", apiKeyEnvVar: "AV_KEY" },
    ]);
    await expect(tools[0].execute({ symbol: "XYZ" })).rejects.toThrow(
      'No quote data returned for symbol "XYZ"',
    );
  });
});

describe("stock_quote (twelvedata)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const tdResponse = (body: unknown) => ({
    ok: true,
    json: vi.fn().mockResolvedValue(body),
  });

  it("calls Twelve Data API with correct URL and query params", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      tdResponse({
        symbol: "AAPL",
        name: "Apple Inc",
        exchange: "NASDAQ",
        close: "178.72",
        open: "176.50",
        high: "179.10",
        low: "176.20",
        previous_close: "176.38",
        change: "2.34",
        percent_change: "1.33",
        volume: "54321000",
      }),
    );

    const tools = createFinanceTools([
      { provider: "twelvedata", apiKeyEnvVar: "TD_KEY" },
    ]);
    const result = await tools[0].execute({ symbol: "AAPL" });

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("api.twelvedata.com/quote");
    expect(callUrl).toContain("symbol=AAPL");
    expect(callUrl).toContain("apikey=test-api-key");

    expect(result).toContain("Stock Quote: AAPL");
    expect(result).toContain("Name: Apple Inc");
    expect(result).toContain("Exchange: NASDAQ");
    expect(result).toContain("Price: 178.72");
  });

  it("throws on status error response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      tdResponse({
        status: "error",
        message: "Symbol not found",
      }),
    );

    const tools = createFinanceTools([
      { provider: "twelvedata", apiKeyEnvVar: "TD_KEY" },
    ]);
    await expect(tools[0].execute({ symbol: "INVALID" })).rejects.toThrow(
      "Twelve Data error: Symbol not found",
    );
  });

  it("throws on API error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    const tools = createFinanceTools([
      { provider: "twelvedata", apiKeyEnvVar: "TD_KEY" },
    ]);
    await expect(tools[0].execute({ symbol: "AAPL" })).rejects.toThrow(
      "Twelve Data API HTTP 401",
    );
  });

  it("throws on missing close price", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      tdResponse({
        symbol: "XYZ",
        name: "Unknown",
      }),
    );

    const tools = createFinanceTools([
      { provider: "twelvedata", apiKeyEnvVar: "TD_KEY" },
    ]);
    await expect(tools[0].execute({ symbol: "XYZ" })).rejects.toThrow(
      'No quote data returned for symbol "XYZ"',
    );
  });
});

describe("stock_quote (yfinance / yahoo_direct)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const chartResponse = (meta: unknown) => ({
    ok: true,
    json: vi.fn().mockResolvedValue({
      chart: { result: [{ meta }], error: null },
    }),
  });

  it("fetches quote from Yahoo Finance chart API", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      chartResponse({
        symbol: "AAPL",
        shortName: "Apple Inc.",
        fullExchangeName: "NasdaqGS",
        regularMarketPrice: 178.72,
        chartPreviousClose: 176.38,
        regularMarketDayHigh: 179.1,
        regularMarketDayLow: 176.2,
        regularMarketVolume: 54321000,
      }),
    );

    const tools = createFinanceTools([{ provider: "yfinance" }]);
    const result = await tools[0].execute({ symbol: "AAPL" });

    const callUrl = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string;
    expect(callUrl).toContain("query1.finance.yahoo.com");
    expect(callUrl).toContain("/AAPL");

    expect(result).toContain("Stock Quote: AAPL");
    expect(result).toContain("Name: Apple Inc.");
    expect(result).toContain("Exchange: NasdaqGS");
    expect(result).toContain("Price: 178.72");
    expect(result).toContain("Volume: 54,321,000");
  });

  it("also works with yahoo_direct provider name", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      chartResponse({
        symbol: "MSFT",
        regularMarketPrice: 400.5,
        chartPreviousClose: 398.0,
      }),
    );

    const tools = createFinanceTools([{ provider: "yahoo_direct" }]);
    const result = await tools[0].execute({ symbol: "MSFT" });
    expect(result).toContain("Price: 400.50");
  });

  it("computes change and changePercent from previousClose", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      chartResponse({
        symbol: "AAPL",
        regularMarketPrice: 180,
        chartPreviousClose: 170,
      }),
    );

    const tools = createFinanceTools([{ provider: "yfinance" }]);
    const result = await tools[0].execute({ symbol: "AAPL" });

    expect(result).toContain("+10.00");
    expect(result).toContain("+5.88%");
  });

  it("throws on API error", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const tools = createFinanceTools([{ provider: "yfinance" }]);
    await expect(tools[0].execute({ symbol: "INVALID" })).rejects.toThrow(
      "Yahoo Finance chart API HTTP 404",
    );
  });

  it("throws on chart error response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        chart: {
          result: null,
          error: { code: "Not Found", description: "No data found for symbol XYZ" },
        },
      }),
    });

    const tools = createFinanceTools([{ provider: "yfinance" }]);
    await expect(tools[0].execute({ symbol: "XYZ" })).rejects.toThrow(
      "Yahoo Finance error: No data found for symbol XYZ",
    );
  });

  it("throws on empty result (no price data)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      chartResponse({ symbol: "XYZ" }),
    );

    const tools = createFinanceTools([{ provider: "yfinance" }]);
    await expect(tools[0].execute({ symbol: "XYZ" })).rejects.toThrow(
      'No quote data returned for symbol "XYZ"',
    );
  });
});

describe("stock_quote fallback chain", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("falls back to next provider when first fails", async () => {
    let callCount = 0;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string) => {
        callCount++;
        if (url.includes("yahoo-finance15")) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
          });
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              symbol: "AAPL",
              name: "Apple Inc",
              exchange: "NASDAQ",
              close: "178.72",
              open: "176.50",
              high: "179.10",
              low: "176.20",
              previous_close: "176.38",
              change: "2.34",
              percent_change: "1.33",
              volume: "54321000",
            }),
        });
      },
    );

    const tools = createFinanceTools([
      { provider: "yahoo", apiKeyEnvVar: "RAPIDAPI_KEY" },
      { provider: "twelvedata", apiKeyEnvVar: "TD_KEY" },
    ]);
    const result = await tools[0].execute({ symbol: "AAPL" });

    expect(callCount).toBe(2);
    expect(result).toContain("Stock Quote: AAPL");
  });

  it("throws last error when all providers fail", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(
      (url: string) => {
        if (url.includes("yahoo-finance15")) {
          return Promise.resolve({
            ok: false,
            status: 429,
            statusText: "Too Many Requests",
          });
        }
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        });
      },
    );

    const tools = createFinanceTools([
      { provider: "yahoo", apiKeyEnvVar: "RAPIDAPI_KEY" },
      { provider: "twelvedata", apiKeyEnvVar: "TD_KEY" },
    ]);

    await expect(tools[0].execute({ symbol: "AAPL" })).rejects.toThrow(
      "Twelve Data API HTTP 500",
    );
  });

  it("does not try second provider when first succeeds", async () => {
    let callCount = 0;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            body: [
              {
                symbol: "AAPL",
                regularMarketPrice: 178.72,
              },
            ],
          }),
      });
    });

    const tools = createFinanceTools([
      { provider: "yahoo", apiKeyEnvVar: "RAPIDAPI_KEY" },
      { provider: "twelvedata", apiKeyEnvVar: "TD_KEY" },
    ]);
    const result = await tools[0].execute({ symbol: "AAPL" });

    expect(callCount).toBe(1);
    expect(result).toContain("Stock Quote: AAPL");
  });
});
