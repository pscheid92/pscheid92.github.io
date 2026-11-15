import type {AddressInfo} from 'node:net';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {createSpeechServer} from './server.ts';
import {MAX_BODY_BYTES, type Handler} from './token.ts';

let stop: (() => Promise<void>) | undefined;

async function start(handle: Handler): Promise<string> {
    const server = createSpeechServer(handle);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    stop = () =>
        new Promise((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
        });
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
    await stop?.();
    stop = undefined;
    vi.restoreAllMocks();
});

const never: Handler = async () => {
    throw new Error('the handler should not have been asked');
};

describe('the server', () => {
    it('answers the health check itself', async () => {
        const response = await fetch(`${await start(never)}/healthz`);

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('ok\n');
    });

    it('hands the handler the request as it came, and the address the gateway added', async () => {
        const seen: Record<string, unknown> = {};
        const base = await start(async (request, client) => {
            seen.method = request.method;
            seen.path = new URL(request.url).pathname;
            seen.origin = request.headers.get('Origin');
            seen.body = await request.text();
            seen.client = client;
            return Response.json({token: 't'}, {headers: {'Cache-Control': 'no-store'}});
        });

        const response = await fetch(`${base}/api/live-token?x=1`, {
            method: 'POST',
            headers: {
                Origin: 'https://patrickscheid.de',
                'Content-Type': 'application/json',
                'X-Forwarded-For': '1.2.3.4, 203.0.113.7',
            },
            body: '{"lang":"de-DE"}',
        });

        expect(seen).toEqual({
            method: 'POST',
            path: '/api/live-token',
            origin: 'https://patrickscheid.de',
            body: '{"lang":"de-DE"}',
            client: '203.0.113.7',
        });
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/json');
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(await response.json()).toEqual({token: 't'});
    });

    it('counts by whoever connected when no gateway is in front', async () => {
        let client = '';
        const base = await start(async (_request, address) => {
            client = address;
            return new Response(null, {status: 204});
        });

        const response = await fetch(`${base}/api/live-token`);

        expect(response.status).toBe(204);
        expect(client).toBe('127.0.0.1');
    });

    it('refuses a body that announces more than the limit', async () => {
        const response = await fetch(`${await start(never)}/api/live-token`, {
            method: 'POST',
            body: 'x'.repeat(MAX_BODY_BYTES + 1),
        });

        expect(response.status).toBe(413);
        expect(await response.json()).toEqual({error: 'request too large'});
    });

    it('stops reading a body of unannounced length at the limit', async () => {
        const chunk = new TextEncoder().encode('x'.repeat(1000));
        let sent = 0;
        const body = new ReadableStream<Uint8Array>({
            pull(controller) {
                if (sent++ < 100) controller.enqueue(chunk);
                else controller.close();
            },
        });

        const response = await fetch(`${await start(never)}/api/live-token`, {
            method: 'POST',
            body,
            duplex: 'half',
        } as RequestInit);

        expect(response.status).toBe(413);
    });

    it('answers 500 when the handler fails, without saying why', async () => {
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        const base = await start(async () => {
            throw new Error('secret detail');
        });

        const response = await fetch(`${base}/api/live-token`, {method: 'POST', body: '{}'});

        expect(response.status).toBe(500);
        expect(await response.text()).toBe('{"error":"internal error"}');
        expect(logged).toHaveBeenCalledOnce();
    });
});
