import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ApiError,
  deleteTorrent,
  getTorrent,
  hasFfmpeg,
  launchExternal,
  probeTorrentFile,
  streamUrl,
  subtitleUrl,
  transcodeUrl,
  type TorrentDetail,
  type TrackInfo,
} from '../api';
import { ProgressBar } from '../components/ProgressBar';
import { SeekBar } from '../components/SeekBar';
import { Spinner } from '../components/Spinner';
import { TopBar } from '../components/TopBar';
import { TrackMenu } from '../components/TrackMenu';
import { useToast } from '../lib/toast';
import { useCapabilities } from '../lib/capabilities';
import { formatBytes, formatPercent, formatRate } from '../lib/format';
import { trackLabel } from '../lib/trackLabel';

const POLL_MS = 2000;

type Status = 'loading' | 'success' | 'error';

// PlaybackPhase tracks the <video> element's effective state for the overlay.
// `transcoding` is the buffering state when we've routed the file through
// ffmpeg server-side — visually distinct from plain swarm-buffering so the
// user can tell why startup is slower than usual.
type PlaybackPhase =
  | 'buffering'
  | 'transcoding'
  | 'stalled'
  | 'incompatible'
  | 'playing'
  | 'error';

const STALL_TIMEOUT_MS = 15000;

// Containers Chromium reliably plays inline. Anything else (mkv/avi/ts/...) is
// shown as 'incompatible' immediately — better to route to mpv/VLC than waste
// time on a <video> that will fail.
const BROWSER_PLAYABLE_EXTS = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogg', 'ogv']);

function fileExt(path: string): string {
  return path.toLowerCase().split('.').pop() ?? '';
}

function isVideoFile(mimeType: string | null, path: string): boolean {
  if (mimeType && mimeType.startsWith('video/')) return true;
  const ext = fileExt(path);
  return ['mp4', 'mkv', 'webm', 'avi', 'mov', 'm4v', 'ts', 'wmv', 'flv'].includes(ext);
}

function isBrowserPlayable(mimeType: string | null, path: string): boolean {
  const ext = fileExt(path);
  if (BROWSER_PLAYABLE_EXTS.has(ext)) return true;
  if (mimeType === 'video/mp4' || mimeType === 'video/webm') return true;
  return false;
}

function pickDefaultFile(torrent: TorrentDetail): number {
  const videos = torrent.files.filter((f) => isVideoFile(f.mimeType, f.path));
  const pool = videos.length > 0 ? videos : torrent.files;
  if (pool.length === 0) return 0;
  return pool.reduce((best, f) => (f.size > best.size ? f : best), pool[0]).idx;
}

export default function PlayerPage() {
  const params = useParams<{ torrentId: string }>();
  const torrentId = params.torrentId ?? '';
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const showToast = useToast();

  const [torrent, setTorrent] = useState<TorrentDetail | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [errorText, setErrorText] = useState('');
  const [stopping, setStopping] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [phase, setPhase] = useState<PlaybackPhase>('buffering');
  const [overlayLaunching, setOverlayLaunching] = useState(false);
  const caps = useCapabilities();

  // Seek state for transcoded streams. The fragmented-MP4 pipe ffmpeg emits
  // is forward-only, so we can't use the native <video> seek bar — clicking
  // it would drop the connection mid-frame. Instead we re-spawn ffmpeg at a
  // new -ss offset whenever the user seeks: seekOffsetSec records the time
  // we asked the backend to start at, and the displayed playhead is that
  // plus the <video>'s currentTime (which is local to the spawn).
  const [durationSec, setDurationSec] = useState<number>(0);
  const [audioTracks, setAudioTracks] = useState<TrackInfo[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<TrackInfo[]>([]);
  // Track selection: `null` for audio = "auto" (let ffmpeg pick the
  // default), `null` for subtitles = "off" (no <track> rendered).
  const [audioIndex, setAudioIndex] = useState<number | null>(null);
  const [subtitleIndex, setSubtitleIndex] = useState<number | null>(null);
  const [seekOffsetSec, setSeekOffsetSec] = useState<number>(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState<number>(0);
  const [videoBufferedAhead, setVideoBufferedAhead] = useState<number>(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Adult hint passed from MoviePage. We start muted on 18+ content so a
  // surprise loud audio doesn't broadcast across the room. Default: false.
  const location = useLocation();
  const isAdult = (location.state as { adult?: boolean } | null)?.adult === true;

  // Player chrome auto-hide. Mouse movement on the player resets the
  // visibility timer; after IDLE_MS of stillness during 'playing' the
  // bottom strip + cursor fade out, like every native video player.
  const [controlsVisible, setControlsVisible] = useState(true);
  const idleTimerRef = useRef<number | null>(null);
  const IDLE_MS = 2500;
  const handlePlayerMouseMove = useCallback(() => {
    setControlsVisible(true);
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => setControlsVisible(false), IDLE_MS);
  }, []);
  const handlePlayerMouseLeave = useCallback(() => {
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => setControlsVisible(false), 600);
  }, []);
  useEffect(() => {
    return () => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    };
  }, []);

  // Track fullscreen state via the standard event so the button icon can
  // toggle and we can re-render the SeekBar in the right context. Listens
  // on document because Fullscreen API events fire there.
  useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement != null);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = playerContainerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    }
  }, []);

  // Latest torrent reference for the unmount cleanup effect, which only fires
  // when the page is actually torn down (otherwise it would re-fire on every
  // poll tick that updates `torrent`).
  const torrentRef = useRef<TorrentDetail | null>(null);
  useEffect(() => {
    torrentRef.current = torrent;
  }, [torrent]);

  const fileQuery = searchParams.get('file');
  const requestedFileIdx = fileQuery !== null ? Number(fileQuery) : null;

  const activeFileIdx = useMemo<number | null>(() => {
    if (!torrent) return null;
    if (
      requestedFileIdx !== null &&
      Number.isFinite(requestedFileIdx) &&
      torrent.files.some((f) => f.idx === requestedFileIdx)
    ) {
      return requestedFileIdx;
    }
    return pickDefaultFile(torrent);
  }, [torrent, requestedFileIdx]);

  // initial fetch
  useEffect(() => {
    if (!torrentId) {
      setStatus('error');
      setErrorText('Missing torrent identifier');
      return;
    }
    const ac = new AbortController();
    setStatus('loading');
    void (async () => {
      try {
        const t = await getTorrent(torrentId, ac.signal);
        if (ac.signal.aborted) return;
        setTorrent(t);
        setStatus('success');
      } catch (err) {
        if (ac.signal.aborted) return;
        setErrorText(err instanceof Error ? err.message : 'Failed to load torrent');
        setStatus('error');
      }
    })();
    return () => {
      ac.abort();
    };
  }, [torrentId]);

  // polling for stats
  useEffect(() => {
    if (status !== 'success' || !torrentId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const ac = new AbortController();
        const t = await getTorrent(torrentId, ac.signal);
        if (!cancelled) setTorrent(t);
      } catch {
        // ignore transient errors during polling
      } finally {
        if (!cancelled) {
          timer = setTimeout(tick, POLL_MS);
        }
      }
    };

    timer = setTimeout(tick, POLL_MS);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [status, torrentId]);

  // Reset phase to 'buffering' when the user switches files. Separate from
  // the phase-init effect below so a file change always wins over a
  // sticky 'playing' state.
  useEffect(() => {
    setPhase('buffering');
  }, [activeFileIdx]);

  // Compute the appropriate pre-playback phase based on file type + caps.
  // Decision tree:
  //   - browser-playable container → plain 'buffering' (waiting on swarm).
  //   - not playable BUT server has ffmpeg → 'transcoding' (we'll point the
  //     <video> at the transcode endpoint).
  //   - not playable AND no ffmpeg → 'incompatible' (route to external).
  //
  // CRITICAL: once playback has actually started ('playing') OR we hit a
  // terminal 'error', do NOT overwrite that state. Stats polling re-renders
  // `torrent` every 2s, and without this guard the overlay would yank
  // back to 'transcoding' over a successfully playing video — the bug a
  // user reported as "encoding still showing while the film is running".
  // We wait for `caps` to resolve before flipping to 'incompatible' so a
  // brief capabilities-probe delay doesn't flash the wrong overlay.
  useEffect(() => {
    if (!torrent || activeFileIdx === null) return;
    const file = torrent.files.find((f) => f.idx === activeFileIdx);
    if (!file) return;
    setPhase((prev) => {
      if (prev === 'playing' || prev === 'error') return prev;
      if (isBrowserPlayable(file.mimeType, file.path)) return 'buffering';
      if (caps === null) return 'buffering';
      return hasFfmpeg(caps) ? 'transcoding' : 'incompatible';
    });
  }, [torrent, activeFileIdx, caps]);

  // Upgrade 'buffering' to 'stalled' after STALL_TIMEOUT_MS so the user sees
  // a clearer message (and a prominent external-player button) when the swarm
  // isn't producing data. Transcoding intentionally has no stall timeout —
  // ffmpeg startup latency on slow swarms is normal and the overlay already
  // explains what's happening.
  useEffect(() => {
    if (phase !== 'buffering') return;
    const t = setTimeout(() => setPhase('stalled'), STALL_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [phase, activeFileIdx]);

  // Auto-stop streaming torrents when leaving the page. Download mode stays
  // running. Partial pieces are removed from the buffer folder — the user is
  // done with this stream, so we don't want to leave gigabytes of leftover
  // pieces on disk. Download-mode torrents keep their files because the user
  // explicitly asked to retain them.
  useEffect(() => {
    return () => {
      const t = torrentRef.current;
      if (!t || !torrentId) return;
      if (t.mode === 'download') return;
      void deleteTorrent(torrentId, true).catch(() => {
        // best-effort; ignore failures on unmount
      });
    };
  }, [torrentId]);

  const handleSelectFile = useCallback(
    (idx: number) => {
      const next = new URLSearchParams(searchParams);
      next.set('file', String(idx));
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const launchInExternal = useCallback(async () => {
    if (activeFileIdx === null) return;
    const absoluteUrl = `${window.location.origin}${streamUrl(torrentId, activeFileIdx)}`;
    await launchExternal(absoluteUrl);
  }, [activeFileIdx, torrentId]);

  const handleExternal = useCallback(async () => {
    if (activeFileIdx === null || launching) return;
    setLaunching(true);
    try {
      await launchInExternal();
      showToast('info', 'Opened in external player');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not launch external player';
      showToast('error', msg);
    } finally {
      setLaunching(false);
    }
  }, [activeFileIdx, launching, launchInExternal, showToast]);

  const handleOverlayExternal = useCallback(async () => {
    if (activeFileIdx === null || overlayLaunching) return;
    setOverlayLaunching(true);
    try {
      await launchInExternal();
      showToast('info', 'Opened in external player');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Could not launch external player';
      showToast('error', msg);
    } finally {
      setOverlayLaunching(false);
    }
  }, [activeFileIdx, launchInExternal, overlayLaunching, showToast]);

  const handleStop = useCallback(async () => {
    if (stopping) return;
    setStopping(true);
    try {
      // deleteFiles=true: explicit Stop wipes the partial pieces from the
      // buffer folder. The unmount path does the same so the two routes out
      // of the player behave identically.
      await deleteTorrent(torrentId, true);
      navigate('/');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not stop torrent';
      showToast('error', msg);
      setStopping(false);
    }
  }, [navigate, showToast, stopping, torrentId]);

  // playbackUrl picks between the raw stream and the ffmpeg transcode pipe.
  //   - playable container → /stream/  (range-supported, seek works)
  //   - non-playable + ffmpeg available → /transcode/  (no seek, no length)
  //   - non-playable + no ffmpeg → '' (don't render <video>; overlay handles
  //     the route-to-external UX)
  // Returning '' for the no-ffmpeg case keeps the <video> element unmounted
  // so it can't latch onto a stale src and emit a confusing 'error' event.
  const playbackUrl = useMemo<string>(() => {
    if (!torrent || activeFileIdx === null) return '';
    const file = torrent.files.find((f) => f.idx === activeFileIdx);
    if (!file) return '';
    if (isBrowserPlayable(file.mimeType, file.path)) {
      return streamUrl(torrentId, activeFileIdx);
    }
    if (hasFfmpeg(caps)) {
      // seekOffsetSec triggers the URL to change when the user clicks the
      // custom SeekBar — that re-mounts the <video> via key=playbackUrl and
      // ffmpeg respawns with -ss at the new offset. audioIndex changes
      // similarly re-mount the <video> so ffmpeg respawns with a new
      // `-map 0:a:N` track selection.
      return transcodeUrl(
        torrentId,
        activeFileIdx,
        seekOffsetSec,
        audioIndex ?? undefined,
      );
    }
    return '';
  }, [torrent, activeFileIdx, torrentId, caps, seekOffsetSec, audioIndex]);

  // Whether the current playback URL is going through ffmpeg. Used to gate
  // overlay copy and the 'transcoding' phase.
  const isTranscoding = useMemo<boolean>(() => {
    if (!torrent || activeFileIdx === null) return false;
    const file = torrent.files.find((f) => f.idx === activeFileIdx);
    if (!file) return false;
    return !isBrowserPlayable(file.mimeType, file.path) && hasFfmpeg(caps);
  }, [torrent, activeFileIdx, caps]);

  // Reset seek state when the user changes file. Otherwise an old seekOffset
  // leaks into the new file's URL and ffmpeg starts at a meaningless time.
  // Track selections + the tracks list reset too: indices are per-file and
  // would point at the wrong stream after a switch.
  useEffect(() => {
    setSeekOffsetSec(0);
    setVideoCurrentTime(0);
    setVideoBufferedAhead(0);
    setDurationSec(0);
    setAudioTracks([]);
    setSubtitleTracks([]);
    setAudioIndex(null);
    setSubtitleIndex(null);
  }, [activeFileIdx]);

  // Probe duration + tracks once per (torrentId, activeFileIdx). Backend
  // caches the result, so re-probing is cheap, but we still skip the
  // round-trip when we already have a value. Browser-playable files use
  // native <video> duration (no probe needed) but probing them is also
  // harmless. Audio/subtitle arrays drive the TrackMenu pickers below.
  useEffect(() => {
    if (!torrent || activeFileIdx === null) return;
    const ac = new AbortController();
    void (async () => {
      try {
        const info = await probeTorrentFile(torrentId, activeFileIdx, ac.signal);
        if (ac.signal.aborted) return;
        if (info.durationSec > 0) setDurationSec(info.durationSec);
        setAudioTracks(info.audio);
        setSubtitleTracks(info.subtitles);
      } catch {
        // Probe is best-effort — the SeekBar just stays disabled if it
        // fails, and the user can still rely on the external player.
      }
    })();
    return () => {
      ac.abort();
    };
  }, [torrent, activeFileIdx, torrentId]);

  // Track <video> currentTime + buffered. Driven by 'timeupdate' + 'progress'
  // events instead of polling so we don't churn re-renders when paused.
  const handleVideoTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setVideoCurrentTime(v.currentTime);
  }, []);

  const handleVideoProgress = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const buf = v.buffered;
    if (buf.length > 0) {
      setVideoBufferedAhead(buf.end(buf.length - 1));
    }
  }, []);

  // Custom seek splits two paths:
  //   - Browser-playable container (mp4/webm/...): the /stream/ endpoint
  //     already supports byte-range seeking. Just move <video>.currentTime
  //     and the browser handles the Range request.
  //   - Transcoded stream (ffmpeg pipe): forward-only, so we re-spawn
  //     ffmpeg with a new -ss offset by bumping seekOffsetSec — the URL
  //     changes, key={playbackUrl} re-mounts <video>, currentTime resets.
  const handleSeek = useCallback((targetSec: number) => {
    if (!Number.isFinite(targetSec)) return;
    const clamped = Math.max(0, targetSec);
    if (!isTranscoding) {
      const v = videoRef.current;
      if (v) {
        try {
          v.currentTime = clamped;
        } catch {
          // older Safari throws if seeking before metadata loaded — ignore
        }
      }
      return;
    }
    setSeekOffsetSec(clamped);
    setVideoCurrentTime(0);
    setVideoBufferedAhead(0);
    setPhase('transcoding');
  }, [isTranscoding]);

  // Audio track change: same restart pattern as a transcoded seek. The URL
  // memo picks up the new audioIndex, key={playbackUrl} re-mounts <video>,
  // ffmpeg respawns with -map 0:a:N. We preserve the current playhead so
  // the user doesn't get yanked back to 0:00 — store it as the new
  // seekOffsetSec and reset the local video clock, mirroring handleSeek.
  const handleAudioChange = useCallback(
    (next: number | null) => {
      setAudioIndex((prev) => {
        if (prev === next) return prev;
        if (isTranscoding) {
          const resumeAt = seekOffsetSec + videoCurrentTime;
          setSeekOffsetSec(Math.max(0, resumeAt));
          setVideoCurrentTime(0);
          setVideoBufferedAhead(0);
          setPhase('transcoding');
        }
        return next;
      });
    },
    [isTranscoding, seekOffsetSec, videoCurrentTime],
  );

  const displayPositionSec = seekOffsetSec + videoCurrentTime;
  const displayBufferedSec = seekOffsetSec + videoBufferedAhead;

  // Build picker options from the probe result. Audio gets one entry per
  // track (no "auto" — there's always a default played by ffmpeg). Subs
  // prepend an "Откл." entry so the user can hide subtitles entirely.
  const audioOptions = useMemo(
    () => audioTracks.map((t) => ({ value: t.index, label: trackLabel(t) })),
    [audioTracks],
  );
  const subtitleOptions = useMemo(
    () => [
      { value: null as number | null, label: 'Откл.' },
      ...subtitleTracks.map((t) => ({
        value: t.index as number | null,
        label: trackLabel(t),
      })),
    ],
    [subtitleTracks],
  );

  // For multi-file torrents, the API's `torrent.progress` is whole-torrent
  // and looks misleadingly small when we're only streaming one episode of a
  // season (e.g. "1.2% of 15.8 GB" when really we have ~80% of the active
  // 2.8 GB episode). Surface the per-file progress instead so the user
  // doesn't think the app is downloading every episode.
  const activeFileProgress = useMemo<number>(() => {
    if (!torrent || activeFileIdx === null) return 0;
    const file = torrent.files.find((f) => f.idx === activeFileIdx);
    return file?.progress ?? 0;
  }, [torrent, activeFileIdx]);

  return (
    <div className="grain vignette min-h-screen relative">
      <TopBar
        title={torrent?.name}
        showBack
        onBack={() => navigate(-1)}
        onMenu={() => navigate('/')}
        onSettings={() => navigate('/')}
      />
      <div className="relative z-10 max-w-[1500px] mx-auto px-6 lg:px-10 pt-4 pb-16">

        {status === 'loading' && <PlayerSkeleton />}

        {status === 'error' && (
          <div className="mt-12 max-w-xl mx-auto text-center animate-fade-in">
            <p className="text-[11px] uppercase tracking-[0.25em] text-ember-300/80 mb-3">
              Could not load this stream
            </p>
            <p className="text-bone-50 text-lg tracking-tight">{errorText}</p>
            <Link
              to="/"
              className="
                focus-ring
                inline-flex items-center
                mt-6 px-6 py-3
                text-xs uppercase tracking-[0.18em] font-medium
                text-bone-50 bg-ember-400 hover:bg-ember-300
                transition-colors
              "
              style={{ borderRadius: 1 }}
            >
              Back to search
            </Link>
          </div>
        )}

        {status === 'success' && torrent && (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-8 mt-6 animate-fade-in">
            <div className="min-w-0">
              <div
                ref={playerContainerRef}
                onMouseMove={handlePlayerMouseMove}
                onMouseLeave={handlePlayerMouseLeave}
                className={
                  (isFullscreen
                    ? 'relative bg-black w-screen h-screen flex items-center justify-center'
                    : 'relative bg-black ring-1 ring-ember-300/40 overflow-hidden max-h-[calc(100vh-160px)]') +
                  (controlsVisible ? '' : ' cursor-none')
                }
                style={isFullscreen ? undefined : { aspectRatio: '16 / 9', borderRadius: 2 }}
              >
                {playbackUrl && (
                  <video
                    key={playbackUrl}
                    ref={videoRef}
                    controls
                    playsInline
                    preload="metadata"
                    autoPlay
                    muted={isAdult}
                    src={playbackUrl}
                    className="absolute inset-0 w-full h-full block"
                    style={{ objectFit: 'contain' }}
                    onPlaying={() => setPhase('playing')}
                    onError={() => setPhase('error')}
                    onTimeUpdate={handleVideoTimeUpdate}
                    onProgress={handleVideoProgress}
                    onLoadedMetadata={() => {
                      // For browser-playable streams the <video> knows the
                      // real duration — adopt it so SeekBar reflects truth
                      // even without a probe round-trip.
                      const v = videoRef.current;
                      if (v && Number.isFinite(v.duration) && v.duration > 0 && !isTranscoding) {
                        setDurationSec(v.duration);
                      }
                    }}
                  >
                    {/* Subtitle <track> only renders when the user has
                        explicitly picked a stream. `key` swaps the element
                        when the selection changes, forcing the browser to
                        reload the .vtt — otherwise some engines stick
                        with the first src they saw. activeFileIdx is in
                        the key so a file switch doesn't keep a stale
                        track around either. */}
                    {subtitleIndex !== null && activeFileIdx !== null && (
                      <track
                        key={`sub-${activeFileIdx}-${subtitleIndex}`}
                        kind="subtitles"
                        default
                        src={subtitleUrl(torrentId, activeFileIdx, subtitleIndex)}
                      />
                    )}
                  </video>
                )}
                {phase !== 'playing' && (
                  <PlaybackOverlay
                    phase={phase}
                    peers={torrent.peers}
                    downloadRate={torrent.downloadRate}
                    onExternal={handleOverlayExternal}
                    launching={overlayLaunching}
                    canLaunch={activeFileIdx !== null}
                    transcoding={isTranscoding}
                  />
                )}
                {/* Custom seek bar overlaid at the bottom of the player.
                    Hidden while the PlaybackOverlay is up so it doesn't
                    poke through the spinner / messaging. Sits above the
                    native video controls via z-20. */}
                {phase === 'playing' && (
                  // bottom-12 (= 48px) leaves room for the native browser
                  // controls (play/volume/fullscreen) directly underneath.
                  // Auto-hides with the rest of the chrome after IDLE_MS
                  // of mouse stillness so the panel doesn't park over the
                  // film while the user just watches.
                  <div
                    className={`
                      absolute inset-x-0 bottom-12 z-20 px-4 pt-8 pb-2
                      bg-gradient-to-t from-black/85 via-black/40 to-transparent
                      pointer-events-none
                      transition-opacity duration-300
                      ${controlsVisible ? 'opacity-100' : 'opacity-0'}
                    `}
                  >
                    <div className="pointer-events-auto">
                      <SeekBar
                        durationSec={durationSec}
                        positionSec={displayPositionSec}
                        bufferedSec={displayBufferedSec}
                        disabled={durationSec <= 0}
                        onSeek={handleSeek}
                      />
                      {/* Track pickers — shown only when there's a real
                          choice. Audio menu requires >1 audio stream
                          (single-track files don't need a picker). Subs
                          menu shows whenever subtitles exist, since
                          turning them off is a meaningful action. */}
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {audioTracks.length > 1 && (
                          <TrackMenu
                            label="Аудио"
                            options={audioOptions}
                            value={audioIndex}
                            onChange={handleAudioChange}
                          />
                        )}
                        {subtitleTracks.length > 0 && (
                          <TrackMenu
                            label="Субтитры"
                            options={subtitleOptions}
                            value={subtitleIndex}
                            onChange={setSubtitleIndex}
                          />
                        )}
                        <div className="flex-1" />
                        <button
                          type="button"
                          onClick={toggleFullscreen}
                          className="
                            focus-ring
                            inline-flex items-center justify-center
                            w-9 h-9 rounded-full
                            bg-white/5 hover:bg-white/10
                            border border-white/10
                            text-bone-200/85 hover:text-bone-50
                            transition-colors
                          "
                          aria-label={isFullscreen ? 'Выйти из полноэкранного режима' : 'Полный экран'}
                        >
                          {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {/* Live status strip beneath the player — shows peers/speed/
                  buffer at all times, plus an "encoding" badge when ffmpeg
                  is active. Lets the user keep an eye on the swarm without
                  reading the sidebar. */}
              <div className="mt-3 flex items-center gap-3 flex-wrap text-[11px] uppercase tracking-[0.2em] text-bone-300/60">
                {isTranscoding && (
                  <span className="px-2 py-0.5 text-ember-200 border border-ember-300/40 bg-ember-400/[0.06]">
                    Encoding
                  </span>
                )}
                <span>
                  Buffered <span className="text-bone-100 tabular-nums normal-case tracking-normal">{formatPercent(activeFileProgress)}</span>
                </span>
                <span className="text-bone-300/30">·</span>
                <span>
                  Peers <span className="text-bone-100 tabular-nums normal-case tracking-normal">{torrent.peers}</span>
                </span>
                <span className="text-bone-300/30">·</span>
                <span>
                  Speed <span className="text-bone-100 tabular-nums normal-case tracking-normal">{formatRate(torrent.downloadRate)}</span>
                </span>
              </div>
            </div>

            <aside className="min-w-0 flex flex-col gap-6">
              <div>
                <p className="text-[10px] uppercase tracking-[0.25em] text-ember-300/70 mb-2">
                  Now streaming
                </p>
                <h1 className="font-display text-2xl md:text-3xl text-bone-50 tracking-tightest leading-tight break-words">
                  {torrent.name}
                </h1>
                <p className="text-bone-300/50 text-xs tracking-wide mt-2 tabular-nums">
                  {formatBytes(torrent.totalSize)} total
                </p>
              </div>

              <StatsPanel torrent={torrent} activeProgress={activeFileProgress} />

              {torrent.files.length > 1 && (
                <FilePicker
                  files={torrent.files}
                  activeIdx={activeFileIdx}
                  onSelect={handleSelectFile}
                />
              )}

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleExternal}
                  disabled={launching || activeFileIdx === null}
                  className="
                    focus-ring
                    w-full flex items-center justify-center gap-2
                    px-4 py-3
                    text-[11px] uppercase tracking-[0.2em] font-medium
                    text-ember-200 hover:text-bone-50
                    border border-ember-300/40
                    hover:bg-ember-400 hover:border-ember-400
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-colors
                  "
                  style={{ borderRadius: 1 }}
                >
                  {launching ? <Spinner size={12} /> : <ExternalIcon />}
                  <span>Open in external player</span>
                </button>

                <button
                  type="button"
                  onClick={handleStop}
                  disabled={stopping}
                  className="
                    focus-ring
                    w-full flex items-center justify-center gap-2
                    px-4 py-3
                    text-[11px] uppercase tracking-[0.2em] font-medium
                    text-bone-300/70 hover:text-bone-100
                    border border-ink-700/60 hover:border-ink-600
                    disabled:opacity-50 disabled:cursor-not-allowed
                    transition-colors
                  "
                  style={{ borderRadius: 1 }}
                >
                  {stopping ? <Spinner size={12} /> : null}
                  <span>{stopping ? 'Stopping' : 'Stop torrent'}</span>
                </button>
              </div>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

function StatsPanel({
  torrent,
  activeProgress,
}: {
  torrent: TorrentDetail;
  activeProgress: number;
}) {
  return (
    <div
      className="border border-ink-700/60 bg-ink-900/60 p-4 space-y-3"
      style={{ borderRadius: 2 }}
    >
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-[0.25em] text-bone-300/60">
            Buffered
          </span>
          <span className="text-bone-50 tabular-nums text-sm">
            {formatPercent(activeProgress)}
          </span>
        </div>
        <ProgressBar progress={activeProgress} />
      </div>
      <div className="grid grid-cols-2 gap-3 pt-1">
        <Stat label="Peers" value={String(torrent.peers)} />
        <Stat label="Speed" value={formatRate(torrent.downloadRate)} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.25em] text-bone-300/50 mb-0.5">
        {label}
      </p>
      <p className="text-bone-50 text-sm tabular-nums tracking-wide">{value}</p>
    </div>
  );
}

type FileEntry = TorrentDetail['files'][number];

function FilePicker({
  files,
  activeIdx,
  onSelect,
}: {
  files: FileEntry[];
  activeIdx: number | null;
  onSelect: (idx: number) => void;
}) {
  const sorted = [...files].sort((a, b) => b.size - a.size);
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.25em] text-bone-300/60 mb-2">
        Files
      </p>
      <ul
        className="border border-ink-700/60 bg-ink-900/60 max-h-72 overflow-y-auto divide-y divide-ink-700/40"
        style={{ borderRadius: 2 }}
      >
        {sorted.map((f) => {
          const active = f.idx === activeIdx;
          const playable = isVideoFile(f.mimeType, f.path);
          const fileName = f.path.split('/').pop() ?? f.path;
          return (
            <li key={f.idx}>
              <button
                type="button"
                onClick={() => playable && onSelect(f.idx)}
                disabled={!playable}
                className={`
                  focus-ring
                  w-full text-left
                  px-3 py-2.5
                  flex items-center gap-2
                  transition-colors
                  ${active ? 'bg-ember-400/[0.08] text-ember-100' : 'text-bone-100/90 hover:bg-ink-800/80'}
                  ${!playable ? 'opacity-40 cursor-not-allowed' : ''}
                `}
                title={fileName}
              >
                <span
                  className={`flex-shrink-0 inline-block w-1 h-1 rounded-full ${active ? 'bg-ember-300' : 'bg-bone-300/30'}`}
                />
                <span className="flex-1 min-w-0 truncate text-xs">{fileName}</span>
                <span className="flex-shrink-0 text-[10px] tabular-nums text-bone-300/50">
                  {formatBytes(f.size)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PlayerSkeleton() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-8 mt-6">
      <div
        className="w-full skeleton-shimmer"
        style={{ aspectRatio: '16 / 9', borderRadius: 2 }}
      />
      <div className="space-y-4">
        <div className="h-3 skeleton-shimmer w-1/3" style={{ borderRadius: 1 }} />
        <div className="h-8 skeleton-shimmer w-3/4" style={{ borderRadius: 2 }} />
        <div className="h-24 skeleton-shimmer w-full" style={{ borderRadius: 2 }} />
        <div className="h-10 skeleton-shimmer w-full" style={{ borderRadius: 1 }} />
        <div className="h-10 skeleton-shimmer w-full" style={{ borderRadius: 1 }} />
      </div>
    </div>
  );
}

function PlaybackOverlay({
  phase,
  peers,
  downloadRate,
  onExternal,
  launching,
  canLaunch,
  transcoding,
}: {
  phase: PlaybackPhase;
  peers: number;
  downloadRate: number;
  onExternal: () => void;
  launching: boolean;
  canLaunch: boolean;
  transcoding: boolean;
}) {
  // While buffering or transcoding we hide the external-player button — the
  // user is in the happy path and we don't want to nudge them off it.
  const showButton = phase !== 'buffering' && phase !== 'transcoding';

  let eyebrow = 'Подключение к swarm';
  let body: string | null = `peers: ${peers} · ${formatRate(downloadRate)}`;
  let showSpinner = true;
  // 'ENCODING' label is the only differentiator from plain swarm-buffering;
  // visually it sits above the eyebrow as a small monogram so users notice
  // their setup is doing extra work and don't blame the swarm for slowness.
  let badge: string | null = null;

  if (phase === 'transcoding') {
    badge = 'ENCODING';
    eyebrow = 'Транскодинг через ffmpeg';
    body = `peers: ${peers} · ${formatRate(downloadRate)} — ремуксим контейнер на лету, секунд 5-15 на старт.`;
    showSpinner = true;
  } else if (phase === 'stalled') {
    eyebrow = 'Слабый swarm';
    body = `peers: ${peers} · ${formatRate(downloadRate)} — данные не идут. Открой во внешнем плеере, mpv справляется лучше.`;
    showSpinner = true;
  } else if (phase === 'incompatible') {
    eyebrow = 'Формат не для браузера';
    body = 'Этот контейнер (mkv/avi/ts) Chromium играть не умеет. Открой во внешнем плеере — mpv/VLC справятся.';
    showSpinner = false;
  } else if (phase === 'error') {
    eyebrow = transcoding
      ? 'Транскодинг сорвался'
      : 'Воспроизведение прервано';
    body = transcoding
      ? 'ffmpeg не смог обработать этот файл (редкий кодек?). Открой во внешнем плеере.'
      : 'Не удалось загрузить — попробуй внешний плеер или другую раздачу.';
    showSpinner = false;
  }

  return (
    <div
      className="
        absolute inset-0 z-10
        flex flex-col items-center justify-center
        gap-4 px-6 text-center
        bg-black/70 backdrop-blur-sm
        animate-fade-in
        pointer-events-none
      "
    >
      {showSpinner && <Spinner size={28} />}
      {badge && (
        <p className="text-[9px] uppercase tracking-[0.35em] font-medium text-ember-200 bg-ember-400/10 border border-ember-300/40 px-2 py-0.5">
          {badge}
        </p>
      )}
      <p className="text-[11px] uppercase tracking-[0.25em] text-ember-300/80">
        {eyebrow}
      </p>
      {body && (
        <p className="text-bone-50 text-sm max-w-md tracking-tight">
          {body}
        </p>
      )}
      {showButton && (
        <button
          type="button"
          onClick={onExternal}
          disabled={launching || !canLaunch}
          className="
            focus-ring
            pointer-events-auto
            inline-flex items-center justify-center gap-2
            mt-2 px-6 py-3
            text-[11px] uppercase tracking-[0.2em] font-medium
            text-bone-50 bg-ember-400 hover:bg-ember-300
            disabled:opacity-60 disabled:cursor-not-allowed
            transition-colors
          "
          style={{ borderRadius: 1 }}
        >
          {launching ? <Spinner size={12} /> : <ExternalIcon />}
          <span>Открыть в плеере</span>
        </button>
      )}
    </div>
  );
}

function ExternalIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 4h6v6" />
      <path d="M10 14L20 4" />
      <path d="M20 14v6H4V4h6" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9V5a1 1 0 0 1 1-1h4" />
      <path d="M20 9V5a1 1 0 0 0-1-1h-4" />
      <path d="M4 15v4a1 1 0 0 0 1 1h4" />
      <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
    </svg>
  );
}

function FullscreenExitIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4v3a2 2 0 0 1-2 2H4" />
      <path d="M15 4v3a2 2 0 0 0 2 2h3" />
      <path d="M9 20v-3a2 2 0 0 0-2-2H4" />
      <path d="M15 20v-3a2 2 0 0 1 2-2h3" />
    </svg>
  );
}
