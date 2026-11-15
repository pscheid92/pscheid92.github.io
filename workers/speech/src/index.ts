// Live speech-to-text for the spelling trainer.
//
//   POST /live-token  {lang: 'en-US' | 'de-DE', vocabulary?: string[]}
//   → 200 {token}  |  4xx/5xx {error}
//
// The page streams the microphone straight to Google's gemini-3.5-transcribe-live
// over a WebSocket. It authenticates with the token from here: single use,
// valid for a minute, and locked to this model, language and vocabulary, so
// the API key never leaves the Worker. Audio doesn't pass through here and
// isn't stored; the paid tier doesn't use it for training.

interface Env {
    GEMINI_API_KEY: string;
    ALLOWED_ORIGINS: string;
    PER_IP: RateLimit;
}

interface RateLimit {
    limit(options: {key: string}): Promise<{success: boolean}>;
}

interface TokenRequest {
    lang: string;
    vocabulary: string[];
}

const TOKEN_URL = 'https://generativelanguage.googleapis.com/v1beta/auth_tokens';
const LIVE_MODEL = 'models/gemini-3.5-transcribe-live';

const LANGUAGES = new Set(['en-US', 'de-DE']);

const MAX_BODY_BYTES = 8_000;
const MAX_TERMS = 100;
const MAX_TERM_LENGTH = 40;

// A session must start within a minute; the page records 30 s at most.
const NEW_SESSION_WINDOW_MS = 60_000;
const SESSION_LIFETIME_MS = 2 * 60_000;

class HttpError extends Error {
    constructor(readonly status: number, message: string) {
        super(message);
    }
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const cors = corsHeaders(request, env);
        try {
            return await handle(request, env, cors);
        } catch (error) {
            if (error instanceof HttpError) return json({error: error.message}, error.status, cors);
            console.error(error);
            return json({error: 'internal error'}, 500, cors);
        }
    },
};

async function handle(request: Request, env: Env, cors: Headers): Promise<Response> {
    if (new URL(request.url).pathname !== '/live-token') throw new HttpError(404, 'not found');
    if (request.method === 'OPTIONS') return preflight(cors);
    if (request.method !== 'POST') throw new HttpError(405, 'method not allowed');

    // Browsers always send Origin on a cross-origin POST, so this keeps other
    // sites from using the endpoint. Scripts can fake it; the rate limit is for those.
    if (!isAllowedOrigin(cors)) throw new HttpError(403, 'origin not allowed');

    const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
    const {success} = await env.PER_IP.limit({key: ip});
    if (!success) throw new HttpError(429, 'too many requests');

    const input = await readRequest(request);
    const token = await createLiveToken(input, env.GEMINI_API_KEY);
    return json({token}, 200, cors);
}

// --- HTTP ---

function corsHeaders(request: Request, env: Env): Headers {
    const headers = new Headers({Vary: 'Origin'});
    const origin = request.headers.get('Origin');
    const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
    if (origin && allowed.includes(origin)) headers.set('Access-Control-Allow-Origin', origin);
    return headers;
}

function isAllowedOrigin(cors: Headers): boolean {
    return cors.has('Access-Control-Allow-Origin');
}

function preflight(cors: Headers): Response {
    const headers = new Headers(cors);
    headers.set('Access-Control-Allow-Methods', 'POST');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '86400');
    return new Response(null, {status: isAllowedOrigin(cors) ? 204 : 403, headers});
}

function json(body: object, status: number, cors: Headers): Response {
    const headers = new Headers(cors);
    headers.set('Content-Type', 'application/json');
    headers.set('Cache-Control', 'no-store');
    return new Response(JSON.stringify(body), {status, headers});
}

// --- request validation ---

async function readRequest(request: Request): Promise<TokenRequest> {
    const declaredLength = Number(request.headers.get('Content-Length') ?? '0');
    if (!declaredLength || declaredLength > MAX_BODY_BYTES) throw new HttpError(413, 'request too large');

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, 'request too large');

    let body: Record<string, unknown>;
    try {
        body = JSON.parse(raw);
    } catch {
        throw new HttpError(400, 'invalid JSON');
    }

    const {lang, vocabulary} = body;
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

// --- Gemini ---

// The setup is locked into the token: the page can open one session of this
// model with this language and vocabulary, and nothing else.
async function createLiveToken({lang, vocabulary}: TokenRequest, apiKey: string): Promise<string> {
    const now = Date.now();
    const response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {'x-goog-api-key': apiKey, 'Content-Type': 'application/json'},
        body: JSON.stringify({
            uses: 1,
            newSessionExpireTime: new Date(now + NEW_SESSION_WINDOW_MS).toISOString(),
            expireTime: new Date(now + SESSION_LIFETIME_MS).toISOString(),
            bidiGenerateContentSetup: {
                model: LIVE_MODEL,
                generationConfig: {responseModalities: ['TEXT']},
                inputAudioTranscription: {
                    languageCodes: [lang],
                    ...(vocabulary.length > 0 && {customVocabulary: vocabulary}),
                },
            },
        }),
    });

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
