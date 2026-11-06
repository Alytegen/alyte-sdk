/** Reserve, quote and release a basket without charging.
 * ALYTE_BASE_URL=… ALYTE_AGENT_TOKEN=… ADULT_TIER_ID=… CHILD_TIER_ID=… npx tsx agent-basket.ts
 * Requires catalog:read + payments:read + payments:write and a covering mandate.
 */
import { AlyteAgent, type ConfirmReservationOutcome } from '@alytegen/sdk';

const agent = new AlyteAgent({ baseUrl: process.env.ALYTE_BASE_URL!, token: process.env.ALYTE_AGENT_TOKEN! });
const reservation = await agent.reserveBasket({ lines: [
  { tierId: process.env.ADULT_TIER_ID!, quantity: 2 },
  { tierId: process.env.CHILD_TIER_ID!, quantity: 1 },
], scheme: 'visa', geo: 'DE' });
const quote = await agent.quoteReservation(reservation.id);
console.log({ reservationId: reservation.id, quoteId: quote.id, lines: quote.lines,
  chargeMinor: quote.chargeMinor, currency: quote.currency, expiresAt: reservation.expiresAt });

// A real application persists the reservation, quote, instrument and idempotency
// key before calling confirmReservation. This example stops before any charge.
await agent.releaseReservation(reservation.id);

/** Interpret confirmation or resolveBasketSca results without treating an uncertain
 * payment as a decline. Only an authorized, confirmed basket may be fulfilled. */
export function purchaseState(outcome: ConfirmReservationOutcome): 'paid' | 'challenge' | 'refused' | 'pending' {
  if (outcome.status === 'sca_required') return 'challenge';
  if (outcome.status === 'sca_failed') return 'refused';
  if (outcome.status === 'payment_pending' || outcome.reservationStatus === 'reconcile') return 'pending';
  if (outcome.result.status === 'authorized' && outcome.reservationStatus === 'confirmed') return 'paid';
  return outcome.result.status === 'declined' ? 'refused' : 'pending';
}
