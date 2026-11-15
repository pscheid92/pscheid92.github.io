// Live speech-to-text for the spelling trainer.
//
//   POST /api/live-token  {lang: 'en-US' | 'de-DE', vocabulary?: string[]}
//   → 200 {token}  |  4xx/5xx {error}
//
// The page streams the microphone straight to Google's gemini-3.5-transcribe-live
// over a WebSocket. It authenticates with the token from here: single use,
// valid for a minute, and locked to this model, language and vocabulary, so
// the API key never leaves this service. Audio doesn't pass through here and
// isn't stored; the paid tier doesn't use it for training.
//
// The page and this endpoint share one origin: the gateway sends this one
// path here and everything else to nginx. So there is no CORS, and a page of
// another site can't read what this answers.
//
// Nothing about a request is logged, only a failed call to Google. A
// visitor's address is held in memory to count their requests, and forgotten
// at most two minutes after their last one.

export interface Options {
    apiKey: string;
    /** Origins whose pages may ask for tokens: the site, and the dev server. */
    allowedOrigins: string[];
    /** Both are replaced in tests. */
    fetch?: typeof fetch;
    now?: () => number;
}

/** Answers one request; `client` is the address the rate limit counts by. */
export type Handler = (request: Request, client: string) => Promise<Response>;

interface TokenRequest {
    lang: string;
    vocabulary: string[];
}

export const PATH = '/api/live-token';

const TOKEN_URL = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens';
const LIVE_MODEL = 'models/gemini-3.5-transcribe-live';
const GOOGLE_TIMEOUT_MS = 10_000;

const LANGUAGES = new Set(['en-US', 'de-DE']);

export const MAX_BODY_BYTES = 8_000;
const MAX_TERMS = 100;
const MAX_TERM_LENGTH = 40;

// A session must start within a minute; the page records 30 s at most.
const NEW_SESSION_WINDOW_MS = 60_000;
const SESSION_LIFETIME_MS = 2 * 60_000;

// Per visitor address: 20 transcriptions a minute is plenty for a person, and
// keeps the endpoint useless as a free transcription service. Every replica
// counts for itself, so with two of them the ceiling is 40.
const RATE_LIMIT = 20;
const RATE_PERIOD_MS = 60_000;

class HttpError extends Error {
    readonly status: number;
    readonly headers: Record<string, string>;

    constructor(status: number, message: string, headers: Record<string, string> = {}) {
        super(message);
        this.status = status;
        this.headers = headers;
    }
}

export function createHandler(options: Options): Handler {
    const {apiKey, allowedOrigins} = options;
    const send = options.fetch ?? fetch;
    const now = options.now ?? Date.now;
    const limiter = new RateLimiter(RATE_LIMIT, RATE_PERIOD_MS);
    // On a timer, not when the next request happens to come: an address must
    // not stay in memory for hours because nobody else used the trainer.
    setInterval(() => limiter.sweep(now()), RATE_PERIOD_MS).unref();

    async function handle(request: Request, client: string): Promise<Response> {
        if (new URL(request.url).pathname !== PATH) throw new HttpError(404, 'not found');
        if (request.method !== 'POST') throw new HttpError(405, 'method not allowed', {Allow: 'POST'});

        // Browsers name the page's origin on every POST, also on one to their
        // own origin, so this keeps other sites from using the endpoint
        // through their visitors. Scripts can fake it; the rate limit is for those.
        if (!allowedOrigins.includes(request.headers.get('Origin') ?? '')) {
            throw new HttpError(403, 'origin not allowed');
        }

        const wait = limiter.take(client, now());
        if (wait > 0) {
            throw new HttpError(429, 'too many requests', {'Retry-After': String(Math.ceil(wait / 1000))});
        }

        const input = await readRequest(request);
        const token = await createLiveToken(input);
        return json({token}, 200);
    }

    // The setup is locked into the token: the page can open one session of this
    // model with this language and vocabulary, and nothing else.
    async function createLiveToken({lang, vocabulary}: TokenRequest): Promise<string> {
        const issued = now();
        let response: Response;
        try {
            response = await send(TOKEN_URL, {
                method: 'POST',
                headers: {'x-goog-api-key': apiKey, 'Content-Type': 'application/json'},
                body: JSON.stringify({
                    uses: 1,
                    newSessionExpireTime: new Date(issued + NEW_SESSION_WINDOW_MS).toISOString(),
                    expireTime: new Date(issued + SESSION_LIFETIME_MS).toISOString(),
                    bidiGenerateContentSetup: {
                        model: LIVE_MODEL,
                        generationConfig: {responseModalities: ['TEXT']},
                        inputAudioTranscription: {
                            languageCodes: [lang],
                            ...(vocabulary.length > 0 && {customVocabulary: vocabulary}),
                        },
                    },
                }),
                signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS),
            });
        } catch (error) {
            console.error('gemini token:', error instanceof Error ? error.message : error);
            throw new HttpError(502, 'speech service unavailable');
        }

        if (!response.ok) {
            console.error('gemini token', response.status, (await response.text()).slice(0, 500));
            throw new HttpError(502, 'speech service unavailable');
        }

        const {name} = (await response.json()) as {name?: unknown};
        if (typeof name !== 'string' || name === '') {
            console.error('gemini token: no name in response');
            throw new HttpError(502, 'speech service unavailable');
        }
        return name;
    }

    return async (request, client) => {
        try {
            return await handle(request, client);
        } catch (error) {
            if (error instanceof HttpError) return json({error: error.message}, error.status, error.headers);
            console.error(error);
            return json({error: 'internal error'}, 500);
        }
    };
}

/**
 * The visitor's address as the gateway saw it. Envoy appends it to
 * X-Forwarded-For, so it is the last entry; whatever stands before it came
 * from the visitor and may be made up. Without the header (a local run) it is
 * whoever connected.
 */
export function clientAddress(forwardedFor: string | undefined, peer: string | undefined): string {
    const last = forwardedFor?.split(',').pop()?.trim();
    return last || peer || 'unknown';
}

/** A sliding window per key: the times of its requests within the last period. */
export class RateLimiter {
    readonly #limit: number;
    readonly #periodMs: number;
    readonly #maxKeys: number;
    readonly #requests = new Map<string, number[]>();

    constructor(limit: number, periodMs: number, maxKeys = 10_000) {
        this.#limit = limit;
        this.#periodMs = periodMs;
        this.#maxKeys = maxKeys;
    }

    /** Counts a request. Returns 0 if it may pass, else the milliseconds until the next one may. */
    take(key: string, now: number): number {
        const recent = (this.#requests.get(key) ?? []).filter((time) => time > now - this.#periodMs);
        if (recent.length >= this.#limit) {
            this.#requests.set(key, recent);
            return recent[0] + this.#periodMs - now;
        }

        // A flood from more addresses than the table holds: those not in it
        // wait until others have gone quiet, so the table can't grow without end.
        if (!this.#requests.has(key) && this.#requests.size >= this.#maxKeys) {
            this.sweep(now);
            if (this.#requests.size >= this.#maxKeys) return this.#periodMs;
        }

        recent.push(now);
        this.#requests.set(key, recent);
        return 0;
    }

    get size(): number {
        return this.#requests.size;
    }

    /** Forgets every address that has been quiet for a whole period. */
    sweep(now: number): void {
        for (const [key, times] of this.#requests) {
            if (times[times.length - 1] <= now - this.#periodMs) this.#requests.delete(key);
        }
    }
}

// --- HTTP ---

function json(body: object, status: number, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers},
    });
}

// --- request validation ---

async function readRequest(request: Request): Promise<TokenRequest> {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new HttpError(413, 'request too large');

    let body: unknown;
    try {
        body = JSON.parse(raw);
    } catch {
        throw new HttpError(400, 'invalid JSON');
    }
    if (typeof body !== 'object' || body === null) throw new HttpError(400, 'invalid JSON');

    const {lang, vocabulary} = body as Record<string, unknown>;
    if (typeof lang !== 'string' || !LANGUAGES.has(lang)) {
        throw new HttpError(400, 'invalid lang');
    }

    return {lang, vocabulary: cleanVocabulary(vocabulary)};
}

// Keeps the custom vocabulary to plausible code words; anything else is dropped.
function cleanVocabulary(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((term): term is string => typeof term === 'string' && term.length > 0 && term.length <= MAX_TERM_LENGTH)
        .slice(0, MAX_TERMS);
}
