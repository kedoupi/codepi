export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 502) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export async function upstreamFetch(url: string | URL, init: RequestInit = {}): Promise<Response> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12_000) });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401 || response.status === 400) throw new ApiError("reconnect_required", 401);
      if (response.status === 429) throw new ApiError("rate_limited", 429);
      throw new ApiError("upstream_unavailable", 502);
    }
    return response;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("upstream_unavailable", 502);
  }
}
