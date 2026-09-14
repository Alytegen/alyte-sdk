import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verify an Alyte webhook delivery. The signature is an HMAC-SHA256 over the RAW
 * request body, timestamp-prefixed (Stripe-shaped):
 *
 *   alyte-signature: t=<unix-seconds>,v1=hex( hmac_sha256(secret, `${t}.${rawBody}`) )
 *
 * Verify against the RAW bytes, before any JSON parse/re-serialize — most
 * frameworks need a raw-body handler on the webhook route. Deliveries are
 * at-least-once: dedupe by the event's `eventId` (the payment's intentId).
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  toleranceSeconds = 300,
): boolean {
  const t = /(?:^|,)t=(\d+)/.exec(signatureHeader)?.[1];
  const v1 = /(?:^|,)v1=([0-9a-f]+)/.exec(signatureHeader)?.[1];
  if (!t || !v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSeconds) return false; // replay window
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  if (expected.length !== v1.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}
