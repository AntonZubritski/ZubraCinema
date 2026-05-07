import { useCallback, useEffect, useRef } from 'react';

type Options = {
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
  rootMargin?: string;
};

// useInfiniteScroll attaches an IntersectionObserver to a sentinel <div>
// rendered below the list. We use a ref-callback (not a ref-object) so the
// effect that wires up the observer runs the moment the node mounts —
// avoiding a race where the observer is created before the DOM node exists.
// onLoadMore is held in a ref so parent re-renders with a new closure don't
// force the observer to disconnect/reconnect on every render.
export function useInfiniteScroll(opts: Options): (node: HTMLDivElement | null) => void {
  const { hasMore, loading, onLoadMore, rootMargin = '600px' } = opts;
  const cbRef = useRef(onLoadMore);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    cbRef.current = onLoadMore;
  }, [onLoadMore]);

  const setRef = useCallback((node: HTMLDivElement | null) => {
    nodeRef.current = node;
    // Trigger re-wiring by toggling a tick on the observer-effect — done
    // implicitly because setRef changes node identity and we rebuild below.
    rewire();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // rewire: tear down the previous observer and (if eligible) create a new
  // one bound to the current node. Called from setRef and from the deps
  // effect below.
  function rewire() {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (typeof IntersectionObserver === 'undefined') return;
    const node = nodeRef.current;
    if (!node || !hasMore) return;
    const io = new IntersectionObserver((entries) => {
      const e = entries[0];
      if (!e || !e.isIntersecting) return;
      if (!hasMore || loading) return;
      cbRef.current();
    }, { rootMargin });
    io.observe(node);
    observerRef.current = io;
  }

  useEffect(() => {
    rewire();
    return () => { observerRef.current?.disconnect(); observerRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loading, rootMargin]);

  return setRef;
}
