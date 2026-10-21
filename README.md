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

The browser entry arrived in 0.4.0; 0.6.0 is the current release. See [the chat integration](./BROWSER.md) for setup,
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

## Inventory management

Available since SDK 0.6.0.

The merchant can operate the venue and own its inventory. One API credential with
`merchant:read` and `merchant:write` manages both. A location is optional place and
time-zone metadata under the shop, not a separate account.

```ts
const { location } = await alyte.createLocation(merchant.id, {
  name: 'Our theatre', timeZone: 'Europe/London',
});
const { event: show } = await alyte.createEvent({
  merchantId: merchant.id, title: 'Evening show', startsAt: '2027-05-01T20:00:00+01:00',
  location: { id: location.id, expectedRevision: location.revision }, // optional
});
const { pool } = await alyte.createPool({
  merchantId: merchant.id, eventId: show.id, title: 'General admission', capacity: 100,
});
await alyte.createTier({
  eventId: show.id, title: 'Adult', kind: 'general', priceMinor: 2500, currency: 'EUR', poolId: pool.id,
});
await alyte.createTier({
  eventId: show.id, title: 'Child', kind: 'general', priceMinor: 1500, currency: 'EUR', poolId: pool.id,
});
const { catalog: observation } = await alyte.inventoryCatalog(merchant.id);
// Both prices draw from one counter. The observation is not a reservation or quote.
```

Use `listPools` and `updatePool` to inspect or edit shared capacity. `availableCount`
sets remaining stock; it is not an increment. Omit it when only renaming a pool.
Pooled tiers cannot be restocked individually, and the server refuses capacity below
outstanding holds. `updateTier` still controls price, sale windows and sellability.

`listLocations`, `updateLocation`, `getSlot` and `setSlotLocation` manage optional
place metadata. Location changes require the revision you read. Existing occurrences
keep their pinned location version until explicitly rebound. Rebinding or clearing
a location does not reschedule the event. Pass `expectedOccurrenceRevision` to
`updateTier` when a sale-window edit depends on the slot's location; stale edits
return `commerce_schedule_conflict` and should be refreshed before retrying.

`inventoryCatalog` reports current base prices and stock, with no private buyer or
agent allow-lists. Its disabled generic transaction capabilities describe that
observation; they do not disable the merchant's stock-management methods. It fails
with `catalog_too_large` if any source relation exceeds 2,000 rows, including private
eligibility rows. `listLocations` has a separate 2,000-row bound. Neither returns a
truncated result.

## Access rules and membership (unreleased)

These methods are on the development branch and require the matching server; they are
**not included in npm 0.6.0**. Use a backend credential with `merchant:read` and
`merchant:write`. The console exposes the same flow to account owners.

An access rule grants an early window before a tier's general-sale opening. Create a
draft, review its current impact, then schedule it:

```ts
const { program } = await alyte.memberships.createProgram(merchant.id, {
  requestId: crypto.randomUUID(), name: 'Members', levels: ['Gold', 'Platinum'],
});
const { rule } = await alyte.accessRules.createDraft(merchant.id, {
  requestId: crypto.randomUUID(), offerId: tier.id, name: 'Member presale',
  audience: { kind: 'membership', programId: program.id, levels: ['Gold', 'Platinum'] },
  opensAt: '2027-05-01T09:00:00+01:00',
  closesAt: '2027-05-01T10:00:00+01:00', // must end by the tier's general-sale opening
});
const preview = await alyte.accessRules.preview(merchant.id, rule.id);
// Show preview.impact, preview.timeZone and the window to the operator for review.
const publication = {
  requestId: crypto.randomUUID(), expectedRevision: rule.revision, previewId: preview.id,
};
// Persist publication before dispatch; reuse exactly this input after an uncertain response.
const scheduled = await alyte.accessRules.schedule(merchant.id, rule.id, publication);
```

Persist **each** mutation's request UUID and input before dispatch. Exact replays are safe;
changed input requires a new UUID. `access_conflict` means refresh and review again.
Drafts remain inactive. To cancel, call `preview(shopId, ruleId, 'cancel')`, then
`cancel` with that preview ID, the current rule revision and a new request UUID.
Published rules cannot be edited.

The merchant supplies verified membership for the **Alyte buyer ID** returned as
`buyerId` by `buyerSessions.mint`. Store a mapping from your authenticated customer's
internal ID to this returned value, scoped to the Alyte account. Passing your own customer
ID directly will not match the buyer's Alyte agent. Obtain the identity during your existing
signed-in hand-off; never derive or guess it from an email address.

```ts
const session = await alyte.buyerSessions.mint({
  merchantId: merchant.id, email: user.email,
});
const evidence = {
  requestId: crypto.randomUUID(), sourceRevision: 1, level: 'Gold',
  validFrom: '2027-01-01T00:00:00Z', validUntil: '2028-01-01T00:00:00Z',
  evidenceRef: 'membership-system:record-123', revoked: false,
};
await alyte.memberships.upsert(merchant.id, program.id, session.buyerId, evidence);
// Revoke using a new requestId, a strictly greater sourceRevision, and revoked: true.
```

Levels are explicit, with no implied hierarchy. Membership does not grant payment permission.
Other audiences are `{ kind: 'everyone' }` and
`{ kind: 'scheme', schemes: ['amex'] }`; card eligibility uses the actual saved instrument.
Issuer claims and free-text loyalty claims are not accepted. All times require explicit offsets.
Impact counts are observations of access, not stock forecasts or guaranteed queue positions.

Deleting an offer archives its rules in the read API. `accessRules.list` omits them, so
they do not consume the active list's limit. `accessRules.get` still returns their historical
definition and revision with `status: 'archived'`; archived rules cannot be edited or published.

## Hand a signed-in customer to their agent

Your users already have accounts with you. Your server attests one of them and redirects;
they land authenticated on the shop's authorize page and grant their agent a mandate that
Alyte enforces on every purchase.

```ts
const s = await alyte.buyerSessions.mint({ merchantId: merchant.id, email: user.email });
res.redirect(ALYTE_URL + s.redeemPath);            // single-use, 15-minute link
```

Two kinds of session, decided by how you mint:

- **Ordinary** (above): the buyer can act inside permission they already granted. Creating or
  widening permission asks them to confirm a 6-digit code Alyte emails them, typed into Alyte's
  own screen — never into yours.
- **Merchant-attested** — for merchants Alyte staff have enabled under contract — lets the buyer
  create a permission **without the code**, within the ceilings staff set for your shop, because
  you vouch for your signed-in, email-verified customer. It needs a key holding only
  `mandates:attest` (the console offers **attest verified customers only** once enabled):

  ```ts
  const attesting = new AlyteMerchant({ baseUrl: ALYTE_URL, token: process.env.ALYTE_ATTEST_KEY! });
  const s = await attesting.buyerSessions.mint({ merchantId: merchant.id, email: user.email, merchantAttested: true });
  ```

  The buyer sees "Set up by {your shop}" on that agent and can revoke it. A grant outside the
  ceilings answers `403 merchant_consent_ceiling_exceeded` and Alyte's screen falls back to the
  buyer's own code; without the enablement, the mint answers `403 merchant_consent_not_enabled`.

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

## Current API and console capabilities

SDK **0.6.0** adds inventory management: shared pools (`createPool`, `listPools`, `updatePool`),
optional venue locations with pinned versions (`createLocation`, `listLocations`, `updateLocation`,
`getSlot`, `setSlotLocation`, `createEvent({ location })`) and a read-only `inventoryCatalog`
observation. **0.5.0** typed the merchant-attested mint (`merchantAttested: true`), alongside the browser
entry point and the typed tier-create restrictions (`onSaleStart`, `onSaleEnd`, `maxQtyPerPurchase`,
`sellable`, `allowedGeos`, `allowedSchemes` — put them in the initial `createTier` call so a
scheduled tier is never briefly on sale).

The console offers **attest verified customers only** while Alyte staff have enabled contracted
consent for your organization; that key holds only `mandates:attest`, and a read/write key does
not include it. Permission creation for everyone else goes through Alyte's consent screen with the
emailed code — there is no API for your code to create or widen a buyer's spending authority, by
design. Alyte's server runs Node 22; this SDK supports Node 18 and later.

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
