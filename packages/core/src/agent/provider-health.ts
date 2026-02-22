/**
 * Provider health tracking with circuit breaker pattern.
 *
 * Each provider has a circuit that transitions between three states:
 *   closed   -> requests flow normally
 *   open     -> requests are blocked (provider is considered unavailable)
 *   half-open -> one probe request is allowed to test recovery
 *
 * State transitions:
 *   closed  -> open       when consecutive failures reach the threshold
 *   open    -> half-open  when the recovery window elapses
 *   half-open -> closed   on the next success
 *   half-open -> open     on the next failure
 */

export interface ProviderHealthConfig {
  /** Number of consecutive failures before opening the circuit. Default: 3 */
  failureThreshold?: number;
  /** How long (ms) to keep the circuit open before allowing a probe. Default: 30000 (30s) */
  recoveryTimeMs?: number;
  /** Maximum number of health records to keep per provider. Default: 100 */
  maxRecords?: number;
}

export type CircuitState = "closed" | "open" | "half-open";

export interface ProviderHealthSnapshot {
  providerName: string;
  state: CircuitState;
  consecutiveFailures: number;
  totalRequests: number;
  totalFailures: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  openedAt?: number;
}

interface ProviderState {
  consecutiveFailures: number;
  totalRequests: number;
  totalFailures: number;
  lastFailureAt?: number;
  lastSuccessAt?: number;
  openedAt?: number;
  circuitState: CircuitState;
}

const DEFAULT_CONFIG: Required<ProviderHealthConfig> = {
  failureThreshold: 3,
  recoveryTimeMs: 30_000,
  maxRecords: 100,
};

export class ProviderHealthTracker {
  private readonly config: Required<ProviderHealthConfig>;
  private readonly states = new Map<string, ProviderState>();

  constructor(config?: ProviderHealthConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Record a successful request for the given provider.
   * If the circuit was half-open, it transitions back to closed.
   */
  recordSuccess(providerName: string): void {
    const state = this.getOrCreate(providerName);
    state.totalRequests++;
    state.consecutiveFailures = 0;
    state.lastSuccessAt = Date.now();

    if (state.circuitState === "half-open") {
      state.circuitState = "closed";
      state.openedAt = undefined;
    }
  }

  /**
   * Record a failed request for the given provider.
   * If consecutive failures reach the threshold, the circuit opens.
   * If the circuit was half-open, it re-opens immediately.
   */
  recordFailure(providerName: string, _error?: unknown): void {
    const state = this.getOrCreate(providerName);
    state.totalRequests++;
    state.totalFailures++;
    state.consecutiveFailures++;
    state.lastFailureAt = Date.now();

    if (state.circuitState === "half-open") {
      // Re-open on any failure during half-open
      state.circuitState = "open";
      state.openedAt = Date.now();
      return;
    }

    if (
      state.circuitState === "closed" &&
      state.consecutiveFailures >= this.config.failureThreshold
    ) {
      state.circuitState = "open";
      state.openedAt = Date.now();
    }
  }

  /**
   * Returns true if the provider's circuit is closed or half-open
   * (i.e. the provider should be tried).
   *
   * Side-effect: if the circuit is open and the recovery window has
   * elapsed, transitions to half-open.
   */
  isAvailable(providerName: string): boolean {
    const state = this.states.get(providerName);
    if (!state) return true; // Unknown provider — assume available

    if (state.circuitState === "closed") return true;
    if (state.circuitState === "half-open") return true;

    // Circuit is open — check if recovery window has elapsed
    if (state.openedAt !== undefined) {
      const elapsed = Date.now() - state.openedAt;
      if (elapsed >= this.config.recoveryTimeMs) {
        state.circuitState = "half-open";
        return true;
      }
    }

    return false;
  }

  /**
   * Get a point-in-time snapshot of a provider's health.
   */
  getSnapshot(providerName: string): ProviderHealthSnapshot {
    const state = this.states.get(providerName);
    if (!state) {
      return {
        providerName,
        state: "closed",
        consecutiveFailures: 0,
        totalRequests: 0,
        totalFailures: 0,
      };
    }

    // Check for half-open transition before returning state
    let circuitState = state.circuitState;
    if (
      circuitState === "open" &&
      state.openedAt !== undefined &&
      Date.now() - state.openedAt >= this.config.recoveryTimeMs
    ) {
      circuitState = "half-open";
    }

    return {
      providerName,
      state: circuitState,
      consecutiveFailures: state.consecutiveFailures,
      totalRequests: state.totalRequests,
      totalFailures: state.totalFailures,
      lastFailureAt: state.lastFailureAt,
      lastSuccessAt: state.lastSuccessAt,
      openedAt: state.openedAt,
    };
  }

  /**
   * Get snapshots for all tracked providers.
   */
  getAll(): ProviderHealthSnapshot[] {
    return [...this.states.keys()].map((name) => this.getSnapshot(name));
  }

  /**
   * Reset health state. If providerName is given, only that provider is reset.
   * Otherwise all providers are reset.
   */
  reset(providerName?: string): void {
    if (providerName !== undefined) {
      this.states.delete(providerName);
    } else {
      this.states.clear();
    }
  }

  private getOrCreate(providerName: string): ProviderState {
    let state = this.states.get(providerName);
    if (!state) {
      state = {
        consecutiveFailures: 0,
        totalRequests: 0,
        totalFailures: 0,
        circuitState: "closed",
      };
      this.states.set(providerName, state);
    }
    return state;
  }
}
