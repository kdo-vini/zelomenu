export function fetchWithDeadline(input: Parameters<typeof fetch>[0], init?: RequestInit, timeoutMs = 15_000): Promise<Response> {
  const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const deadline = AbortSignal.timeout(timeoutMs);
  return fetch(input, { ...init, signal: callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline });
}
