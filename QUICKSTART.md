# @alytegen/sdk — quickstart

Choose the credential for the runtime:

| Client | Credential | Runs | Does |
|---|---|---|---|
| `AlyteMerchant` | API token (console → API keys, `merchant:read`/`merchant:write`) | **your server only** | catalog CRUD, PSP links, payments visibility, buyer-session mint |
| `AlyteAgent` | agent JWT | your agent runtime | discover → quote → hold → confirm |
| `@alytegen/sdk/browser` | bounded buyer bearer | your chat page | embedded consent and purchases using the buyer's Alyte agent |

```bash
npm install @alytegen/sdk        # zero dependencies, Node ≥18 (built-in fetch)
```

## Merchant: onboard in five calls

```ts
import { AlyteMerchant } from '@alytegen/sdk';

const alyte = new AlyteMerchant({ baseUrl: ALYTE_URL, token: API_TOKEN });

const { merchant } = await alyte.createShop({ name: 'Nova Live', geo: 'DE', currency: 'EUR' });
await alyte.linkPsp(merchant.id, {                    // YOUR Stripe — money settles to YOU
  psp: { id: 'stripe', name: 'Stripe' }, isDefault: true,
  secret: MY_STRIPE_SK,                               // → vaulted; only an opaque ref persists
  publishableKey: MY_STRIPE_PK,                       // powers the buyer card-capture iframe
});
const { event } = await alyte.createEvent({ merchantId: merchant.id, title: 'Warsaw', startsAt: '2026-11-04T19:00:00Z' });
const { tier } = await alyte.createTier({ eventId: event.id, title: 'GA', priceMinor: 4900, currency: 'EUR', kind: 'general', availableCount: 500 });
```

Money is **integer minor units** everywhere (`4900` = €49.00). Floats are refused.

## Plugging in YOUR auth + user database (required for buyer flows)

Your customers already have accounts with you — Alyte does not replace that.
When a signed-in user wants an AI agent shopping for them, **your server attests
them** and you redirect:

```ts
const s = await alyte.buyerSessions.mint({
  merchantId: merchant.id, email: user.email,
  lang: user.locale,          // optional: Alyte's pages open in the language of YOUR site
});
res.redirect(ALYTE_URL + s.redeemPath);   // single-use, 15-min TTL
```

Embedding in a chat? Follow [BROWSER.md](./BROWSER.md) to exchange the single-use
token and launch consent without third-party cookies. Directly framing the full
authorize page is also supported, but its cookie session depends on browser policy.

They land authenticated on the shop's authorize page: pick or bring an agent,
set a spending cap and scope — all enforced server-side by Alyte on every
purchase. `buyerId` is deterministic per email, so the same user arriving later
via the email magic-link fallback is the same buyer.

## Agent: the buy path

```ts
import { AlyteAgent } from '@alytegen/sdk';
const agent = new AlyteAgent({ baseUrl: ALYTE_URL, token: AGENT_JWT });

const { events } = await agent.discoverInventory(merchantId);   // live availability + on-sale windows
const quote = await agent.quote({ tierId, quantity: 2 });        // price LOCKED until expiresAt
const hold  = await agent.reserve({ tierId, quantity: 2 });      // oversell-proof, auto-releasing
const out   = await agent.confirm(hold.id,
  { quoteId: quote.id, instrumentToken, scheme: 'visa', geo: 'DE' },
  { idempotencyKey: crypto.randomUUID() });                      // retries can never double-charge
```

No amount is ever passed at confirm — the charge is the locked quote. Refusals
throw `AlyteApiError` with a **stable `code`**: a spend-cap refusal means the
buyer's mandate said no; surface it, don't retry.

Full runnable examples: [`examples/merchant-onboard.ts`](https://github.com/Alytegen/alyte-sdk/blob/main/examples/merchant-onboard.ts),
[`examples/agent-buy.ts`](https://github.com/Alytegen/alyte-sdk/blob/main/examples/agent-buy.ts), and the complete
reference integration — buyer hand-off, signed webhook receipt, exactly-once fulfilment, self-diagnosis — in
[`examples/reference-merchant/server.ts`](https://github.com/Alytegen/alyte-sdk/blob/main/examples/reference-merchant/server.ts).
