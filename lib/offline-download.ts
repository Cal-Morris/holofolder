const RETRYABLE_ERRORS = new Set(['TimeoutError', 'AbortError']);

/** Foreground downloads can be suspended on phones. Finish each body before returning and retry only transient failures. */
export async function fetchOfflineResource(
  url: string,
  options: {
    signal?: AbortSignal;
    headers?: HeadersInit;
    fetcher?: typeof fetch;
    retryDelay?: (ms: number, signal?: AbortSignal) => Promise<void>;
  } = {},
) {
  for (let attempt = 0; ; attempt++) {
    options.signal?.throwIfAborted();
    try {
      const response = await (options.fetcher ?? fetch)(url, {
        cache: 'no-store',
        headers: options.headers,
        signal: options.signal
          ? AbortSignal.any([options.signal, AbortSignal.timeout(30_000)])
          : AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        if ((response.status === 408 || response.status === 429 || response.status >= 500) && attempt < 2) {
          await response.body?.cancel();
          await (options.retryDelay ?? wait)([500, 1500][attempt], options.signal);
          continue;
        }
        throw new DownloadHttpError(response.status);
      }
      // This includes the body in the timeout/retry boundary, rather than declaring success on headers.
      return new Response(await response.arrayBuffer(), { status: response.status, headers: response.headers });
    } catch (error) {
      options.signal?.throwIfAborted();
      if (error instanceof DownloadHttpError || attempt >= 2) throw error;
      if (!(error instanceof TypeError) && !(error instanceof Error && RETRYABLE_ERRORS.has(error.name))) throw error;
      await (options.retryDelay ?? wait)([500, 1500][attempt], options.signal);
    }
  }
}
class DownloadHttpError extends Error {
  constructor(status: number) {
    super(`Download request failed (${status})`);
  }
}
function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
