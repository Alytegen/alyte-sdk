/**
 * Merchant onboarding, end to end: shop → PSP → event → tier → your user shopping.
 *
 *   ALYTE_BASE_URL=https://alyte-sandbox-….run.app \
 *   ALYTE_API_TOKEN=<console-minted, merchant:read+merchant:write> \
 *   npx tsx merchant-onboard.ts
 */
import { AlyteMerchant } from '@alyte/sdk';

const alyte = new AlyteMerchant({
  baseUrl: process.env.ALYTE_BASE_URL!,
  token: process.env.ALYTE_API_TOKEN!, // secret — server-side only
});

// 1 · The shop (your settlement identity — money lands on YOUR PSP, never Alyte's).
const { merchant } = await alyte.createShop({ name: 'Nova Live', geo: 'DE', currency: 'EUR' });

// 2 · Your OWN Stripe. The secret goes straight to Alyte's vault — you get back an
//     opaque ref; the pk_ powers the buyer card-capture iframe.
await alyte.linkPsp(merchant.id, {
  psp: { id: 'stripe', name: 'Stripe' },
  isDefault: true,
  secret: process.env.MY_STRIPE_SECRET_KEY!,
  publishableKey: process.env.MY_STRIPE_PUBLISHABLE_KEY,
});

// 3 · Inventory. priceMinor is integer cents — 4900 = €49.00.
const { event } = await alyte.createEvent({
  merchantId: merchant.id,
  title: 'Nova Live — Warsaw',
  startsAt: '2026-11-04T19:00:00Z',
});
const { tier } = await alyte.createTier({
  eventId: event.id,
  title: 'General admission',
  priceMinor: 4900,
  currency: 'EUR',
  kind: 'general',
  availableCount: 500,
});
await alyte.updateTier(tier.id, { maxQtyPerPurchase: 4 });

// 4 · Your signed-in user wants their AI agent to buy for them. You already know
//     who they are — attest them; no email round-trip:
const session = await alyte.buyerSessions.mint({ merchantId: merchant.id, email: 'fan@example.com' });
console.log('Redirect your user to:', process.env.ALYTE_BASE_URL + session.redeemPath);
// They land authenticated on the shop's authorize page: pick/bring an agent,
// set a spending cap, done. Alyte enforces the cap server-side on every purchase.
