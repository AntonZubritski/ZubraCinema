import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// Lampa-CUB / Stremio-style hover backdrop. When the user hovers a poster
// for ~1 second, that poster fades in as a blurred full-viewport backdrop
// behind the rest of the UI. Quick fly-overs don't trigger anything —
// the dwell delay is intentional so the page doesn't flicker as the
// cursor sweeps across a row.
//
// Two-layer crossfade: layers A and B alternate. New URL goes to the
// idle layer and fades in while the previously-shown layer fades out
// concurrently — gives a soft transition between movies instead of a
// hard cut.

type Ctx = {
  setHovered: (url: string | null) => void;
};

const HoverBackdropContext = createContext<Ctx>({ setHovered: () => {} });

const HOVER_DELAY_MS = 800;
const FADE_MS = 900;

export function HoverBackdropProvider({ children }: { children: ReactNode }) {
  const [layerA, setLayerA] = useState<string | null>(null);
  const [layerB, setLayerB] = useState<string | null>(null);
  const [showA, setShowA] = useState(false);
  const [showB, setShowB] = useState(false);
  const slotRef = useRef<'a' | 'b'>('a'); // which slot will receive the next image
  const currentUrlRef = useRef<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const cancel = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const commit = useCallback((url: string | null) => {
    if (url === currentUrlRef.current) return;
    currentUrlRef.current = url;
    if (url === null) {
      setShowA(false);
      setShowB(false);
      return;
    }
    if (slotRef.current === 'a') {
      setLayerA(url);
      setShowA(true);
      setShowB(false);
      slotRef.current = 'b';
    } else {
      setLayerB(url);
      setShowB(true);
      setShowA(false);
      slotRef.current = 'a';
    }
  }, []);

  const setHovered = useCallback(
    (url: string | null) => {
      cancel();
      // null = "left a card" — but the user wants the backdrop to PERSIST
      // after a hover, only swapping when another card is hovered. So we
      // simply cancel any in-flight dwell timer (e.g. they were about to
      // commit but moved off before HOVER_DELAY_MS) and leave whatever
      // is currently showing alone.
      if (url === null) return;
      timerRef.current = window.setTimeout(() => commit(url), HOVER_DELAY_MS);
    },
    [commit],
  );

  useEffect(() => () => cancel(), []);

  return (
    <HoverBackdropContext.Provider value={{ setHovered }}>
      {/* Two stacked fixed layers, each crossfading independently. */}
      <BackdropLayer url={layerA} show={showA} />
      <BackdropLayer url={layerB} show={showB} />
      {children}
    </HoverBackdropContext.Provider>
  );
}

function BackdropLayer({ url, show }: { url: string | null; show: boolean }) {
  if (!url) return null;
  return (
    <div
      className="fixed inset-0 z-[3] pointer-events-none ease-out"
      style={{
        opacity: show ? 1 : 0,
        transition: `opacity ${FADE_MS}ms ease-out`,
      }}
      aria-hidden="true"
    >
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url("${url}")`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          // Light blur — poster is recognisable, just softened enough
          // to keep the foreground readable. Earlier 60px / 28px both
          // washed the image to mud.
          filter: 'blur(14px) saturate(1.15)',
          transform: 'scale(1.05)',
          opacity: 0.7,
        }}
      />
      {/* Dimming gradient — keeps text readable but softer than before
          so the backdrop doesn't disappear into the dark. */}
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950/30 via-ink-950/45 to-ink-950/75" />
    </div>
  );
}

export function useHoverBackdrop(): Ctx {
  return useContext(HoverBackdropContext);
}
