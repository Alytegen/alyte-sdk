# @alytegen/sdk

TypeScript client for [Alyte](https://alytegen.com) — the authority layer that lets a buyer
hand an AI agent a bounded mandate (spend cap, shop, expiry) and lets a merchant sell to that
agent on the merchant's **own** payment provider. Alyte never holds funds: money settles
between the buyer and the merchant's Stripe or Adyen account.

- Zero runtime dependencies. Node ≥ 18 (built-in `fetch`). ESM.
- Hand-typed against the server's own schemas; every refusal is an `AlyteApiError` with a
  stable `code`.
- Money is **integer minor units** everywhere (`4900` = €49.00). Floats are refused.

```bash
npm install @alytegen/sdk
```

## Entry points

| Export | Credential | Runs where | Does |
|---|---|---|---|
| `AlyteMerchant` | API token (console → API keys) | your server only | shops, events, tiers, PSP links, buyer-session mint, payments visibility |
| `AlyteAgent` | agent JWT | your agent runtime | discover → quote → hold → confirm |
| `createWebhookHandler` / `verifyWebhookSignature` | webhook secret | your server | signed, at-least-once purchase events with typed dispatch |
| `exchangeBuyerSession` / `createBuyerClient` / `openConsent` from `@alytegen/sdk/browser` | bounded buyer bearer | partner browser/chat | isolated consent, then buy/watch/list/revoke within existing authority |

The browser entry is new in 0.4.0. See [the chat integration](./BROWSER.md) for setup,
cookie-independent consent, reconnecting and handling uncertain purchases.

## Merchant: onboard in four calls

```ts
import { AlyteMerchant } from '@alytegen/sdk';

const alyte = new AlyteMerchant({ baseUrl: ALYTE_URL, token: API_TOKEN });

const { merchant } = await alyte.createShop({ name: 'Nova Live', geo: 'DE', currency: 'EUR' });
await alyte.linkPsp(merchant.id, {                 // YOUR Stripe — money settles to YOU
  psp: { id: 'stripe', name: 'Stripe' }, isDefault: true,
  secret: MY_STRIPE_SK,                            // vaulted; only an opaque reference persists
  publishableKey: MY_STRIPE_PK,                    // powers the buyer's card-capture frame
});
const { event } = await alyte.createEvent({ merchantId: merchant.id, title: 'Warsaw', startsAt: '2026-11-04T19:00:00Z' });
const { tier }  = await alyte.createTier({ eventId: event.id, title: 'GA', priceMinor: 4900, currency: 'EUR', kind: 'general', availableCount: 500 });
```

## Hand a signed-in customer to their agent

Your users already have accounts with you. Your server attests one of them and redirects;
they land authenticated on the shop's authorize page and grant their agent a mandate that
Alyte enforces on every purchase.

```ts
const s = await alyte.buyerSessions.mint({ merchantId: merchant.id, email: user.email });
res.redirect(ALYTE_URL + s.redeemPath);            // single-use, 15-minute link
```

## Receive purchases

```ts
import { createWebhookHandler } from '@alytegen/sdk';

const handler = createWebhookHandler({
  secret: ALYTE_WEBHOOK_SECRET,
  onPaymentSettled: async (evt) => issueTickets(evt),   // runs at least once — make it idempotent
  onWatchFailed:    async (evt) => notifyBuyer(evt),
});
```

## Agent: the buy path

```ts
import { AlyteAgent } from '@alytegen/sdk';

const agent = new AlyteAgent({ baseUrl: ALYTE_URL, token: AGENT_JWT });
const quote = await agent.quote({ tierId, quantity: 2 });        // price locked until expiresAt
const hold  = await agent.reserve({ tierId, quantity: 2 });      // oversell-proof, auto-releasing
const out   = await agent.confirm(hold.id,
  { quoteId: quote.id, instrumentToken, scheme: 'visa', geo: 'DE' },
  { idempotencyKey: crypto.randomUUID() });                      // retries never double-charge
```

No amount is passed at confirm — the charge is the locked quote. A spend-cap refusal means
the buyer's mandate said no: surface it, don't retry.

## Learn more

- [QUICKSTART.md](./QUICKSTART.md) — the walkthrough with every call explained.
- [`examples/reference-merchant/server.ts`](./examples/reference-merchant/server.ts) — a
  complete, one-file merchant server: hand-off, webhook receipt, exactly-once fulfilment,
  and a diagnostic endpoint for when something goes wrong.
- [`examples/merchant-onboard.ts`](./examples/merchant-onboard.ts),
  [`examples/agent-buy.ts`](./examples/agent-buy.ts) — the two paths above, runnable.
- Issues and questions: <https://github.com/Alytegen/alyte-sdk/issues>.

## License

MIT — see [LICENSE](./LICENSE).
