/** Browser-only buyer connection. No merchant key or raw agent credential belongs here. */
import { AlyteApiError } from './http.js';
import type { DiscoveredEvent, PaymentResult, Scheme } from './types.js';
export { AlyteApiError } from './http.js';

export interface BuyerConnection { bearer: string; buyerId: string; expiresAt: string }
export interface BuyerIdentity { tenantId: string; buyerId: string; email: string; merchantId: string; merchantName?: string; currency?: string; geo?: string; tier: 'bounded' | 'full' }
export interface BuyerMandate {
  id: string; agentId: string; capMinor: number; currency: string; spentMinor?: number;
  expiresAt?: string; status: 'active' | 'amended' | 'revoked'; recurring: boolean;
  maxTransactions?: number; cadence?: string;
  scope: { merchants?: string[]; events?: string[]; tierKinds?: ('general' | 'seated')[]; quantity?: { min?: number; max?: number; step?: number } };
}
export interface BuyerAgent {
  id: string; name: string; kind: 'alyte' | 'byoa'; spendCapMinor: number; scheme: Scheme;
  quantity: number; instrumentToken?: string; instrumentStatus?: 'ok' | 'missing'; mandates: BuyerMandate[];
}
export interface BuyerWatch {
  id: string; agentId: string; merchantId: string; tierId: string; quantity: number;
  status: 'queued' | 'paused' | 'firing' | 'awaiting_sca' | 'fired' | 'failed' | 'cancelled' | 'expired';
  result?: BuyerWatchResult; expiresAt?: string; createdAt: string; firedAt?: string;
  /** Absent on legacy watches and older servers: treat as availability. */
  conditionSpec?: WatchCondition;
  /** Server-computed place in line. Absent on older servers = unavailable, never position zero. */
  queue?: WatchQueueSnapshot;
}
/** A pending purchase keeps its original identity; openChallenge never buys or requeues it. */
export type BuyerWatchResult = Record<string, unknown> & {
  status?: string;
  purchaseId?: string;
  challenge?: { expiresAt: string };
  code?: string;
};
export type WatchCondition =
  | { kind: 'available' }
  | { kind: 'price_at_or_below'; maxChargeMinor: number; currency: 'EUR' | 'GBP' | 'USD' };
/** Unknown future values must render as a generic waiting state. */
export type WatchWaitingReason = 'access_window' | 'price_target' | 'stock' | 'whole_party' | (string & {});
export type QueuePlace =
  | { kind: 'assigned' | 'provisional'; position: number; requestsAhead: number }
  | { kind: 'unassigned'; reason: 'condition_not_met' | 'paused' | (string & {}) }
  | { kind: 'not_waiting'; reason: 'processing' | 'reconciling' | 'terminal' | (string & {}) }
  | { kind: 'unavailable' };
export interface WatchQueueSnapshot {
  schemaVersion: 1;
  /** Decimal monotonic sequence — compare with BigInt, never Number. */
  revision: string;
  observedAt: string;
  refreshAfterMs: number;
  /** `phaseId` 'general' or 'rule:<id>' (an access window, labelled by the merchant); a place counts within its phase. */
  queue: { id: string; label: string; phaseId?: string; phaseLabel?: string };
  policyVersion: string;
  place: QueuePlace;
  waitingReason?: WatchWaitingReason;
  nextEligibleAt?: string;
  observedChargeMinor?: number;
}
export interface WatchInstruction {
  /** Save the whole instruction (not the bearer) BEFORE sending; reuse this UUID after an uncertain response. */
  requestId: string;
  agentId: string;
  request: { kind: 'ticketing'; tierId: string; quantity: number };
  condition: WatchCondition;
  /** ISO-8601 with an explicit offset, e.g. 2026-11-01T12:00:00Z. */
  expiresAt: string;
}
export type BuyerPurchase =
  | { status: 'settled' | 'pending'; intentId: string; chargeMinor: number; currency: string; paymentState?: string; agentName?: string }
  | { status: 'sca_required'; purchaseId: string; challenge: { expiresAt: string } }
  | { status: 'sca_required'; purchaseId?: never; challenge?: never }
  | { status: 'pending'; purchaseId: string }
  | { status: 'refused' | 'error'; outcome: unknown };
export type BuyerPurchaseStatus = 'pending' | 'sca_required' | 'settled' | 'refused' | 'cancelled' | 'expired';
export interface BuyerPurchaseState { authenticationRetry?: boolean; provider?: 'stripe' | 'adyen'; purchaseId: string; status: BuyerPurchaseStatus; chargeMinor?: number; currency?: string; challenge?: { expiresAt: string }; result?: PaymentResult }
export interface BuyerReceipt { intentId: string; status: 'settled' | 'pending' | 'refused'; chargeMinor: number; currency: string; paymentState?: string }
export interface BuyerClientOptions { baseUrl: string; bearer: string; fetch?: typeof globalThis.fetch }

function baseOrigin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new TypeError('baseUrl must be an HTTP(S) origin');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new TypeError('baseUrl must use HTTPS outside local development');
  return url.origin;
}

/** HTTP errors retain the server taxonomy; no request is automatically retried. */
async function request<T>(fetcher: typeof globalThis.fetch, base: string, path: string, method: string, bearer?: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetcher(base + path, { method, credentials: 'omit', redirect: 'error', cache: 'no-store', signal,
    headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => undefined);
  if (!res.ok) {
    const error = json?.error;
    throw new AlyteApiError(res.status, error?.code ?? `http_${res.status}`, error?.message ?? `Alyte API error (HTTP ${res.status})`, error?.details ?? json);
  }
  return json as T;
}

/** Pass only the token from the merchant-minted redeemPath. Keep the result in memory. */
export function exchangeBuyerSession(opts: { baseUrl: string; token: string; fetch?: typeof globalThis.fetch }): Promise<BuyerConnection> {
  if (typeof opts.token !== 'string' || !opts.token) throw new TypeError('token is required');
  return request(opts.fetch ?? globalThis.fetch, baseOrigin(opts.baseUrl), '/v1/buyer/session-token', 'POST', undefined, { token: opts.token });
}

/** Existing-authority actions only. Setup and permission changes belong in openConsent. */
export function createBuyerClient(opts: BuyerClientOptions) {
  const base = baseOrigin(opts.baseUrl), fetcher = opts.fetch ?? globalThis.fetch;
  if (typeof opts.bearer !== 'string' || !opts.bearer) throw new TypeError('bearer is required');
  const call = <T>(method: string, path: string, body?: unknown, signal?: AbortSignal) => request<T>(fetcher, base, '/v1/buyer' + path, method, opts.bearer, body, signal);
  return {
    me: () => call<BuyerIdentity>('GET', '/me'),
    catalog: () => call<{ events: DiscoveredEvent[] }>('GET', '/catalog'),
    agents: () => call<{ agents: BuyerAgent[] }>('GET', '/agents'),
    instruments: () => call<{ instruments: Array<{ token: string; scheme: Scheme; last4: string; mine: boolean }> }>('GET', '/instruments'),
    instrumentCaps: () => call<{ caps: Array<{ instrumentToken: string; capMinor: number; currency: string; grantedMinor: number }> }>('GET', '/instruments/caps'),
    watches: () => call<{ watches: BuyerWatch[] }>('GET', '/watches'),
    /** Save attemptId BEFORE dispatch and reuse it after an uncertain response. Never retry with a new ID. */
    buy: (input: { agentId: string; tierId: string; quantity: number; attemptId: string }) => {
      if (typeof input.attemptId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.attemptId)) throw new TypeError('A saved UUID attemptId is required');
      return call<BuyerPurchase>('POST', `/agents/${encodeURIComponent(input.agentId)}/buy`, { tierId: input.tierId, quantity: input.quantity, attemptId: input.attemptId });
    },
    /** Recover this purchase; never start a new buy after an uncertain response or a challenge. */
    purchase: (purchaseId: string) => call<BuyerPurchaseState>('GET', `/purchases/${encodeURIComponent(purchaseId)}`),
    resumePurchase: (purchaseId: string) => call<BuyerPurchaseState>('POST', `/purchases/${encodeURIComponent(purchaseId)}/resume`, {}),
    cancelPurchase: (purchaseId: string) => call<BuyerPurchaseState>('POST', `/purchases/${encodeURIComponent(purchaseId)}/cancel`, {}),
    payment: (intentId: string) => call<BuyerReceipt>('GET', `/payments/${encodeURIComponent(intentId)}`),
    watch: (input: { agentId: string; tierId: string; quantity: number; expiresInDays?: number }) => call<{ watch: BuyerWatch }>('POST', '/watches', input),
    cancelWatch: (watchId: string) => call<{ watch: BuyerWatch }>('DELETE', `/watches/${encodeURIComponent(watchId)}`),
    /** What this deployment enforces. Discovery only — the server still refuses anything unsupported. */
    watchCapabilities: () => call<{ schemaVersion: 1; requestKinds: string[]; conditions: string[]; queuePolicy: string }>('GET', '/watch-capabilities'),
    /**
     * Conditional watch on its own strict route. Never falls back to `watch()` (which would drop the
     * condition) and never retries by itself: after an uncertain response, resend the SAME instruction.
     */
    createWatch: (input: WatchInstruction) => {
      if (typeof input.requestId !== 'string' || !UUID.test(input.requestId)) throw new TypeError('A saved UUID requestId is required');
      if (input.condition?.kind === 'price_at_or_below' && !Number.isSafeInteger(input.condition.maxChargeMinor)) throw new TypeError('maxChargeMinor must be an integer in minor units');
      return call<{ watch: BuyerWatch; replayed: boolean }>('POST', '/watch-requests', input);
    },
    getWatch: (watchId: string, init?: { signal?: AbortSignal }) => call<{ watch: BuyerWatch }>('GET', `/watches/${encodeURIComponent(watchId)}`, undefined, init?.signal),
    revokeMandate: (mandateId: string) => call<{ ok: true; id: string; status: 'revoked' }>('DELETE', `/mandates/${encodeURIComponent(mandateId)}`),
  };
}
export type BuyerClient = ReturnType<typeof createBuyerClient>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ObserveWatchOptions {
  client: Pick<BuyerClient, 'getWatch'>;
  watchId: string;
  signal: AbortSignal;
  onUpdate: (watch: BuyerWatch) => void;
  /** A read failed; `last` is the last snapshot, now stale. Polling continues with backoff unless `stopped`. */
  onError?: (error: unknown, last: BuyerWatch | undefined, stopped: boolean) => void;
}

const MIN_POLL_MS = 2000, MAX_POLL_MS = 60_000;

/**
 * Read-only polling of one watch: one request in flight, server-directed interval (bounded),
 * bounded backoff on read failures, older revisions discarded, paused while the page is hidden.
 * Stops on a terminal state, an authorization/not-found refusal, or abort. It never creates,
 * cancels, pays or consents.
 */
export function observeWatch(opts: ObserveWatchOptions): void {
  let last: BuyerWatch | undefined, failures = 0, timer: ReturnType<typeof setTimeout> | undefined, inFlight = false;
  const doc = (globalThis as { document?: Document }).document;
  const stop = () => { if (timer) clearTimeout(timer); doc?.removeEventListener('visibilitychange', onVisible); };
  const schedule = (ms: number) => { if (timer) clearTimeout(timer); if (!opts.signal.aborted) timer = setTimeout(tick, Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, ms))); };
  const onVisible = () => {
    if (doc?.visibilityState !== 'visible' || opts.signal.aborted || inFlight) return; // one request in flight, ever
    if (timer) clearTimeout(timer);
    timer = undefined;
    void tick();
  };
  async function tick(): Promise<void> {
    timer = undefined;
    if (opts.signal.aborted) return stop();
    if (inFlight) return;
    if (doc?.visibilityState === 'hidden') return; // resumes on visibilitychange
    inFlight = true;
    try {
      const { watch } = await opts.client.getWatch(opts.watchId, { signal: opts.signal });
      failures = 0;
      const older = last?.queue && watch.queue && BigInt(watch.queue.revision) < BigInt(last.queue.revision);
      if (!older) { last = watch; opts.onUpdate(watch); }
      const current = last!;
      const finished = current.queue
        ? current.queue.place.kind === 'not_waiting' && current.queue.place.reason === 'terminal'
        : ['fired', 'failed', 'cancelled', 'expired'].includes(current.status); // older server: no snapshot
      if (finished) return stop();
      schedule(current.queue?.refreshAfterMs ?? 5000);
    } catch (error) {
      if (opts.signal.aborted) return stop();
      const status = error instanceof AlyteApiError ? error.status : 0;
      const fatal = status === 401 || status === 403 || status === 404;
      opts.onError?.(error, last, fatal);
      if (fatal) return stop();
      failures++;
      schedule(MIN_POLL_MS * 2 ** Math.min(failures, 5));
    } finally { inFlight = false; }
  }
  opts.signal.addEventListener('abort', stop, { once: true });
  doc?.addEventListener('visibilitychange', onVisible);
  void tick();
}

export interface ConsentTheme {
  accent?: string; background?: string; surface?: string; text?: string;
  font?: 'system' | 'sans' | 'serif'; radius?: number; scheme?: 'light' | 'dark';
}
export interface ConsentResult { agentId: string; mandateId: string }
export interface ConsentOptions {
  baseUrl: string; merchantId: string; bearer: string; container: HTMLElement;
  theme?: ConsentTheme; tierId?: string; quantity?: number; lang?: string;
  /** Optional back link. Restricted to this host origin; the callback decides navigation. */
  returnUrl?: string; onNavigate?: (url: string) => void;
  /** Abort when your modal closes; removes the iframe and rejects with consent_cancelled. */
  signal?: AbortSignal;
  /** Bounds the initial ready handshake, not the buyer's time entering a code. Default 15s. */
  readyTimeoutMs?: number;
}
export class AlyteConsentError extends Error {
  constructor(readonly code: string) { super(`Alyte consent: ${code}`); this.name = 'AlyteConsentError'; }
}

/** Mount Alyte's isolated consent surface; the full verification credential never leaves it. */
export function openConsent(opts: ConsentOptions): Promise<ConsentResult> {
  const base = baseOrigin(opts.baseUrl);
  if (!opts.merchantId || !opts.bearer) throw new TypeError('merchantId and bearer are required');
  const doc = opts.container.ownerDocument, host = doc.defaultView;
  if (!host) throw new TypeError('container must belong to a browser document');
  if (opts.readyTimeoutMs !== undefined && (!Number.isFinite(opts.readyTimeoutMs) || opts.readyTimeoutMs <= 0)) throw new TypeError('readyTimeoutMs must be positive');
  const url = new URL(`/shop/${encodeURIComponent(opts.merchantId)}/authorize`, base);
  url.searchParams.set('view', 'consent'); url.searchParams.set('embed', '1');
  if (opts.tierId) url.searchParams.set('tier', opts.tierId);
  if (opts.quantity !== undefined) {
    if (!Number.isInteger(opts.quantity) || opts.quantity < 1 || opts.quantity > 10) throw new TypeError('quantity must be 1–10');
    url.searchParams.set('qty', String(opts.quantity));
  }
  if (opts.lang) url.searchParams.set('lang', opts.lang);
  if (opts.returnUrl) {
    const back = new URL(opts.returnUrl);
    if (back.origin !== host.location.origin) throw new TypeError('returnUrl must belong to the host origin');
    url.searchParams.set('return', back.href);
  }
  for (const key of ['accent', 'background', 'surface', 'text', 'font', 'radius', 'scheme'] as const) {
    const value = opts.theme?.[key];
    if ((typeof value === 'string' || typeof value === 'number') && String(value).length <= 64) url.searchParams.set(key, String(value));
  }
  return new Promise((resolve, reject) => {
    const iframe = doc.createElement('iframe');
    iframe.title = 'Alyte consent'; iframe.src = url.href; iframe.referrerPolicy = 'no-referrer';
    iframe.style.width = '100%'; iframe.style.height = '640px'; iframe.style.border = '0';
    let done = false, ready = false;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => { clearTimeout(timer); host.removeEventListener('message', receive); opts.signal?.removeEventListener('abort', abort); iframe.remove(); };
    const fail = (code: string) => { if (!done) { done = true; cleanup(); reject(new AlyteConsentError(code)); } };
    const abort = () => fail('consent_cancelled');
    const receive = (event: MessageEvent) => {
      if (done || event.origin !== base || event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || data.type !== 'alyte:consent' || data.merchantId !== opts.merchantId) return;
      if (data.event === 'ready') {
        // Language changes reload this same trusted frame. Each fresh document
        // needs bootstrap; the Alyte page accepts it only once per document.
        ready = true;
        clearTimeout(timer);
        iframe.contentWindow?.postMessage({ type: 'alyte:consent', event: 'bootstrap', bearer: opts.bearer }, base);
      } else if (data.event === 'granted' && ready) {
        if (typeof data.agentId !== 'string' || !data.agentId || typeof data.mandateId !== 'string' || !data.mandateId) return;
        done = true; cleanup(); resolve({ agentId: data.agentId, mandateId: data.mandateId });
      } else if (data.event === 'cancelled') abort();
      else if (data.event === 'error' && typeof data.code === 'string') fail(data.code);
      else if (data.event === 'resize' && Number.isFinite(data.height)) iframe.style.height = `${Math.max(240, Math.min(1200, Math.ceil(data.height)))}px`;
      else if (data.event === 'navigate' && typeof data.url === 'string') {
        try { const back = new URL(data.url); if (back.origin === host.location.origin) opts.onNavigate?.(back.href); }
        catch { /* Ignore malformed navigation messages. */ }
      }
    };
    if (opts.signal?.aborted) { abort(); return; }
    host.addEventListener('message', receive);
    opts.signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => fail('consent_unavailable'), opts.readyTimeoutMs ?? 15_000);
    iframe.addEventListener('error', () => fail('consent_unavailable'), { once: true });
    opts.container.append(iframe);
  });
}


export interface ChallengeStatus { purchaseId: string; status: BuyerPurchaseStatus }
export interface ChallengeResult extends ChallengeStatus { status: 'settled' | 'refused' | 'cancelled' | 'expired' }
export interface ChallengeOptions extends Omit<ConsentOptions, 'tierId' | 'quantity'> {
  purchaseId: string;
  /** Safe status only. Provider action material never leaves the Alyte frame. */
  onStatus?: (state: ChallengeStatus) => void;
}
export class AlyteChallengeError extends Error {
  constructor(readonly code: string) { super(`Alyte challenge: ${code}`); this.name = 'AlyteChallengeError'; }
}

/**
 * Complete an existing purchase in Alyte's isolated frame. No buy, purchase key,
 * payment details or caller-supplied approval is sent. Aborting closes only the
 * frame; the server purchase remains recoverable until its verified outcome.
 */
export function openChallenge(opts: ChallengeOptions): Promise<ChallengeResult> {
  const base = baseOrigin(opts.baseUrl);
  if (!opts.merchantId || !opts.bearer) throw new TypeError('merchantId and bearer are required');
  if (typeof opts.purchaseId !== 'string' || !opts.purchaseId || opts.purchaseId.length > 512) throw new TypeError('purchaseId is required');
  const doc = opts.container.ownerDocument, host = doc.defaultView;
  if (!host) throw new TypeError('container must belong to a browser document');
  if (opts.readyTimeoutMs !== undefined && (!Number.isFinite(opts.readyTimeoutMs) || opts.readyTimeoutMs <= 0)) throw new TypeError('readyTimeoutMs must be positive');
  const url = new URL(`/shop/${encodeURIComponent(opts.merchantId)}/authorize`, base);
  url.searchParams.set('view', 'challenge'); url.searchParams.set('embed', '1');
  url.searchParams.set('purchase', opts.purchaseId);
  if (opts.lang) url.searchParams.set('lang', opts.lang);
  if (opts.returnUrl) {
    const back = new URL(opts.returnUrl);
    if (back.origin !== host.location.origin) throw new TypeError('returnUrl must belong to the host origin');
    url.searchParams.set('return', back.href);
  }
  for (const key of ['accent', 'background', 'surface', 'text', 'font', 'radius', 'scheme'] as const) {
    const value = opts.theme?.[key];
    if ((typeof value === 'string' || typeof value === 'number') && String(value).length <= 64) url.searchParams.set(key, String(value));
  }
  const statuses: BuyerPurchaseStatus[] = ['pending', 'sca_required', 'settled', 'refused', 'cancelled', 'expired'];
  return new Promise((resolve, reject) => {
    const iframe = doc.createElement('iframe');
    iframe.title = 'Alyte bank authentication'; iframe.src = url.href; iframe.referrerPolicy = 'no-referrer';
    iframe.style.width = '100%'; iframe.style.height = '640px'; iframe.style.border = '0';
    let done = false, ready = false;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => { clearTimeout(timer); host.removeEventListener('message', receive); opts.signal?.removeEventListener('abort', abort); iframe.remove(); };
    const fail = (code: string) => { if (!done) { done = true; cleanup(); reject(new AlyteChallengeError(code)); } };
    const abort = () => fail('challenge_closed');
    const receive = (event: MessageEvent) => {
      if (done || event.origin !== base || event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || data.type !== 'alyte:challenge' || data.merchantId !== opts.merchantId || data.purchaseId !== opts.purchaseId) return;
      if (data.event === 'ready') {
        ready = true; clearTimeout(timer);
        iframe.contentWindow?.postMessage({ type: 'alyte:challenge', event: 'bootstrap', purchaseId: opts.purchaseId, bearer: opts.bearer }, base);
      } else if (data.event === 'status' && ready && statuses.includes(data.status)) {
        // Copy only this allowlist. Neither unexpected fields nor result payloads
        // from a future frame version become a merchant callback or receipt.
        const state: ChallengeStatus = { purchaseId: opts.purchaseId, status: data.status };
        if (state.status !== 'pending' && state.status !== 'sca_required') {
          done = true; cleanup(); resolve(state as ChallengeResult);
        }
        opts.onStatus?.(state);
      } else if (data.event === 'error') {
        fail(data.code === 'unauthorized' ? 'unauthorized' : 'challenge_unavailable');
      } else if (data.event === 'resize' && Number.isFinite(data.height)) {
        iframe.style.height = `${Math.max(240, Math.min(1200, Math.ceil(data.height)))}px`;
      } else if (data.event === 'navigate' && typeof data.url === 'string') {
        try { const back = new URL(data.url); if (back.origin === host.location.origin) opts.onNavigate?.(back.href); }
        catch { /* Ignore malformed navigation messages. */ }
      }
    };
    if (opts.signal?.aborted) { abort(); return; }
    host.addEventListener('message', receive);
    opts.signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => fail('challenge_unavailable'), opts.readyTimeoutMs ?? 15_000);
    iframe.addEventListener('error', () => fail('challenge_unavailable'), { once: true });
    opts.container.append(iframe);
  });
}
