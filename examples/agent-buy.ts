/**
 * The agent buy path: discover → quote → hold → confirm. Requires an agent JWT
 * (catalog:read + payments:write) whose mandate covers the purchase.
 *
 *   ALYTE_BASE_URL=… ALYTE_AGENT_TOKEN=… npx tsx agent-buy.ts
 */
import { randomUUID } from 'node:crypto';
import { AlyteAgent, AlyteApiError } from '@alytegen/sdk';

const agent = new AlyteAgent({
  baseUrl: process.env.ALYTE_BASE_URL!,
  token: process.env.ALYTE_AGENT_TOKEN!,
});

// 1 · Discover. `state` is live truth: a drop that hasn't opened says so, with a retryAfter.
const { merchants } = await agent.listMerchants();
const { events } = await agent.discoverInventory(merchants[0]!.id);
const tier = events.flatMap((e) => e.tiers).find((t) => t.state === 'on_sale');
if (!tier) throw new Error('nothing on sale right now');

// 2 · Quote — the price is LOCKED until expiresAt. No amount is ever passed again.
const quote = await agent.quote({ tierId: tier.id, quantity: 2 });

// 3 · Hold — oversell-proof; auto-releases if you don't confirm in time.
const hold = await agent.reserve({ tierId: tier.id, quantity: 2, scheme: 'visa', geo: 'DE' });

// 4 · Confirm — pays the locked quote. The idempotencyKey makes retries safe:
//     the same key can NEVER double-charge, even across crashes.
const [instrument] = (await agent.listInstruments()).instruments;
try {
  const outcome = await agent.confirm(
    hold.id,
    { quoteId: quote.id, instrumentToken: instrument!.token, scheme: 'visa', geo: 'DE' },
    { idempotencyKey: randomUUID() },
  );
  if (outcome.status === 'settled') console.log('paid:', outcome.result.intentId);
  else if (outcome.status === 'sca_required') {
    // The buyer approves out-of-band; then:
    console.log('resume with:', outcome.challenge.continueToken);
  }
} catch (e) {
  if (e instanceof AlyteApiError) {
    // Stable taxonomy codes — e.g. a spend-cap refusal means the MANDATE said no;
    // don't retry, tell the buyer.
    console.error(`refused [${e.code}]: ${e.message}`);
  } else throw e;
}
