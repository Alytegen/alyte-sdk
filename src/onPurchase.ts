import { verifyWebhookSignature } from './webhookVerify.js';

/**
 * The envelope every Alyte webhook arrives in. `data` differs per `type`;
 * `eventId` is the dedupe key (stable across retries of the SAME event).
 */
export interface AlyteEventEnvelope<T = unknown> {
  /** Delivery id — CHANGES on every retry. Never dedupe on this. */
  id: string;
  type: string;
  /** Stable per logical event. THIS is your dedupe key. */
  eventId: string;
  createdAt: string;
  data: T;
}

/** A purchase that authorized and captured. Fulfil on `tierId` + `quantity`. */
export interface PaymentSettled {
  intentId: string;
  merchantId: string;
  /** Integer minor units. NEVER a float — see formatMinor for display. */
  amountMinor: number;
  currency: string;
  status: 'authorized';
  pspId: string;
  scheme?: string;
  source: string;
  createdBy: string;
  createdAt: string;
  /** Fulfil on THIS, never by matching the amount to a price. */
  tierId: string;
  quantity: number;
  /** Stable opaque buyer reference — never an email. */
  buyerRef: string;
}

/** A queued purchase that terminally refused. There is no retry after this. */
export interface WatchFailed {
  watchId: string;
  agentId: string;
  buyerRef: string;
  merchantId: string;
  tierId: string;
  quantity: number;
  /** The typed refusal, verbatim — relay `message` to the buyer. */
  reason: { code: string; message: string };
  failedAt: string;
}

/** A signed delivery carrying no payment data. NEVER fulfil on this. */
export interface WebhookTest {
  [key: string]: unknown;
}

export interface PurchaseHandlers {
  /** A purchase completed. Issue the ticket here. */
  onSettled?: (data: PaymentSettled, event: AlyteEventEnvelope<PaymentSettled>) => Promise<void> | void;
  /** A queued purchase terminally refused. Tell the buyer why. */
  onWatchFailed?: (data: WatchFailed, event: AlyteEventEnvelope<WatchFailed>) => Promise<void> | void;
  /** A test delivery — use it to prove your signature check works. */
  onTest?: (event: AlyteEventEnvelope<WebhookTest>) => Promise<void> | void;
  /** Any event type this SDK version does not know. Default: ignored. */
  onUnknown?: (event: AlyteEventEnvelope) => Promise<void> | void;
}

export interface OnPurchaseOptions {
  /** The signing secret, shown exactly once when the endpoint was created. */
  secret: string;
  /** Replay window in seconds (default 300). */
  toleranceSeconds?: number;
}

export type WebhookResult =
  | { ok: true; status: 200; eventId: string; type: string }
  | { ok: false; status: 400 | 401; error: string };

/**
 * Verify and dispatch one Alyte webhook delivery.
 *
 * ## Deliveries are AT-LEAST-ONCE, and your handler owns idempotency.
 *
 * We retry until we see a 2xx, so a handler CAN run more than once for the
 * same `eventId` — most commonly when your handler succeeded but the response
 * never reached us. This SDK deliberately does NOT dedupe for you: doing it
 * here would be a lie, because the dangerous window is not between deliveries,
 * it is inside your own process. If you issue a ticket and crash before
 * recording "handled", a retry double-issues; if you record first and crash,
 * the fulfilment is lost.
 *
 * Only your database can close that window, by writing the dedupe row in the
 * SAME transaction as the ticket:
 *
 * ```ts
 * await db.transaction(async (tx) => {
 *   const claimed = await tx.query(
 *     `INSERT INTO handled_events (event_id) VALUES ($1)
 *      ON CONFLICT DO NOTHING RETURNING event_id`, [event.eventId]);
 *   if (!claimed.rowCount) return;   // already done — a retry, not a new sale
 *   await tx.query(`INSERT INTO tickets (...) VALUES (...)`);
 * });
 * ```
 *
 * ## Failure behaviour
 *
 * - Bad/missing signature → `{ok: false, status: 401}`. Return that status; do
 *   NOT run your handler.
 * - Malformed body → `{ok: false, status: 400}`. We will not usefully retry it.
 * - Your handler THROWS → the error propagates. Return 5xx so we retry
 *   (30s → 1h backoff, 10 attempts). Swallowing it and returning 200 means the
 *   event is gone forever.
 *
 * Pass the RAW request body — verification is over exact bytes, so a parsed
 * and re-serialized object will fail even when the signature is valid.
 */
export async function handleWebhook(
  rawBody: string,
  signatureHeader: string | undefined,
  handlers: PurchaseHandlers,
  options: OnPurchaseOptions,
): Promise<WebhookResult> {
  if (!signatureHeader) return { ok: false, status: 401, error: 'missing alyte-signature header' };
  if (!verifyWebhookSignature(rawBody, signatureHeader, options.secret, options.toleranceSeconds)) {
    return { ok: false, status: 401, error: 'signature did not verify' };
  }

  let event: AlyteEventEnvelope;
  try {
    event = JSON.parse(rawBody) as AlyteEventEnvelope;
  } catch {
    return { ok: false, status: 400, error: 'body is not valid JSON' };
  }
  if (!event?.type || !event?.eventId) {
    return { ok: false, status: 400, error: 'not an Alyte event envelope' };
  }

  // A handler that throws propagates on purpose: the caller must return 5xx so
  // the delivery is retried rather than silently dropped.
  switch (event.type) {
    case 'payment.settled':
      await handlers.onSettled?.(event.data as PaymentSettled, event as AlyteEventEnvelope<PaymentSettled>);
      break;
    case 'watch.failed':
      await handlers.onWatchFailed?.(event.data as WatchFailed, event as AlyteEventEnvelope<WatchFailed>);
      break;
    case 'webhook.test':
      await handlers.onTest?.(event as AlyteEventEnvelope<WebhookTest>);
      break;
    default:
      await handlers.onUnknown?.(event);
      break;
  }
  return { ok: true, status: 200, eventId: event.eventId, type: event.type };
}

/**
 * The same dispatcher, curried for frameworks that want a reusable handler.
 *
 * ```ts
 * const onPurchase = createWebhookHandler({ secret: process.env.ALYTE_WEBHOOK_SECRET! }, {
 *   onSettled: async (p) => { await issueTickets(p.tierId, p.quantity, p.buyerRef); },
 *   onWatchFailed: async (w) => { await emailBuyer(w.buyerRef, w.reason.message); },
 * });
 *
 * // Express — note express.raw, NOT express.json
 * app.post('/hooks/alyte', express.raw({ type: 'application/json' }), async (req, res) => {
 *   const r = await onPurchase(req.body.toString('utf8'), req.header('alyte-signature'));
 *   res.status(r.status).send(r.ok ? 'ok' : r.error);
 * });
 * ```
 */
export function createWebhookHandler(
  options: OnPurchaseOptions,
  handlers: PurchaseHandlers,
): (rawBody: string, signatureHeader: string | undefined) => Promise<WebhookResult> {
  return (rawBody, signatureHeader) => handleWebhook(rawBody, signatureHeader, handlers, options);
}
