/** Minimal fetch transport shared by both clients. Zero dependencies. */

export interface ClientOptions {
  /** Your Alyte deployment origin, e.g. https://alyte-sandbox-….run.app */
  baseUrl: string;
  /** The bearer credential (merchant API token or agent JWT). Keep it server-side. */
  token: string;
  /** Override fetch (tests, polyfills). Defaults to globalThis.fetch. */
  fetch?: typeof globalThis.fetch;
}

/** A typed Alyte API failure: HTTP status + the stable error code from the taxonomy. */
export class AlyteApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AlyteApiError';
  }
}

export class Transport {
  private readonly base: string;
  private readonly token: string;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(opts: ClientOptions) {
    if (!opts.baseUrl) throw new Error('baseUrl is required');
    if (!opts.token) throw new Error('token is required');
    this.base = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  async request<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    // 2xx AND 202 (sca_required rides a 202 with a normal body) succeed; everything
    // else surfaces the taxonomy code so callers can branch on retryable-vs-terminal.
    if (res.ok || res.status === 202) return json as T;
    const err = (json as { error?: { code?: string; message?: string; details?: unknown } })?.error;
    throw new AlyteApiError(
      res.status,
      err?.code ?? `http_${res.status}`,
      err?.message ?? `Alyte API error (HTTP ${res.status})`,
      err?.details ?? json,
    );
  }
}
