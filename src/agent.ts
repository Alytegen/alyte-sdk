import { Transport, type ClientOptions } from './http.js';
import type { ConfirmOutcome, DiscoveredEvent, Hold, Merchant, Quote, Scheme } from './types.js';

/**
 * Agent buy-path client — the discover → quote → hold → confirm flow, with an
 * agent JWT (`catalog:read` / `payments:write` scopes).
 *
 * Every call is checked SERVER-SIDE against the agent's mandate (spend cap,
 * scope, ownership) — the SDK adds no authority, it only speaks the protocol.
 * Amounts are never passed at confirm: the charge is the LOCKED quote total.
 */
export class AlyteAgent {
  private readonly t: Transport;
  constructor(opts: ClientOptions) {
    this.t = new Transport(opts);
  }

  /** The merchants this agent may transact with (its tenant's catalog). */
  listMerchants(): Promise<{ merchants: Merchant[] }> {
    return this.t.request('GET', '/v1/merchants');
  }

  /**
   * A merchant's events + tiers with LIVE availability: `state` tells you whether
   * a tier is on sale, and `retryAfter` when a drop hasn't opened yet — schedule
   * a retry instead of polling.
   */
  discoverInventory(merchantId: string): Promise<{ events: DiscoveredEvent[] }> {
    return this.t.request('GET', `/v1/merchants/${encodeURIComponent(merchantId)}/events`);
  }

  /** Lock a price for tier × quantity. The returned total is frozen until `expiresAt`. */
  quote(input: { tierId: string; quantity: number }): Promise<Quote> {
    return this.t.request('POST', '/v1/quotes', input);
  }

  /**
   * Place an oversell-proof hold. Set `allowPartial: true` ONLY when your buyer
   * accepts fewer tickets than requested (per-purchase caps); a partial hold
   * reports `requestedQuantity` + `partialReason`.
   */
  reserve(input: {
    tierId: string;
    quantity: number;
    scheme?: Scheme;
    geo?: string;
    allowPartial?: boolean;
  }): Promise<Hold> {
    return this.t.request('POST', '/v1/holds', input);
  }

  /**
   * Pay the locked quote and confirm the hold. Pass a stable `idempotencyKey`
   * per purchase intent so retries can NEVER double-charge. Outcomes:
   * `settled` · `sca_required` (resume via `resolveSca`) · a thrown
   * AlyteApiError on refusal (stable `code`, e.g. spend-cap or scheme refusals).
   */
  confirm(
    holdId: string,
    input: { quoteId: string; instrumentToken: string; scheme: Scheme; geo: string },
    opts?: { idempotencyKey?: string },
  ): Promise<ConfirmOutcome> {
    return this.t.request(
      'POST',
      `/v1/holds/${encodeURIComponent(holdId)}/confirm`,
      input,
      opts?.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : undefined,
    );
  }

  /** Resolve a pending SCA challenge (bound to the creating agent) and resume. */
  resolveSca(continueToken: string, outcome: 'approved' | 'failed'): Promise<ConfirmOutcome> {
    return this.t.request('POST', `/v1/sca/${encodeURIComponent(continueToken)}/resolve`, { outcome });
  }

  /** Vaulted payment instruments this agent may spend from (opaque tokens only). */
  listInstruments(): Promise<{ instruments: Array<{ token: string; scheme: Scheme; last4: string }> }> {
    return this.t.request('GET', '/v1/instruments');
  }

  getPayment(intentId: string): Promise<unknown> {
    return this.t.request('GET', `/v1/payments/${encodeURIComponent(intentId)}`);
  }
}
