"use client";

type CacheEntry<T> = {
  data?: T;
  expiresAt: number;
  promise?: Promise<T>;
};

const cache = new Map<string, CacheEntry<unknown>>();

export async function cachedJson<T>(key: string, url: string, ttlMs: number, init?: RequestInit): Promise<T> {
  const now = Date.now();
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (entry?.data !== undefined && entry.expiresAt > now) return entry.data;
  if (entry?.promise) return entry.promise;

  const promise = fetch(url, { ...init, cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error(`Request failed with ${response.status}`);
    return (await response.json()) as T;
  });

  cache.set(key, { data: entry?.data, expiresAt: now + ttlMs, promise });

  try {
    const data = await promise;
    cache.set(key, { data, expiresAt: Date.now() + ttlMs });
    return data;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

export function clearClientCache(prefix?: string) {
  for (const key of cache.keys()) {
    if (!prefix || key.startsWith(prefix)) cache.delete(key);
  }
}
