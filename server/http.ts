export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function boundedJson(
  input: Request | Response,
  limit = 65536,
): Promise<unknown> {
  if (!input.body) throw new HttpError(400, "Missing JSON body.");
  const reader = input.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new HttpError(413, "Payload is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin)
    throw new HttpError(403, "Origin does not match.");
}
export function json(data: unknown, status = 200, headers: HeadersInit = {}) {
  const h = new Headers(headers);
  h.set("Cache-Control", "no-store");
  h.set("X-Content-Type-Options", "nosniff");
  return Response.json(data, { status, headers: h });
}
