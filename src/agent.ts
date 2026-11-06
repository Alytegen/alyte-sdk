import { AlyteApiError, Transport, type ClientOptions } from './http.js';
import type { ConfirmOutcome, DiscoveredEvent, Hold, Merchant, Quote, Scheme } from './types.js';
import { isReservationRefusal, type BasketQuote, type ConfirmReservationInput,
  type ConfirmReservationOutcome, type Reservation, type ReserveBasketInput } from './baskets.js';

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

  /** Hold all basket lines atomically. The server checks links, party size and add-on
   * permission across the entire basket. This call does not charge or auto-retry. */
  reserveBasket(input: ReserveBasketInput): Promise<Reservation> {
    return this.t.request('POST', '/v1/reservations', input);
  }

  /** Read the current basket and every line, including any reconciliation state. Requires payments:read. */
  getReservation(reservationId: string): Promise<Reservation> {
    return this.t.request('GET', `/v1/reservations/${encodeURIComponent(reservationId)}`);
  }

  /** Lock one total for all held lines; the response retains each line's price. */
  quoteReservation(reservationId: string): Promise<BasketQuote> {
    return this.t.request('POST', `/v1/reservations/${encodeURIComponent(reservationId)}/quotes`, {});
  }

  /** Confirm the entire basket as one payment. Persist and reuse the same
   * idempotency key and inputs after a lost response; never create a new purchase
   * to retry an uncertain result. HTTP 402 basket outcomes are returned intact. */
  confirmReservation(reservationId: string, input: ConfirmReservationInput,
    opts?: { idempotencyKey?: string }): Promise<ConfirmReservationOutcome> {
    return this.reservationOutcome(`/v1/reservations/${encodeURIComponent(reservationId)}/confirm`, input,
      opts?.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : undefined);
  }

  /** Release every line early. The server refuses release while payment is in flight. */
  releaseReservation(reservationId: string): Promise<{ ok: true }> {
    return this.t.request('DELETE', `/v1/reservations/${encodeURIComponent(reservationId)}`);
  }

  /** Resume the original basket after its SCA challenge. Bound to the creating
   * principal; the server verifies the challenge outcome and payment authority. */
  resolveBasketSca(continueToken: string, outcome: 'approved' | 'failed'): Promise<ConfirmReservationOutcome> {
    return this.reservationOutcome(`/v1/reservations/sca/${encodeURIComponent(continueToken)}/resolve`, { outcome });
  }

  private async reservationOutcome(path: string, input: unknown,
    headers?: Record<string, string>): Promise<ConfirmReservationOutcome> {
    try {
      return await this.t.request('POST', path, input, headers);
    } catch (error) {
      if (error instanceof AlyteApiError && error.status === 402 && error.code === 'http_402'
        && isReservationRefusal(error.details)) return error.details;
      throw error;
    }
  }

  /** Vaulted payment instruments this agent may spend from (opaque tokens only). */
  listInstruments(): Promise<{ instruments: Array<{ token: string; scheme: Scheme; last4: string }> }> {
    return this.t.request('GET', '/v1/instruments');
  }

  getPayment(intentId: string): Promise<unknown> {
    return this.t.request('GET', `/v1/payments/${encodeURIComponent(intentId)}`);
  }
}
