# Buyer purchases inside your chat

Available in SDK 0.4.0 with Alyte's Model 1 browser endpoints. The merchant token
stays on your backend. Your chat receives a short-lived bounded buyer bearer;
creating or widening permission requires email verification inside Alyte's iframe.
The full verification bearer stays there. No raw agent credential reaches your chat.

## Register and attest

Register your exact HTTPS chat origin in the shop's `embedOrigin` (multiple origins
are comma-separated). This controls both framing and buyer CORS. New registrations
can take up to 30 seconds to reach preflight caches. Local HTTP development is supported.
On your backend, authenticate your own user, derive their email from that session,
then call `merchant.buyerSessions.mint({ merchantId, email })`. Return only the `token`
query value extracted from `new URL(session.redeemPath, ALYTE_URL)` to that user's
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
  theme: { accent: '#006466', font: 'sans', radius: 8, scheme: 'light' },
});
```

Keep the connection in memory. It expires after 30 minutes (`expiresAt`). On expiry
or a `401 unauthorized`, ask your backend for a fresh mint and exchange it; a replayed
or expired mint returns `401 link_invalid`. Create a new client with the new bearer.
Cookie login endpoints are not available to the parent chat.

The iframe lets the buyer choose an existing usable Alyte agent/permission or
create one. Selecting an existing permission needs no new email verification.
Creating authority does. Completion returns IDs only and removes the iframe.
Cancellation/abort rejects with `AlyteConsentError.code = 'consent_cancelled'`;
an initial handshake timeout uses `consent_unavailable`. Server errors retain their
code. `readyTimeoutMs` defaults to 15 seconds and never limits code-entry time.

Optional `returnUrl` must belong to the chat origin. `onNavigate(url)` decides how
your chat handles the Back link. The SDK does not navigate the host automatically.
Themes accept only `accent`, `background`, `surface`, `text`, `font`, `radius`, `scheme`.
Colours are opaque hex; font is system/sans/serif, radius is 0–16, scheme light/dark.
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
live availability. A bounded bearer cannot create or widen spending authority.

Your backend still fulfills from verified settlement webhooks, idempotently.
Browser completion messages are presentation state, not fulfillment evidence.
