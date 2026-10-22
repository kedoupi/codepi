const D1_TRANSIENT = /D1_ERROR|D1 .*internal error/i;
const D1_DETERMINISTIC = /(?:7500|daily\s+(?:row\s+)?write\s+limit|quota|constraint|unique|foreign\s+key|no such table|syntax error)/i;

function isTransientD1Error(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return D1_TRANSIENT.test(message) && !D1_DETERMINISTIC.test(message);
}

/** Retry a single D1 operation once when the platform reports a transient error. */
export async function withD1Retry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (!isTransientD1Error(error)) throw error;
    await new Promise(resolve => setTimeout(resolve, 150));
    return fn();
  }
}
