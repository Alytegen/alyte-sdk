import type { FeeBearer, Scheme, TierKind } from './types.js';

/** One capacity counter shared by the merchant's offers. */
export interface InventoryPool {
  id: string;
  tenantId: string;
  merchantId: string;
  eventId?: string;
  title: string;
  capacity: number;
  availableCount: number;
  authority: 'local';
  createdAt: string;
}

/** Optional place metadata owned by a shop, not another merchant or account. */
export interface InventoryLocation {
  tenantId: string;
  storeId: string;
  id: string;
  revision: number;
  name: string;
  timeZone: string;
}

export interface InventoryOccurrence {
  tenantId: string;
  storeId: string;
  id: string;
  kind: 'occurrence';
  source: 'native' | 'ticketing';
  startsAt: string;
  endsAt: string | null;
  /** Versions the location binding, not the event's schedule. */
  metadataRevision: number;
  location: InventoryLocation | null;
}

export type InventoryLocationBinding =
  | { locationId: string; expectedRevision: number; expectedLocationRevision: number }
  | { locationId: null; expectedRevision: number; expectedLocationRevision?: never };

export interface InventoryRef<K extends string> {
  kind: K;
  id: string;
  tenantId: string;
  storeId: string;
}
export type InventorySourceRef = InventoryRef<'ticketing.tier_counter' | 'ticketing.pool' | 'ticketing.seat_set'>;

/** Current stock/price observation, not a quote, reservation or authorization.
 * The merchant can still manage its inventory through the write methods. */
export interface InventoryCatalog {
  schemaVersion: 1;
  profile: 'ticketing';
  use: 'inventory_observation';
  tenantId: string;
  storeId: string;
  observedAt: string;
  storePolicy: { geo: string; currency: string; allowedSchemes?: Scheme[]; feeBearer: FeeBearer; taxRateBps: number };
  checkout: { mode: 'api' | 'hosted'; url: string | null };
  /** Generic transaction operations are not implemented. These are not token permissions. */
  capabilities: { reserve: false; quote: false; purchase: false };
  products: Array<{ ref: InventoryRef<'product'>; title: string }>;
  variants: Array<{ ref: InventoryRef<'variant'>; product: InventoryRef<'product'>; title: string }>;
  slots: Array<{
    ref: InventoryRef<'slot'>;
    startsAt: string;
    endsAt: string | null;
    timeZone: string | null;
    metadataRevision: number | null;
    location: (InventoryRef<'location'> & { revision: number; name: string }) | null;
  }>;
  offers: Array<{
    ref: InventoryRef<'offer'>;
    variant: InventoryRef<'variant'>;
    slot: InventoryRef<'slot'>;
    title: string;
    /** Base unit price only; tax/processing fees are resolved by the quote path. */
    price: { kind: 'unit_base'; amountMinor: number; currency: string };
    termsVersion: null;
    sellable: boolean;
    quantity: { unit: 'item' | 'admission_place'; maxPerPurchase?: number };
    salesWindow: { start?: string; end?: string; startInclusive: boolean; endInclusive: boolean };
    eligibility: { principalRestricted: boolean; geos?: string[]; schemes?: Scheme[] };
    inventory: { source: InventorySourceRef; unitsPerItem: number };
    profile: { tierKind: TierKind };
  }>;
  inventory: Array<{
    ref: InventorySourceRef;
    availability: { state: 'observed'; units: number } | { state: 'unknown' };
  }>;
}
