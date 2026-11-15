// Runs the token endpoint (token.ts) as a small HTTP server behind the gateway.
//
//   GEMINI_API_KEY    the key the tokens are made with (required)
//   ALLOWED_ORIGINS   comma-separated, default https://patrickscheid.de
//   PORT              default 8080
//
// Node runs the TypeScript as it is (it strips the types), so there is
// nothing to install and nothing to build.

import {createServer, type IncomingMessage, type Server} from 'node:http';
import {fileURLToPath} from 'node:url';
import {clientAddress, createHandler, MAX_BODY_BYTES, type Handler} from './token.ts';

const JSON_HEADERS = {'Content-Type': 'application/json', 'Cache-Control': 'no-store'};

export function createSpeechServer(handle: Handler): Server {
    const server = createServer(async (req, res) => {
        try {
            // For the orchestrator's probes.
            if (req.url === '/healthz') {
                res.writeHead(200, {'Content-Type': 'text/plain'}).end('ok\n');
                return;
            }

            const body = await readBody(req);
            if (body === null) {
                // The rest of the body is never read, so the connection can't be reused.
                res.writeHead(413, {...JSON_HEADERS, Connection: 'close'}).end(JSON.stringify({error: 'request too large'}));
                return;
            }

            let request: Request;
            try {
                request = toRequest(req, body);
            } catch {
                res.writeHead(400, JSON_HEADERS).end(JSON.stringify({error: 'bad request'}));
                return;
            }

            const forwardedFor = [req.headers['x-forwarded-for']].flat().join(',');
            const response = await handle(request, clientAddress(forwardedFor, req.socket.remoteAddress));
            const content = Buffer.from(await response.arrayBuffer());
            res.writeHead(response.status, {...Object.fromEntries(response.headers), 'Content-Length': content.length});
            res.end(content);
        } catch (error) {
            console.error(error);
            if (!res.headersSent) res.writeHead(500, JSON_HEADERS);
            res.end(JSON.stringify({error: 'internal error'}));
        }
    });

    // The gateway keeps its connections to this server open and reuses them.
    // Node would close an idle one after five seconds, and a request Envoy
    // sends at that moment fails with a 503. So idle connections stay open
    // until Envoy closes them, and a request has 15 s to arrive in full.
    server.keepAliveTimeout = 0;
    server.requestTimeout = 15_000;
    return server;
}

// The body, or null as soon as it is longer than a list of code words can be.
function readBody(req: IncomingMessage): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
        if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
            resolve(null);
            return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        const onData = (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                req.off('data', onData);
                req.pause();
                resolve(null);
                return;
            }
            chunks.push(chunk);
        };
        req.on('data', onData);
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

// The handler speaks the Fetch API, as the Cloudflare Worker it came from did.
function toRequest(req: IncomingMessage, body: Buffer): Request {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
        for (const item of [value].flat()) {
            if (item !== undefined) headers.append(name, item);
        }
    }

    const method = req.method ?? 'GET';
    const hasBody = method !== 'GET' && method !== 'HEAD';
    // Only the path counts; the host just makes it a complete address.
    const url = new URL(req.url ?? '/', 'http://localhost');
    return new Request(url, {method, headers, body: hasBody ? new Uint8Array(body) : undefined});
}

function main() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.error('GEMINI_API_KEY is not set');
        process.exit(1);
    }
    const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'https://patrickscheid.de')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
    const port = Number(process.env.PORT ?? 8080);

    const server = createSpeechServer(createHandler({apiKey, allowedOrigins}));
    server.listen(port, () => console.log(`speech tokens on :${port} for ${allowedOrigins.join(', ')}`));

    // Kubernetes sends SIGTERM before it removes the pod: finish what is in
    // flight, then go. As process 1, Node wouldn't react to it otherwise.
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
        process.on(signal, () => {
            server.close(() => process.exit(0));
            setTimeout(() => process.exit(0), 10_000).unref();
        });
    }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
