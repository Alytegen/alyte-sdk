/**
 * Hand-typed mirrors of the Alyte API's response shapes. Money is ALWAYS integer
 * minor units (`…Minor`) — never floats. Format for display only.
 */

export type Scheme = 'visa' | 'mastercard' | 'amex';
export type TierKind = 'general' | 'seated';
export type FeeBearer = 'buyer' | 'merchant';

export interface Merchant {
  id: string;
  name: string;
  geo: string;
  currency: string;
  /** 'api' = in-flow reserve/confirm; 'hosted' = discovery-only, redirect to checkoutUrl. */
  checkout?: 'api' | 'hosted';
  checkoutUrl?: string;
  allowedSchemes?: Scheme[];
  feeBearer?: FeeBearer;
  taxRateBps?: number;
  /** Public discovery opt-in (default false) — see AlyteMerchant.updateShopDiscovery. */
  discoverable?: boolean;
  imageUrl?: string;
  /** The ONE partner origin allowed to embed the authorize page (G14). */
  embedOrigin?: string;
}

export interface EventItem {
  id: string;
  merchantId: string;
  title: string;
  /** ISO-8601 start time. */
  startsAt: string;
}

export interface Tier {
  id: string;
  eventId: string;
  title: string;
  /** Integer minor units (cents). NEVER a float. */
  priceMinor: number;
  currency: string;
  kind: TierKind;
  availableCount?: number;
  // Restrictions — all enforced server-side; undefined = unrestricted.
  maxQtyPerPurchase?: number;
  sellable?: boolean;
  onSaleStart?: string;
  onSaleEnd?: string;
  allowedGeos?: string[];
  allowedSchemes?: Scheme[];
}

/** Temporal availability, derived server-side at discovery time. */
export type AvailabilityState =
  | 'on_sale'
  | 'not_yet_on_sale'
  | 'sale_ended'
  | 'sold_out'
  | 'not_sellable';

export interface DiscoveredTier extends Tier {
  state: AvailabilityState;
  /** Seconds until worth retrying, present when the sale hasn't opened. */
  retryAfter?: number;
  /** Present when a future purchase could still serve (drop CTA). */
  authorizeUrl?: string;
}

export interface DiscoveredEvent extends EventItem {
  tiers: DiscoveredTier[];
}

/** A price snapshot locked at quote time; the charge must match it. */
export interface Quote {
  id: string;
  tierId: string;
  quantity: number;
  unitPriceMinor: number;
  subtotalMinor: number;
  taxMinor: number;
  processingFeeMinor: number;
  /** Alyte's fee — INVOICED to the merchant, never part of the buyer's charge. */
  agentFeeMinor: number;
  /** What the buyer's card is authorised for (depends on feeBearer). */
  chargeMinor: number;
  pspId?: string;
  feeBearer: FeeBearer;
  currency: string;
  /** ISO-8601; re-quote after this. */
  expiresAt: string;
  createdAt: string;
}

/** A perishable, oversell-proof reservation. */
export interface Hold {
  id: string;
  tierId: string;
  seatId?: string;
  quantity: number;
  status: 'held' | 'confirmed' | 'released' | 'expired';
  expiresAt: string;
  createdAt: string;
  /** Present on a partial fill (allowPartial: true). */
  requestedQuantity?: number;
  partialReason?: string;
}

export interface PaymentResult {
  intentId: string;
  status: string;
  psp?: string;
  amountMinor?: number;
  currency?: string;
  [k: string]: unknown;
}

export type ConfirmOutcome =
  | { status: 'settled'; result: PaymentResult; holdStatus: string }
  | { status: 'sca_required'; challenge: { continueToken: string; [k: string]: unknown }; holdStatus: 'held' }
  | { status: 'sca_failed'; holdStatus: 'released' };

export interface MerchantPspLink {
  pspId: string;
  name: string;
  isDefault: boolean;
  rateBps: number;
  /** Opaque reference to the merchant's vaulted PSP secret — never the secret. */
  credentialRef?: string;
  publishableKey?: string;
}

export interface CatalogMerchant extends Merchant {
  events: Array<EventItem & { tiers: Tier[] }>;
}

export interface BuyerSessionMint {
  ok: boolean;
  /** Deterministic buyer identity (byr_…) — stable across mint & magic-link logins. */
  buyerId: string;
  expiresAt: string;
  /** RELATIVE single-use redeem path — compose with your Alyte base URL and
   *  redirect your user there to drop them into the shop's authorize page. */
  redeemPath: string;
}
