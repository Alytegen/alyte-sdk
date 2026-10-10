/** Browser-only buyer connection. No merchant key or raw agent credential belongs here. */
import { AlyteApiError } from './http.js';
import type { DiscoveredEvent, Scheme } from './types.js';
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
  status: 'queued' | 'firing' | 'fired' | 'failed' | 'cancelled' | 'expired';
  result?: Record<string, unknown>; expiresAt?: string; createdAt: string; firedAt?: string;
}
export type BuyerPurchase =
  | { status: 'settled' | 'pending'; intentId: string; chargeMinor: number; currency: string; paymentState?: string; agentName?: string }
  | { status: 'sca_required' }
  | { status: 'refused' | 'error'; outcome: unknown };
export interface BuyerReceipt { intentId: string; status: 'settled' | 'pending' | 'refused'; chargeMinor: number; currency: string; paymentState?: string }
export interface BuyerClientOptions { baseUrl: string; bearer: string; fetch?: typeof globalThis.fetch }

function baseOrigin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new TypeError('baseUrl must be an HTTP(S) origin');
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new TypeError('baseUrl must use HTTPS outside local development');
  return url.origin;
}

/** HTTP errors retain the server taxonomy; no request is automatically retried. */
async function request<T>(fetcher: typeof globalThis.fetch, base: string, path: string, method: string, bearer?: string, body?: unknown): Promise<T> {
  const res = await fetcher(base + path, { method, credentials: 'omit', redirect: 'error', cache: 'no-store',
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
  const call = <T>(method: string, path: string, body?: unknown) => request<T>(fetcher, base, '/v1/buyer' + path, method, opts.bearer, body);
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
    payment: (intentId: string) => call<BuyerReceipt>('GET', `/payments/${encodeURIComponent(intentId)}`),
    watch: (input: { agentId: string; tierId: string; quantity: number; expiresInDays?: number }) => call<{ watch: BuyerWatch }>('POST', '/watches', input),
    cancelWatch: (watchId: string) => call<{ watch: BuyerWatch }>('DELETE', `/watches/${encodeURIComponent(watchId)}`),
    revokeMandate: (mandateId: string) => call<{ ok: true; id: string; status: 'revoked' }>('DELETE', `/mandates/${encodeURIComponent(mandateId)}`),
  };
}
export type BuyerClient = ReturnType<typeof createBuyerClient>;

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
