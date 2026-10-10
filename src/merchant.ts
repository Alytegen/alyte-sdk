import { Transport, type ClientOptions } from './http.js';
import type {
  BuyerSessionMint,
  CatalogMerchant,
  Merchant,
  EventItem,
  MerchantPspLink,
  Tier,
  TierKind,
  FeeBearer,
  Scheme,
  PaymentRow,
  WebhookEndpoint,
  MerchantInsights,
} from './types.js';

/**
 * Merchant integration client — drives the `/v1/integration/*` surface with a
 * console-minted API token (`merchant:read` / `merchant:write` scopes).
 *
 * SERVER-SIDE ONLY: the API token is a secret. Never ship it to a browser.
 *
 * Auth integration (the primary path): your customer is already signed in on
 * YOUR site with YOUR auth — attest them via `buyerSessions.mint()` and redirect
 * to the returned redeem link. No email round-trip; same buyer identity as the
 * magic-link fallback.
 */
export class AlyteMerchant {
  private readonly t: Transport;
  constructor(opts: ClientOptions) {
    this.t = new Transport(opts);
  }

  /** Your tenant's full catalog: shops → events → tiers (with restriction fields). */
  catalog(): Promise<{ catalog: CatalogMerchant[] }> {
    return this.t.request('GET', '/v1/integration/catalog');
  }

  createShop(input: {
    name: string;
    geo: string;
    currency: string;
    checkout?: 'api' | 'hosted';
    checkoutUrl?: string;
    allowedSchemes?: Scheme[];
    feeBearer?: FeeBearer;
    taxRateBps?: number;
  }): Promise<{ merchant: Merchant }> {
    return this.t.request('POST', '/v1/integration/merchants', input);
  }

  /**
   * Public discovery is OPT-IN and off by default. Flipping `discoverable: true`
   * publishes the shop window (events, tiers, prices, availability states — never
   * counts or PSP data) at `/v1/discovery/merchants/:id` and the ACP product feed
   * at `…/feed.jsonl`. `imageUrl` is the shop image the feed requires.
   */
  updateShopDiscovery(
    merchantId: string,
    input: { discoverable?: boolean; imageUrl?: string | null; embedOrigin?: string | null },
  ): Promise<{ merchant: Merchant }> {
    return this.t.request('PATCH', `/v1/integration/merchants/${encodeURIComponent(merchantId)}`, input);
  }

  createEvent(input: { merchantId: string; title: string; startsAt: string }): Promise<{ event: EventItem }> {
    return this.t.request('POST', '/v1/integration/events', input);
  }

  /** `priceMinor` is integer minor units (cents) — the server refuses floats. */
  createTier(input: {
    eventId: string;
    title: string;
    priceMinor: number;
    currency: string;
    kind: TierKind;
    availableCount?: number;
    maxQtyPerPurchase?: number | null;
    sellable?: boolean;
    onSaleStart?: string | null;
    onSaleEnd?: string | null;
    allowedGeos?: string[] | null;
    allowedSchemes?: Scheme[] | null;
  }): Promise<{ tier: Tier }> {
    return this.t.request('POST', '/v1/integration/tiers', input);
  }

  updateTier(
    tierId: string,
    patch: {
      priceMinor?: number;
      availableCount?: number;
      maxQtyPerPurchase?: number | null;
      sellable?: boolean;
      onSaleStart?: string | null;
      onSaleEnd?: string | null;
      allowedGeos?: string[] | null;
      allowedSchemes?: Scheme[] | null;
    },
  ): Promise<{ tier: Tier }> {
    return this.t.request('PATCH', `/v1/integration/tiers/${encodeURIComponent(tierId)}`, patch);
  }

  deleteTier(tierId: string): Promise<{ ok: boolean }> {
    return this.t.request('DELETE', `/v1/integration/tiers/${encodeURIComponent(tierId)}`);
  }

  deleteEvent(eventId: string): Promise<{ ok: boolean }> {
    return this.t.request('DELETE', `/v1/integration/events/${encodeURIComponent(eventId)}`);
  }

  listPsps(merchantId: string): Promise<{ psps: MerchantPspLink[] }> {
    return this.t.request('GET', `/v1/integration/merchants/${encodeURIComponent(merchantId)}/psps`);
  }

  /**
   * Link a PSP. `secret` (your PSP secret key) is captured straight into Alyte's
   * secret store — only an opaque `credentialRef` is ever persisted or returned.
   * `publishableKey` (pk_…) is public material for the card-capture iframe.
   */
  linkPsp(
    merchantId: string,
    input: {
      psp: { id: string; name: string };
      rateBps?: number;
      isDefault?: boolean;
      secret?: string;
      publishableKey?: string;
    },
  ): Promise<{ ok: boolean; pspId: string; credentialRef?: string }> {
    return this.t.request('POST', `/v1/integration/merchants/${encodeURIComponent(merchantId)}/psps`, input);
  }

  /**
   * The payments feed, newest first. Poll with `since` = the newest `createdAt`
   * you have seen and dedupe by `intentId`. FULFIL on `status === 'authorized'`
   * using `tierId` + `quantity` — never by price-matching. Do not advance your
   * cursor past a row that is still `pending` (it becomes `authorized` seconds
   * later and `since` would skip it) — or use webhooks, which only fire on
   * authorized and have no such race.
   */
  listPayments(opts?: { limit?: number; since?: string } | number): Promise<{ payments: PaymentRow[] }> {
    const o = typeof opts === 'number' ? { limit: opts } : (opts ?? {});
    const q = new URLSearchParams();
    if (o.limit) q.set('limit', String(o.limit));
    if (o.since) q.set('since', o.since);
    const qs = q.toString();
    return this.t.request('GET', `/v1/integration/payments${qs ? `?${qs}` : ''}`);
  }

  getPayment(intentId: string): Promise<unknown> {
    return this.t.request('GET', `/v1/integration/payments/${encodeURIComponent(intentId)}`);
  }

  /** Agent adoption + per-tier watch demand for a shop (counts only — the
   *  "N in line" number; never buyer identities). */
  insights(merchantId: string): Promise<MerchantInsights> {
    return this.t.request('GET', `/v1/integration/merchants/${encodeURIComponent(merchantId)}/insights`);
  }

  readonly webhooks = {
    /**
     * Register a payment.settled push endpoint (https; ≤3 active per account).
     * The returned `secret` (whsec_…) is shown ONLY here — store it like a
     * password and verify every delivery with `verifyWebhookSignature`.
     */
    create: (input: { url: string; description?: string }): Promise<{ webhook: WebhookEndpoint; secret: string }> =>
      this.t.request('POST', '/v1/integration/webhooks', input),
    list: (): Promise<{ webhooks: WebhookEndpoint[] }> =>
      this.t.request('GET', '/v1/integration/webhooks'),
    /** Disable an endpoint — delivery (including queued retries) stops immediately. */
    delete: (id: string): Promise<{ ok: boolean }> =>
      this.t.request('DELETE', `/v1/integration/webhooks/${encodeURIComponent(id)}`),
  };

  readonly buyerSessions = {
    /**
     * Attest YOUR authenticated user → a single-use redeem link (15-min TTL).
     * Redirect the user to `baseUrl + redeemPath`; the buyer-session cookie and
     * the shop's authorize page take over from there.
     * Unknown fields are rejected with 400 and error.details.fields.
     */
    mint: (input: {
      merchantId: string;
      email: string;
      /** The tier the buyer chose — opens the authorize page as a checkout for it. */
      tierId?: string;
      /** Ticket count hint (1–10), requires tierId; permission and tier limits still govern. */
      quantity?: number;
      /** Back-to-shop link, not an automatic redirect. HTTPS (local HTTP allowed);
       *  restricted to registered embed origins when configured. */
      returnUrl?: string;
      /** The buyer's language on YOUR site (BCP-47, e.g. "de" or "de-AT"), so Alyte's
       *  pages open in the same language. Presentation only. */
      lang?: string;
    }): Promise<BuyerSessionMint> =>
      this.t.request('POST', '/v1/integration/buyer-sessions', input),
  };
}
