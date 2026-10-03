import { request } from 'node:http';

// Test transport to a network-disabled disposable Python container. This sends
// real multipart HTTP requests to Uvicorn; it does not stub image generation.
export function imageEngineSocketFetch(socketPath: string): typeof fetch {
  if (!socketPath.startsWith('/tmp/nxbooth-express-image-test-')) throw new Error('Use a dedicated disposable image engine socket');
  return async (url, options) => {
    const input = new Request(url, options);
    const bytes = Buffer.from(await input.arrayBuffer());
    return new Promise<Response>((resolve, reject) => {
      const req = request({ socketPath, path: new URL(input.url).pathname, method: input.method,
        headers: { ...Object.fromEntries(input.headers), 'content-length': String(bytes.length) }, signal: input.signal }, res => {
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > 26 * 1024 * 1024) { res.destroy(new Error('Test response exceeded limit')); return; }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => resolve(new Response(new Uint8Array(Buffer.concat(chunks)), {
          status: res.statusCode, headers: Object.fromEntries(Object.entries(res.headers).filter((entry):entry is [string,string]=>typeof entry[1]==='string')),
        })));
      });
      req.on('error', reject); req.end(bytes);
    });
  };
}
