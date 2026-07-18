/** Once-per-key async cache. A failed load is evicted so the next call retries
 *  rather than caching the rejection for the life of the session. */
export function createAsyncCache<T>(load: (key: string) => Promise<T>): (key: string) => Promise<T> {
  const cache = new Map<string, Promise<T>>();
  return (key: string): Promise<T> => {
    let pending = cache.get(key);
    if (!pending) {
      pending = load(key).catch((err: unknown) => {
        cache.delete(key);
        throw err;
      });
      cache.set(key, pending);
    }
    return pending;
  };
}
