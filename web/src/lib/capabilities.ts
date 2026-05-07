import { useCallback, useEffect, useState } from 'react';
import { getCapabilities, type Capabilities } from '../api';

// Module-level cache: capabilities don't change for the lifetime of a server
// process EXCEPT after a successful one-click install — for that case the
// banner explicitly calls `refreshCapabilities()` to bust the cache. Without
// that escape hatch the banner would keep showing "missing" tools after the
// user installed them until they reload the page.
let cached: Capabilities | null = null;
let inflight: Promise<Capabilities> | null = null;
type Listener = (c: Capabilities) => void;
const listeners = new Set<Listener>();

const FALLBACK_CAPS: Capabilities = { tools: [], packageManager: '', os: '' };

function load(force = false): Promise<Capabilities> {
  if (!force && cached) return Promise.resolve(cached);
  if (!force && inflight) return inflight;
  inflight = getCapabilities()
    .then((c) => {
      cached = c;
      inflight = null;
      for (const l of listeners) l(c);
      return c;
    })
    .catch((err) => {
      // On failure (network, very-old server) fall back to "nothing
      // detected". The banner will then suggest the manual command UX
      // instead of trying to drive an install we can't run.
      inflight = null;
      cached = FALLBACK_CAPS;
      console.warn('capabilities probe failed:', err);
      for (const l of listeners) l(cached);
      return cached;
    });
  return inflight;
}

// useCapabilities returns null while the initial fetch is in flight, then
// the resolved Capabilities object. Subsequent mounts get the cached value
// synchronously on first render. Re-runs whenever refreshCapabilities()
// invalidates the cache.
export function useCapabilities(): Capabilities | null {
  const [caps, setCaps] = useState<Capabilities | null>(cached);
  useEffect(() => {
    if (!cached && !inflight) {
      void load();
    } else if (cached) {
      setCaps(cached);
    }
    const listener: Listener = (c) => setCaps(c);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return caps;
}

// refreshCapabilities forces a re-fetch and broadcasts the new value to
// every mounted useCapabilities consumer. Banner calls this after a
// successful install so the missing-tool list updates without a reload.
export function refreshCapabilities(): Promise<Capabilities> {
  return load(true);
}

// useRefreshCapabilities returns a stable callback for triggering a refresh.
// Convenience wrapper so components don't need to import the bare function.
export function useRefreshCapabilities(): () => Promise<Capabilities> {
  return useCallback(() => refreshCapabilities(), []);
}
