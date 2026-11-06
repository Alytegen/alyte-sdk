import type { Hold, PaymentResult, Quote, Scheme } from './types.js';

/** One requested tier in an all-or-nothing basket. Repeated tiers are merged by the server. */
export interface BasketLineInput {
  tierId: string;
  /** Whole units, 1..999 per submitted line. Partial fills are not supported. */
  quantity: number;
}

export interface ReserveBasketInput {
  /** 1..20 lines from one merchant, in one currency. */
  lines: BasketLineInput[];
  scheme?: Scheme;
  geo?: string;
}

export type ReservationStatus = 'held' | 'confirmed' | 'released' | 'expired' | 'reconcile';

/** A reservation line is a hold; reconcile protects stock while a payment is uncertain. */
export interface ReservationLine extends Omit<Hold, 'status'> {
  tenantId: string;
  reservationId?: string;
  status: ReservationStatus;
  confirmToken?: string;
}

export interface Reservation {
  id: string;
  tenantId: string;
  merchantId: string;
  /** Derived from the lines, including reconciliation protection. */
  status: ReservationStatus;
  lines: ReservationLine[];
  /** Original number of lines; fewer remaining lines means an incomplete basket. */
  lineCount?: number;
  expiresAt: string;
  createdAt: string;
  confirmToken?: string;
}

export interface BasketQuoteLine {
  lineNo: number;
  tierId: string;
  holdId?: string;
  quantity: number;
  unitPriceMinor: number;
  subtotalMinor: number;
}

/** One locked total, with per-line prices. A basket has no single unit price or tier ID. */
export interface BasketQuote extends Omit<Quote, 'tierId' | 'unitPriceMinor'> {
  reservationId: string;
  lines: BasketQuoteLine[];
}

/** The server derives the amount and authority from the quote and authenticated principal. */
export interface ConfirmReservationInput {
  quoteId: string;
  instrumentToken: string;
  scheme: Scheme;
  geo: string;
}

/** Fulfil only a settled/authorized result with confirmed inventory. An error result
 * with reconcile inventory is uncertain, not a known decline or permission to re-charge. */
export type ConfirmReservationOutcome =
  | { status: 'settled'; result: PaymentResult; reservationStatus: string; reservation?: Reservation }
  | { status: 'payment_pending'; result: PaymentResult; reservationStatus: string }
  | { status: 'sca_required'; challenge: { continueToken: string; [k: string]: unknown }; reservationStatus: 'held' }
  | { status: 'sca_failed'; reservationStatus: 'released' };

/** REST deliberately sends completed refusals and uncertain outcomes as HTTP 402.
 * Only recognize that documented union; ordinary error envelopes still throw. */
export function isReservationRefusal(value: unknown): value is ConfirmReservationOutcome {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  if (body.status === 'sca_failed') return body.reservationStatus === 'released';
  if (body.status !== 'settled' || typeof body.reservationStatus !== 'string' || !body.result || typeof body.result !== 'object') return false;
  const result = body.result as Record<string, unknown>;
  return typeof result.intentId === 'string' && (result.status === 'declined' || result.status === 'error');
}
