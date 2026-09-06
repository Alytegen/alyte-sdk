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
    input: { discoverable?: boolean; imageUrl?: string | null },
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

  listPayments(limit?: number): Promise<{ payments: unknown[] }> {
    return this.t.request('GET', `/v1/integration/payments${limit ? `?limit=${limit}` : ''}`);
  }

  getPayment(intentId: string): Promise<unknown> {
    return this.t.request('GET', `/v1/integration/payments/${encodeURIComponent(intentId)}`);
  }

  readonly buyerSessions = {
    /**
     * Attest YOUR authenticated user → a single-use redeem link (15-min TTL).
     * Redirect the user to `baseUrl + redeemPath`; the buyer-session cookie and
     * the shop's authorize page take over from there.
     */
    mint: (input: { merchantId: string; email: string }): Promise<BuyerSessionMint> =>
      this.t.request('POST', '/v1/integration/buyer-sessions', input),
  };
}
