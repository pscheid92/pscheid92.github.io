import {afterEach, describe, expect, it, vi} from 'vitest';
import {clientAddress, createHandler, MAX_BODY_BYTES, PATH, RateLimiter} from './token.ts';

const SITE = 'https://patrickscheid.de';
const NOON = Date.UTC(2026, 10, 15, 12, 0, 0);

type Google = (url: string, init: RequestInit) => Response | Promise<Response>;

function setup(google: Google = () => Response.json({name: 'auth_tokens/abc'})) {
    const calls: {url: string; init: RequestInit}[] = [];
    let time = NOON;
    const handle = createHandler({
        apiKey: 'test-key',
        allowedOrigins: [SITE, 'http://localhost:4321'],
        fetch: (async (url: string | URL | Request, init: RequestInit = {}) => {
            calls.push({url: String(url), init});
            return google(String(url), init);
        }) as typeof fetch,
        now: () => time,
    });
    return {
        handle,
        calls,
        sent: () => JSON.parse(String(calls[0].init.body)),
        advance: (ms: number) => {
            time += ms;
        },
    };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
    return new Request(`http://localhost${PATH}`, {
        method: 'POST',
        headers: {Origin: SITE, 'Content-Type': 'application/json', ...headers},
        body: typeof body === 'string' ? body : JSON.stringify(body),
    });
}

const german = {lang: 'de-DE', vocabulary: ['Anton', 'Berta']};

afterEach(() => vi.restoreAllMocks());

describe('a token request', () => {
    it('gets the token Google made', async () => {
        const {handle} = setup();
        const response = await handle(post(german), '203.0.113.7');

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({token: 'auth_tokens/abc'});
        expect(response.headers.get('Content-Type')).toBe('application/json');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
    });

    it('answers without CORS headers, so no other site can read the token', async () => {
        const {handle} = setup();
        const response = await handle(post(german), '203.0.113.7');

        expect([...response.headers.keys()].filter((name) => name.startsWith('access-control'))).toEqual([]);
    });

    it('asks Google for one session of the transcription model, starting within a minute', async () => {
        const {handle, calls, sent} = setup();
        await handle(post(german), '203.0.113.7');

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/auth_tokens');
        expect(calls[0].init.method).toBe('POST');
        expect(calls[0].init.headers).toEqual({'x-goog-api-key': 'test-key', 'Content-Type': 'application/json'});
        expect(sent()).toEqual({
            uses: 1,
            newSessionExpireTime: '2026-11-15T12:01:00.000Z',
            expireTime: '2026-11-15T12:02:00.000Z',
            bidiGenerateContentSetup: {
                model: 'models/gemini-3.5-transcribe-live',
                generationConfig: {responseModalities: ['TEXT']},
                inputAudioTranscription: {languageCodes: ['de-DE'], customVocabulary: ['Anton', 'Berta']},
            },
        });
    });

    it('leaves the vocabulary out when there is none', async () => {
        const {handle, sent} = setup();
        await handle(post({lang: 'en-US'}), '203.0.113.7');

        expect(sent().bidiGenerateContentSetup.inputAudioTranscription).toEqual({languageCodes: ['en-US']});
    });

    it('keeps only plausible code words, 100 at most', async () => {
        const {handle, sent} = setup();
        const words = Array.from({length: 150}, (_, i) => `word${i}`);
        await handle(post({lang: 'en-US', vocabulary: ['', 7, null, 'x'.repeat(41), ...words]}), '203.0.113.7');

        expect(sent().bidiGenerateContentSetup.inputAudioTranscription.customVocabulary).toEqual(words.slice(0, 100));
    });

    it('may come from the dev server too', async () => {
        const {handle} = setup();
        const response = await handle(post(german, {Origin: 'http://localhost:4321'}), '127.0.0.1');

        expect(response.status).toBe(200);
    });
});

describe('what is refused before Google is asked', () => {
    async function refused(request: Request) {
        const {handle, calls} = setup();
        const response = await handle(request, '203.0.113.7');
        expect(calls).toHaveLength(0);
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        return {status: response.status, body: await response.json(), headers: response.headers};
    }

    it('another path', async () => {
        const request = new Request('http://localhost/live-token', {method: 'POST', headers: {Origin: SITE}, body: '{}'});
        expect(await refused(request)).toMatchObject({status: 404, body: {error: 'not found'}});
    });

    it('another method', async () => {
        const result = await refused(new Request(`http://localhost${PATH}`, {headers: {Origin: SITE}}));
        expect(result).toMatchObject({status: 405, body: {error: 'method not allowed'}});
        expect(result.headers.get('Allow')).toBe('POST');
    });

    it('a preflight: nobody but the site itself has reason to ask', async () => {
        const request = new Request(`http://localhost${PATH}`, {method: 'OPTIONS', headers: {Origin: 'https://example.com'}});
        const result = await refused(request);
        expect(result.status).toBe(405);
        expect(result.headers.has('Access-Control-Allow-Origin')).toBe(false);
    });

    it('a page of another site', async () => {
        expect(await refused(post(german, {Origin: 'https://example.com'}))).toMatchObject({
            status: 403,
            body: {error: 'origin not allowed'},
        });
    });

    it('a request that names no origin', async () => {
        const request = new Request(`http://localhost${PATH}`, {method: 'POST', body: JSON.stringify(german)});
        expect(await refused(request)).toMatchObject({status: 403});
    });

    it('a body that is not JSON, or not an object', async () => {
        expect(await refused(post('lang=de-DE'))).toMatchObject({status: 400, body: {error: 'invalid JSON'}});
        expect(await refused(post(''))).toMatchObject({status: 400, body: {error: 'invalid JSON'}});
        expect(await refused(post('null'))).toMatchObject({status: 400, body: {error: 'invalid JSON'}});
    });

    it('a language the trainer does not teach', async () => {
        expect(await refused(post({lang: 'fr-FR'}))).toMatchObject({status: 400, body: {error: 'invalid lang'}});
        expect(await refused(post({vocabulary: ['Anton']}))).toMatchObject({status: 400, body: {error: 'invalid lang'}});
    });

    it('a body longer than a list of code words', async () => {
        const body = JSON.stringify({lang: 'de-DE', vocabulary: ['x'.repeat(MAX_BODY_BYTES)]});
        expect(await refused(post(body))).toMatchObject({status: 413, body: {error: 'request too large'}});
    });
});

describe('when Google does not deliver', () => {
    async function failing(google: Google) {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        const {handle} = setup(google);
        const response = await handle(post(german), '203.0.113.7');
        return {status: response.status, body: await response.json(), logged: JSON.stringify(logged.mock.calls)};
    }

    it('answers 502 to an error status, and logs what Google said', async () => {
        const result = await failing(() => new Response('quota exceeded', {status: 429}));

        expect(result).toMatchObject({status: 502, body: {error: 'speech service unavailable'}});
        expect(result.logged).toContain('quota exceeded');
    });

    it('answers 502 to a reply without a token', async () => {
        expect(await failing(() => Response.json({}))).toMatchObject({status: 502});
    });

    it('answers 502 when Google cannot be reached', async () => {
        const result = await failing(() => {
            throw new TypeError('fetch failed');
        });

        expect(result).toMatchObject({status: 502, body: {error: 'speech service unavailable'}});
    });

    it('logs neither the key nor who asked', async () => {
        const result = await failing(() => new Response('nope', {status: 500}));

        expect(result.logged).not.toContain('test-key');
        expect(result.logged).not.toContain('203.0.113.7');
    });
});

describe('the rate limit', () => {
    it('lets an address have 20 tokens a minute', async () => {
        const {handle, calls} = setup();
        for (let i = 0; i < 20; i++) {
            expect((await handle(post(german), '203.0.113.7')).status).toBe(200);
        }

        const response = await handle(post(german), '203.0.113.7');
        expect(response.status).toBe(429);
        expect(await response.json()).toEqual({error: 'too many requests'});
        expect(response.headers.get('Retry-After')).toBe('60');
        expect(calls).toHaveLength(20);
    });

    it('counts each address for itself', async () => {
        const {handle} = setup();
        for (let i = 0; i < 20; i++) await handle(post(german), '203.0.113.7');

        expect((await handle(post(german), '203.0.113.7')).status).toBe(429);
        expect((await handle(post(german), '198.51.100.1')).status).toBe(200);
    });

    it('lets the address in again once its first request is a minute old', async () => {
        const {handle, advance} = setup();
        await handle(post(german), '203.0.113.7');
        advance(40_000);
        for (let i = 0; i < 19; i++) await handle(post(german), '203.0.113.7');

        const tooSoon = await handle(post(german), '203.0.113.7');
        expect(tooSoon.status).toBe(429);
        expect(tooSoon.headers.get('Retry-After')).toBe('20');

        advance(20_000);
        expect((await handle(post(german), '203.0.113.7')).status).toBe(200);
        // the other 19 are only 20 s old
        expect((await handle(post(german), '203.0.113.7')).status).toBe(429);
    });

    it('counts requests that turn out to be invalid, but none from other sites', async () => {
        const {handle} = setup();
        for (let i = 0; i < 30; i++) await handle(post(german, {Origin: 'https://example.com'}), '203.0.113.7');
        for (let i = 0; i < 20; i++) {
            expect((await handle(post('not json'), '203.0.113.7')).status).toBe(400);
        }

        expect((await handle(post(german), '203.0.113.7')).status).toBe(429);
    });
});

describe('addresses in memory', () => {
    it('are forgotten on a timer, without another request', async () => {
        vi.useFakeTimers({now: NOON});
        const sweep = vi.spyOn(RateLimiter.prototype, 'sweep');
        try {
            const handle = createHandler({
                apiKey: 'test-key',
                allowedOrigins: [SITE],
                fetch: (async () => Response.json({name: 'auth_tokens/abc'})) as typeof fetch,
            });
            await handle(post(german), '203.0.113.7');
            expect(sweep).not.toHaveBeenCalled();

            vi.advanceTimersByTime(60_000);

            expect(sweep).toHaveBeenCalledWith(NOON + 60_000);
            expect((sweep.mock.contexts[0] as RateLimiter).size).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('RateLimiter', () => {
    it('says how long to wait', () => {
        const limiter = new RateLimiter(2, 1000);

        expect(limiter.take('a', 0)).toBe(0);
        expect(limiter.take('a', 300)).toBe(0);
        expect(limiter.take('a', 400)).toBe(600);
        expect(limiter.take('a', 1000)).toBe(0);
    });

    it('forgets addresses that have been quiet for a whole period when swept', () => {
        const limiter = new RateLimiter(2, 1000);
        limiter.take('a', 0);
        limiter.take('b', 900);

        limiter.sweep(999);
        expect(limiter.size).toBe(2);
        limiter.sweep(1000);
        expect(limiter.size).toBe(1); // b
        limiter.sweep(1900);
        expect(limiter.size).toBe(0);
    });

    it('holds a limited number of addresses, and makes new ones wait when it is full', () => {
        const limiter = new RateLimiter(2, 1000, 3);
        expect(limiter.take('a', 0)).toBe(0);
        expect(limiter.take('b', 100)).toBe(0);
        expect(limiter.take('c', 200)).toBe(0);

        expect(limiter.take('d', 300)).toBe(1000);
        expect(limiter.take('a', 300)).toBe(0); // known addresses are still served
        expect(limiter.size).toBe(3);

        // b and c have gone quiet by now
        expect(limiter.take('d', 1250)).toBe(0);
        expect(limiter.size).toBe(2); // a and d
    });
});

describe('clientAddress', () => {
    it('is the address the gateway added, the last one', () => {
        expect(clientAddress('203.0.113.7', '10.42.0.185')).toBe('203.0.113.7');
        expect(clientAddress('1.2.3.4, 203.0.113.7', '10.42.0.185')).toBe('203.0.113.7');
        expect(clientAddress('1.2.3.4,5.6.7.8 ,  203.0.113.7 ', '10.42.0.185')).toBe('203.0.113.7');
    });

    it('is whoever connected when nothing was forwarded', () => {
        expect(clientAddress(undefined, '127.0.0.1')).toBe('127.0.0.1');
        expect(clientAddress('', '127.0.0.1')).toBe('127.0.0.1');
        expect(clientAddress(undefined, undefined)).toBe('unknown');
    });
});
