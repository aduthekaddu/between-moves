export type JsonBodyReadResult =
  | { readonly kind: 'ok'; readonly value: unknown }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'too_large' };

export interface ProblemResponseOptions {
  readonly headers?: Readonly<Record<string, string>>;
  readonly instance?: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** Reuse a well-formed caller `x-request-id`; otherwise mint one for log correlation. */
export function readRequestId(request: Request): string {
  const value = request.headers.get('x-request-id');
  return value !== null && REQUEST_ID_PATTERN.test(value) ? value : crypto.randomUUID();
}

/** RFC 9457 response with private, non-cacheable defaults. */
export function problemResponse(
  request: Request,
  status: number,
  code: string,
  title: string,
  detail: string,
  options: ProblemResponseOptions = {},
): Response {
  return Response.json(
    {
      type: `https://betweenmoves.app/problems/${code}`,
      title,
      status,
      code,
      detail,
      instance: options.instance ?? new URL(request.url).pathname,
      ...(options.meta === undefined ? {} : { meta: options.meta }),
    },
    {
      status,
      headers: {
        'Cache-Control': 'private, no-store',
        'Content-Type': 'application/problem+json',
        ...options.headers,
      },
    },
  );
}

/** Read a JSON body without buffering more than the route's byte budget. */
export async function readJsonBody(
  request: Request,
  maximumBytes: number,
): Promise<JsonBodyReadResult> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maximumBytes) {
      return { kind: 'too_large' };
    }
  }
  if (request.body === null) return { kind: 'invalid' };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytesRead += chunk.value.byteLength;
      if (bytesRead > maximumBytes) {
        await reader.cancel();
        return { kind: 'too_large' };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { kind: 'ok', value: JSON.parse(text) };
  } catch {
    return { kind: 'invalid' };
  } finally {
    reader.releaseLock();
  }
}
