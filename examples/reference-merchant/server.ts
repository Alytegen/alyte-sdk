/**
 * THE REFERENCE INTEGRATION — a complete, runnable merchant server.
 *
 * It is deliberately one file and has no dependencies beyond the SDK and Node,
 * so you can read the whole integration in one sitting and then delete the
 * parts you don't need.
 *
 * It covers exactly the three things a working integration must do:
 *
 *   1. HAND OFF to the buyer          → GET  /buy/:tierId
 *   2. RECEIVE the purchase           → POST /hooks/alyte   (signed, at-least-once)
 *   3. FULFIL exactly once            → issueTickets(), inside ONE transaction
 *
 * ...and the fourth thing you will need the first time something goes wrong:
 *
 *   4. DIAGNOSE without asking us     → GET  /admin/why/:watchId
 *
 * Run it:
 *
 *   ALYTE_BASE_URL=https://alyte-sandbox-f365cfb3ma-ey.a.run.app \
 *   ALYTE_API_TOKEN=alyte_sk_… \
 *   ALYTE_WEBHOOK_SECRET=whsec_… \
 *   npx tsx server.ts
 *
 * The store here is an in-memory Map standing in for your database. It is the
 * ONLY part you must replace — and §3 explains exactly why the shape matters.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createWebhookHandler, type PaymentSettled, type WatchFailed } from '@alyte/sdk';

const BASE_URL = required('ALYTE_BASE_URL');
const API_TOKEN = required('ALYTE_API_TOKEN');
const WEBHOOK_SECRET = required('ALYTE_WEBHOOK_SECRET');
const PORT = Number(process.env.PORT ?? 8099);

function required(name: string): string {
  const v = process.env[name];
  if (!v) { console.error(`Missing ${name}`); process.exit(1); }
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// Your database, stubbed. Replace with the real thing — keep the SHAPE.
// ─────────────────────────────────────────────────────────────────────────────
const tickets = new Map<string, { tierId: string; quantity: number; buyerRef: string }>();
const handledEvents = new Set<string>();
const notifications: Array<{ buyerRef: string; message: string }> = [];

/**
 * §3 · FULFILMENT, EXACTLY ONCE.
 *
 * Deliveries are at-least-once: we retry until we see a 2xx, so this function
 * CAN be called twice for one sale — most often when your handler succeeded but
 * the response never got back to us.
 *
 * The dangerous window is not between deliveries, it is inside this function.
 * Issue the ticket and crash before recording "handled" → a retry double-issues.
 * Record first and crash → the buyer paid and got nothing.
 *
 * The only fix is to make both facts commit together. In real code that is one
 * database transaction:
 *
 *   await db.transaction(async (tx) => {
 *     const claimed = await tx.query(
 *       `INSERT INTO handled_events (event_id) VALUES ($1)
 *        ON CONFLICT DO NOTHING RETURNING event_id`, [eventId]);
 *     if (!claimed.rowCount) return;            // a retry — already fulfilled
 *     await tx.query(`INSERT INTO tickets (...) VALUES (...)`);
 *   });
 *
 * Claim FIRST inside the transaction, then do the work. If anything throws, the
 * whole thing rolls back and the retry finds the claim gone and tries again.
 */
function issueTickets(eventId: string, p: PaymentSettled): 'issued' | 'already-issued' {
  if (handledEvents.has(eventId)) return 'already-issued';   // stands in for ON CONFLICT DO NOTHING
  handledEvents.add(eventId);

  // Fulfil on tierId + quantity — NEVER by matching the amount back to a price.
  // Prices change, tiers don't, and two tiers can cost the same.
  tickets.set(eventId, { tierId: p.tierId, quantity: p.quantity, buyerRef: p.buyerRef });
  return 'issued';
}

// ─────────────────────────────────────────────────────────────────────────────
// §2 · RECEIVE. Verify, then dispatch. The SDK does not dedupe for you.
// ─────────────────────────────────────────────────────────────────────────────
const onAlyteWebhook = createWebhookHandler({ secret: WEBHOOK_SECRET }, {
  onSettled: async (payment: PaymentSettled, event) => {
    const outcome = issueTickets(event.eventId, payment);
    console.log(`[settled] ${event.eventId} · ${payment.quantity}× ${payment.tierId} · ${outcome}`);
    // If this throws, we return 5xx below and Alyte retries (30s → 1h, 10 times).
  },

  onWatchFailed: async (watch: WatchFailed) => {
    // A queued purchase refused. THIS IS TERMINAL — the watch does not retry,
    // so this is your only chance to tell the buyer. Relay reason.message
    // as-authored; it is written to be read by a person.
    notifications.push({ buyerRef: watch.buyerRef, message: watch.reason.message });
    console.log(`[refused] ${watch.watchId} · ${watch.reason.code} · "${watch.reason.message}"`);
  },

  onTest: async (event) => {
    // Carries no payment data. Use it to prove your signature check works
    // BEFORE a real sale depends on it. Never fulfil on it.
    console.log(`[test] signature verified · ${event.eventId}`);
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 · DIAGNOSE. Answer "what happened to that purchase?" yourself.
// ─────────────────────────────────────────────────────────────────────────────
async function whyDidThisNotBuy(watchId: string): Promise<unknown> {
  // Most refusals happen BEFORE a payment exists (the spend cap is checked
  // first), so there is often no intentId to look up — this is the entry point
  // that always works. `deliveries` tells you whether WE sent the webhook and
  // what your endpoint said back.
  const res = await fetch(`${BASE_URL}/v1/integration/watches/${watchId}`, {
    headers: { authorization: `Bearer ${API_TOKEN}` },
  });
  if (!res.ok) throw new Error(`lookup failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Wiring
// ─────────────────────────────────────────────────────────────────────────────
function readRawBody(req: IncomingMessage): Promise<string> {
  // RAW bytes. Do not use a JSON body parser on this route — verification is
  // over the exact bytes we signed, and parse-then-restringify breaks it.
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(typeof body === 'string' ? JSON.stringify({ message: body }) : JSON.stringify(body, null, 2));
  };

  try {
    // §1 · HAND OFF. There is no merchant-side "buy" call, by design: your
    // token cannot spend. You send the buyer to their own authorize page, and
    // they approve in their own session. One URL, no API call.
    if (req.method === 'GET' && url.pathname.startsWith('/buy/')) {
      const tierId = url.pathname.slice('/buy/'.length);
      const merchantId = process.env.ALYTE_MERCHANT_ID ?? 'mrc_your_id';
      const handoff = `${BASE_URL}/shop/${merchantId}/authorize?tier=${encodeURIComponent(tierId)}`;
      res.writeHead(302, { location: handoff });
      return res.end();
    }

    if (req.method === 'POST' && url.pathname === '/hooks/alyte') {
      const raw = await readRawBody(req);
      const result = await onAlyteWebhook(raw, req.headers['alyte-signature'] as string | undefined);
      // 200 = we stop retrying. Only say it when the work is durably done.
      return send(result.status, result.ok ? { ok: true } : { error: result.error });
    }

    if (req.method === 'GET' && url.pathname.startsWith('/admin/why/')) {
      return send(200, await whyDidThisNotBuy(url.pathname.slice('/admin/why/'.length)));
    }

    if (req.method === 'GET' && url.pathname === '/admin/state') {
      return send(200, { tickets: [...tickets.entries()], notifications });
    }

    return send(404, 'not found');
  } catch (err) {
    // A throw from a handler lands here. Returning 5xx is CORRECT: it tells
    // Alyte to retry. Returning 200 on failure loses the event permanently.
    console.error('[error]', err);
    return send(500, { error: (err as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`reference merchant on http://localhost:${PORT}`);
  console.log(`  hand-off    GET  /buy/:tierId`);
  console.log(`  webhook     POST /hooks/alyte`);
  console.log(`  diagnose    GET  /admin/why/:watchId`);
  console.log(`  state       GET  /admin/state`);
  console.log(`\nVerify your signature check before a real sale:`);
  console.log(`  1. expose this server (e.g. a tunnel) and register the URL as a webhook endpoint`);
  console.log(`  2. POST /v1/integration/webhooks/:id/test  → you should see "[test] signature verified"`);
});
