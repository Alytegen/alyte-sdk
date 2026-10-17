# Buyer purchases inside your chat

Available since SDK 0.4.0 with Alyte's Model 1 browser endpoints (0.5.0 types the attested
mint). The merchant token stays on your backend. Your chat receives a short-lived bounded
buyer bearer. How a permission gets created depends on the session you minted:
**merchant-attested** (enabled merchants, within staff-set ceilings) — Alyte's iframe creates
it on your attestation, no code; **ordinary** — the iframe asks the buyer to confirm a code
Alyte emails them. Either way the verification happens inside Alyte's iframe, and the full
verification bearer stays there. No raw agent credential reaches your chat.
Your pages and your backend must never call the step-up endpoints or handle the
buyer's verification code; the iframe does that. A code entered anywhere in your own
UI is a defect in the integration. The step-up endpoints refuse browser calls from
partner origins; that refusal is a browser boundary, not a substitute for this rule.

Prerequisite: this flow is offered to merchants onboarded under an Alyte contract,
which carries the rule above. Alyte is invite-onboarded and production keys need
Alyte's go-live approval; the contract is checked at those steps, not by the
minting or exchange endpoints themselves.

## Availability and contracted attestation

The separately enabled merchant-attested path can grant within staff-set
ceilings without the emailed code. Mint that session on your backend with an
attest-only key and `merchantAttested: true`, then exchange it and call
`openConsent` as below. SDK 0.5.0 types the mint field
(`buyerSessions.mint({ merchantId, email, merchantAttested: true })`); the
[REST example](https://alyte.mintlify.site/guides/console-api-keys) shows the same call without the SDK.
The API key never belongs in the browser. Removing staff enablement or revoking
the key removes the session's attestation exception.

The emailed-link confirmation flow proposed earlier is withdrawn and will not ship.
Ordinary sessions confirm the emailed verification code inside Alyte's iframe, and
the SDK has no pending-consent client methods.

## Register and attest

Register your exact HTTPS chat origin in the shop's `embedOrigin` (multiple origins
are comma-separated). This controls both framing and buyer CORS. New registrations
can take up to 30 seconds to reach preflight caches. Local HTTP development is supported.
On your backend, authenticate your own user, derive their email from that session,
then call `merchant.buyerSessions.mint({ merchantId, email })` — or, on a `mandates:attest`
key for an enabled merchant, `mint({ merchantId, email, merchantAttested: true })` so the
buyer can create a permission within your ceilings without the emailed code. Return only the
`token` query value extracted from `new URL(session.redeemPath, ALYTE_URL)` to that user's
browser. Do not navigate the redeem link too: either consumer uses the token once.
The mint endpoint must not accept an arbitrary browser-supplied email as identity.

## Connect and open consent

```ts
import { exchangeBuyerSession, createBuyerClient, openConsent } from '@alytegen/sdk/browser';

const connection = await exchangeBuyerSession({ baseUrl: ALYTE_URL, token });
const buyer = createBuyerClient({ baseUrl: ALYTE_URL, bearer: connection.bearer });
const controller = new AbortController(); // abort when your chat/modal closes
const { agentId, mandateId } = await openConsent({
  baseUrl: ALYTE_URL, merchantId, bearer: connection.bearer,
  container: document.querySelector<HTMLElement>('#alyte-consent')!,
  signal: controller.signal, lang: 'en',
  theme: { accent: '#006466', radius: 8, scheme: 'light' },
});
```

Keep the connection in memory. It expires after 30 minutes (`expiresAt`). On expiry
or a `401 unauthorized`, ask your backend for a fresh mint and exchange it; a replayed
or expired mint returns `401 link_invalid`. Create a new client with the new bearer.
Cookie login endpoints are not available to the parent chat.

The iframe lets the buyer choose an existing usable Alyte agent/permission or
create one. Selecting an existing permission needs no new email verification.
Creating authority does, except for an enabled merchant-attested session within
its ceilings. Completion returns IDs only and removes the iframe.
Cancellation/abort rejects with `AlyteConsentError.code = 'consent_cancelled'`;
an initial handshake timeout uses `consent_unavailable`. Server errors retain their
code. `readyTimeoutMs` defaults to 15 seconds and never limits code-entry time.

Optional `returnUrl` must belong to the chat origin. `onNavigate(url)` decides how
your chat handles the Back link. The SDK does not navigate the host automatically.
Themes accept only `accent`, `background`, `surface`, `text`, `font`, `radius`, `scheme`.
Colours are opaque hex; font is system/sans/serif, radius is 0–16, scheme light/dark.
Omit `font` to keep Alyte's self-hosted Hanken Grotesk. Explicit `system`, `sans` and
`serif` select system UI, Arial and Georgia respectively. Secondary text and dividers
are derived automatically from the palette while preserving readable contrast.
If contrast fails, all four colours fall back to scheme defaults; they are not
adjusted. Permission terms, errors and disabled controls keep fixed readable colours.
Provider card inputs keep their provider styling.

## Buy, watch and revoke

```ts
const attempt = { agentId, tierId, quantity: 1, attemptId: crypto.randomUUID() };
// Persist BEFORE sending. Use your app's durable purchase-attempt store; retain it
// across reloads and reconnects. Namespace it to this buyer/shop/cart.
await attempts.save(attempt);
const purchase = await buyer.buy(attempt);
if (purchase.status === 'pending') {
  const receipt = await buyer.payment(purchase.intentId); // refresh later if pending
}
```

The UUID is required; the SDK never invents one or retries requests automatically.
After a network failure, resume with the **same saved attempt**, including agent,
tier, quantity and ID. Never create a fresh attempt to retry an uncertain charge.
`settled` is success; `pending` remains unresolved. `sca_required` is an authentication
continuation requirement; browser SCA resume is not yet available. Do not treat it
as success or dispatch a new purchase. Non-2xx responses throw `AlyteApiError` with
`status`, `code` and `details`; purchase `402` outcome bodies are in `details`.

Other methods: `me()`, `catalog()`, `agents()`, `instruments()`, `instrumentCaps()`,
`watches()`, `watch({ agentId, tierId, quantity, expiresInDays? })`,
`cancelWatch(id)`, `revokeMandate(id)`. Revocation is immediate and server-enforced.
Every buy/watch still depends on the buyer's current mandate, card evidence and
live availability. An ordinary bounded bearer cannot create or widen spending authority.

Your backend still fulfills from verified settlement webhooks, idempotently.
Browser completion messages are presentation state, not fulfillment evidence.
