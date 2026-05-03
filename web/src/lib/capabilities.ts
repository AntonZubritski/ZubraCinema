import { useEffect, useState } from 'react';
import { getCapabilities, type Capabilities } from '../api';

// Module-level cache: capabilities don't change for the lifetime of a server
// process, so the first successful fetch is shared across every component
// that mounts later. `inflight` deduplicates concurrent requests during the
// initial render — without it, every PlayerPage on first paint would hit
// /api/capabilities independently.
let cached: Capabilities | null = null;
let inflight: Promise<Capabilities> | null = null;

function load(): Promise<Capabilities> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = getCapabilities()
    .then((c) => {
      cached = c;
      inflight = null;
      return c;
    })
    .catch((err) => {
      // On failure (network, 404 on older servers without /api/capabilities)
      // fall back to assuming no ffmpeg. Caller behavior is identical to
      // running against a server where ffmpeg is missing — incompatible files
      // route to the external player.
      inflight = null;
      cached = { ffmpeg: false };
      // Don't throw — capabilities is best-effort, not load-bearing for the
      // app to function.
      console.warn('capabilities probe failed:', err);
      return cached;
    });
  return inflight;
}

// useCapabilities returns null while the initial fetch is in flight, then
// the resolved Capabilities object. Subsequent mounts get the cached value
// synchronously on first render.
export function useCapabilities(): Capabilities | null {
  const [caps, setCaps] = useState<Capabilities | null>(cached);
  useEffect(() => {
    if (caps) return;
    let cancelled = false;
    void load().then((c) => {
      if (!cancelled) setCaps(c);
    });
    return () => {
      cancelled = true;
    };
  }, [caps]);
  return caps;
}
