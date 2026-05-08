export type GroupTorrent = {
  id: string;
  title: string;
  size: number;
  seeders: number;
  leechers: number;
  quality: string | null;
  source: string;
  magnet: string;
  /**
   * Optional .torrent file URL for sources that don't expose magnet links
   * (e.g. porevotorrent — its .torrent is hidden behind an ad-redirect
   * CDN). The backend resolves it to a magnet at start time.
   */
  torrentFileUrl?: string;
  language: string;
};

export type TorrentMode = 'stream' | 'download';

export type Group = {
  id: string;
  title: string;
  year: number;
  posterUrl: string;
  torrents: GroupTorrent[];
};

export type TorrentFile = {
  idx: number;
  path: string;
  size: number;
  mimeType: string | null;
  progress?: number;
};

export type ActiveTorrent = {
  id: string;
  name: string;
  progress: number;
  downloadRate: number;
  /** Currently-connected peers (handshake done, exchanging data). */
  peers: number;
  /**
   * Everyone the client knows about — active + half-open + pending.
   * Closer to "swarm size from our perspective" than `peers`. Backend
   * fills 0 if running on an older binary that didn't expose it; the UI
   * falls back to `peers` in that case.
   */
  totalPeers?: number;
  totalSize: number;
  mode?: TorrentMode;
};

export type TorrentDetail = ActiveTorrent & {
  files: Required<TorrentFile>[];
  mode?: TorrentMode;
};

export type TorrentSession = {
  id: string;
  name: string;
  totalSize: number;
  files: TorrentFile[];
  mode?: TorrentMode;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const data: unknown = await res.json();
      if (
        data &&
        typeof data === 'object' &&
        'error' in data &&
        typeof (data as { error: unknown }).error === 'string'
      ) {
        return (data as { error: string }).error;
      }
    } else {
      const text = await res.text();
      if (text.trim()) return text.slice(0, 200);
    }
  } catch {
    // ignore
  }
  return fallback;
}

export async function searchGroups(query: string, signal?: AbortSignal): Promise<Group[]> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal });
  if (!res.ok) {
    const msg = await readErrorMessage(res, `Search failed (${res.status})`);
    throw new ApiError(msg, res.status);
  }
  const data: unknown = await res.json();
  return Array.isArray(data) ? (data as Group[]) : [];
}

export async function fetchFeatured(signal?: AbortSignal): Promise<Group[]> {
  const res = await fetch('/api/featured', { signal });
  if (!res.ok) {
    const msg = await readErrorMessage(res, `Could not load featured (${res.status})`);
    throw new ApiError(msg, res.status);
  }
  const data: unknown = await res.json();
  return Array.isArray(data) ? (data as Group[]) : [];
}

/**
 * startTorrent kicks off a new torrent session by either magnet URI or
 * .torrent file URL. Pass the GroupTorrent directly — the function picks
 * the right field based on what's populated. Sources that publish magnets
 * use the magnet; sources that only have .torrent links (porevotorrent)
 * use the file URL, which the backend resolves to a magnet by fetching
 * and decoding the .torrent.
 */
export async function startTorrent(
  source: { magnet: string; torrentFileUrl?: string },
  mode: TorrentMode = 'stream',
): Promise<TorrentSession> {
  const magnet = source.magnet?.trim() ?? '';
  const torrentFileUrl = source.torrentFileUrl?.trim() ?? '';
  if (!magnet && !torrentFileUrl) {
    throw new ApiError('No magnet or torrent file URL on this release', 400);
  }
  const res = await fetch('/api/torrents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ magnet, torrentFileUrl, mode }),
  });
  if (res.status === 504) {
    // Backend keeps the torrent warming up after the initial wait, so a
    // second click usually succeeds within seconds. Tell the user to
    // retry rather than blaming the seeder count.
    throw new ApiError(
      'Метаданные ещё подгружаются — нажми «Смотреть» ещё раз через 10–20 секунд',
      504,
    );
  }
  if (res.status === 400) {
    const msg = await readErrorMessage(res, 'Invalid magnet link');
    throw new ApiError(msg, 400);
  }
  if (!res.ok) {
    const msg = await readErrorMessage(res, `Could not start torrent (${res.status})`);
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as TorrentSession;
}

export async function listActiveTorrents(signal?: AbortSignal): Promise<ActiveTorrent[]> {
  const res = await fetch('/api/torrents', { signal });
  if (!res.ok) {
    throw new ApiError(`Failed to load active torrents (${res.status})`, res.status);
  }
  const data: unknown = await res.json();
  return Array.isArray(data) ? (data as ActiveTorrent[]) : [];
}

export async function getTorrent(id: string, signal?: AbortSignal): Promise<TorrentDetail> {
  const res = await fetch(`/api/torrents/${encodeURIComponent(id)}`, { signal });
  if (!res.ok) {
    const msg = await readErrorMessage(res, `Failed to load torrent (${res.status})`);
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as TorrentDetail;
}

export async function deleteTorrent(id: string, deleteFiles: boolean): Promise<void> {
  // keepalive=true ensures the request survives page unload (closing the
  // tab, navigating away). Without it the fetch is cancelled mid-flight
  // and the backend never sees the DELETE — the cache stays on disk.
  const res = await fetch(
    `/api/torrents/${encodeURIComponent(id)}?deleteFiles=${deleteFiles ? 'true' : 'false'}`,
    { method: 'DELETE', keepalive: true },
  );
  if (!res.ok && res.status !== 204) {
    throw new ApiError(`Failed to stop torrent (${res.status})`, res.status);
  }
}

export async function launchExternal(url: string): Promise<void> {
  const res = await fetch('/api/launch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  if (!res.ok && res.status !== 204) {
    const msg = await readErrorMessage(res, `Could not launch external player (${res.status})`);
    throw new ApiError(msg, res.status);
  }
}

export function streamUrl(torrentId: string, fileIdx: number): string {
  return `/api/torrents/${encodeURIComponent(torrentId)}/stream/${fileIdx}`;
}

// Transcode endpoint pipes the file through ffmpeg server-side, remuxing into
// fragmented MP4. Use this for containers Chromium can't play natively
// (mkv/avi/ts/...) when the server reports `capabilities.ffmpeg === true`.
// The optional `startSec` param appends `?t=<sec>` so the server can seek
// into the source before remuxing — used to resume playback mid-file. The
// optional `audioIndex` param appends `&audio=<N>` so ffmpeg picks a
// specific audio track via `-map 0:a:N` (per-type 0-based index from
// ProbeInfo.audio[].index).
export function transcodeUrl(
  torrentId: string,
  fileIdx: number,
  startSec?: number,
  audioIndex?: number,
): string {
  const base = `/api/torrents/${encodeURIComponent(torrentId)}/transcode/${fileIdx}`;
  const parts: string[] = [];
  if (startSec !== undefined && startSec > 0 && Number.isFinite(startSec)) {
    parts.push(`t=${startSec.toFixed(3)}`);
  }
  if (audioIndex !== undefined && audioIndex >= 0 && Number.isFinite(audioIndex)) {
    parts.push(`audio=${audioIndex}`);
  }
  if (parts.length === 0) return base;
  return `${base}?${parts.join('&')}`;
}

// subtitleUrl returns the WebVTT endpoint for a specific subtitle stream
// inside a file. `subIdx` is the per-type index from ProbeInfo.subtitles[].index.
// Wired into <track src=...> elements.
export function subtitleUrl(
  torrentId: string,
  fileIdx: number,
  subIdx: number,
): string {
  return `/api/torrents/${encodeURIComponent(torrentId)}/subtitle/${fileIdx}/${subIdx}`;
}

// TrackInfo — single audio or subtitle track descriptor returned by the
// probe endpoint. `index` is per-type 0-based; that's what ffmpeg expects in
// `-map 0:a:N` / `-map 0:s:N`. `language` is ISO 639-2 ("rus", "eng") or "".
export type TrackInfo = {
  index: number;
  codec: string;
  language: string;
  title: string;
};

// ProbeInfo — wire shape returned by GET /api/torrents/{id}/probe/{fileIdx}.
// durationSec is the container's reported total duration in seconds (from
// ffprobe). audio + subtitles describe the available streams so the UI can
// offer language pickers. Cached server-side after the first probe.
export type ProbeInfo = {
  durationSec: number;
  audio: TrackInfo[];
  subtitles: TrackInfo[];
};

// parseTrack defensively coerces an unknown probe payload entry into a
// TrackInfo. Drops the entry (returns null) when `index` isn't a finite
// number — every other field defaults to '' so a partial server response
// can't crash the parser.
function parseTrack(raw: unknown): TrackInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.index !== 'number' || !Number.isFinite(r.index)) return null;
  return {
    index: r.index,
    codec: typeof r.codec === 'string' ? r.codec : '',
    language: typeof r.language === 'string' ? r.language : '',
    title: typeof r.title === 'string' ? r.title : '',
  };
}

// probeTorrentFile asks the backend to ffprobe the given file and return its
// total duration plus available audio/subtitle tracks. Result is cached
// server-side, so repeated calls are cheap. Defensive parsing: a
// malformed/zero/negative durationSec collapses to 0 rather than throwing —
// callers treat 0 as "unknown". Track arrays default to [] when absent.
export async function probeTorrentFile(
  torrentId: string,
  fileIdx: number,
  signal?: AbortSignal,
): Promise<ProbeInfo> {
  const res = await fetch(
    `/api/torrents/${encodeURIComponent(torrentId)}/probe/${fileIdx}`,
    { signal },
  );
  if (!res.ok) {
    const msg = await readErrorMessage(res, `Could not probe file (${res.status})`);
    throw new ApiError(msg, res.status);
  }
  const data: unknown = await res.json();
  if (!data || typeof data !== 'object') {
    return { durationSec: 0, audio: [], subtitles: [] };
  }
  const obj = data as Record<string, unknown>;
  const dur = typeof obj.durationSec === 'number' && obj.durationSec > 0
    ? obj.durationSec
    : 0;
  const audioRaw = Array.isArray(obj.audio) ? obj.audio : [];
  const subsRaw = Array.isArray(obj.subtitles) ? obj.subtitles : [];
  const audio: TrackInfo[] = audioRaw
    .map(parseTrack)
    .filter((t): t is TrackInfo => t !== null);
  const subtitles: TrackInfo[] = subsRaw
    .map(parseTrack)
    .filter((t): t is TrackInfo => t !== null);
  return { durationSec: dur, audio, subtitles };
}

// Tool names the backend knows how to detect + install. Keep this union in
// sync with internal/setup/setup.go knownTools.
export type ToolName = 'ffmpeg' | 'mpv' | 'vlc';

export type Tool = {
  name: ToolName;
  installed: boolean;
  path?: string;
  required: boolean;
};

export type PackageManager = 'winget' | 'brew' | 'apt' | 'dnf' | '';

export type Capabilities = {
  tools: Tool[];
  packageManager: PackageManager;
  os: 'windows' | 'darwin' | 'linux' | string;
};

const EMPTY_CAPS: Capabilities = { tools: [], packageManager: '', os: '' };

export async function getCapabilities(signal?: AbortSignal): Promise<Capabilities> {
  const res = await fetch('/api/capabilities', { signal });
  if (!res.ok) {
    throw new ApiError(`capabilities: ${res.status}`, res.status);
  }
  const data: unknown = await res.json();
  if (!data || typeof data !== 'object') return EMPTY_CAPS;
  const obj = data as Record<string, unknown>;
  // Defensive parsing: a stale server might still ship the v0.8 `{ffmpeg}`
  // shape. Map it forward so the new banner doesn't crash on old binaries.
  if ('ffmpeg' in obj && !('tools' in obj)) {
    return {
      tools: [
        { name: 'ffmpeg', installed: Boolean(obj.ffmpeg), required: true },
      ],
      packageManager: '',
      os: '',
    };
  }
  const rawTools = Array.isArray(obj.tools) ? obj.tools : [];
  const tools: Tool[] = rawTools
    .filter((t): t is Record<string, unknown> => !!t && typeof t === 'object')
    .map((t) => ({
      name: String(t.name) as ToolName,
      installed: Boolean(t.installed),
      path: typeof t.path === 'string' ? t.path : undefined,
      required: Boolean(t.required),
    }));
  return {
    tools,
    packageManager: (typeof obj.packageManager === 'string'
      ? obj.packageManager
      : '') as PackageManager,
    os: typeof obj.os === 'string' ? obj.os : '',
  };
}

// Helper: whether the in-browser remux pipeline can run. Used to gate UI
// that previously checked `caps.ffmpeg` directly.
export function hasFfmpeg(caps: Capabilities | null): boolean {
  if (!caps) return false;
  return caps.tools.some((t) => t.name === 'ffmpeg' && t.installed);
}

// installCommand returns the human-readable shell command for installing a
// tool with the host's package manager — used by the frontend "copy command"
// fallback when auto-install isn't possible (no PM, or apt failing without
// sudo). Returns empty string if there's no sensible suggestion.
export function installCommand(caps: Capabilities, tool: ToolName): string {
  const pm = caps.packageManager;
  if (!pm) {
    // No PM detected: surface the most likely command for the OS so the
    // user has SOMETHING to copy. Mirrors backend setup.CommandFor.
    if (caps.os === 'windows') return wingetCommand(tool);
    if (caps.os === 'darwin') return brewCommand(tool);
    if (caps.os === 'linux') return 'sudo ' + aptCommand(tool);
    return '';
  }
  if (pm === 'winget') return wingetCommand(tool);
  if (pm === 'brew') return brewCommand(tool);
  if (pm === 'apt') return 'sudo ' + aptCommand(tool);
  if (pm === 'dnf') return 'sudo ' + dnfCommand(tool);
  return '';
}

function wingetCommand(tool: ToolName): string {
  const id =
    tool === 'ffmpeg' ? 'Gyan.FFmpeg' : tool === 'mpv' ? 'mpv.net' : 'VideoLAN.VLC';
  return `winget install -e --id ${id}`;
}

function brewCommand(tool: ToolName): string {
  if (tool === 'ffmpeg') return 'brew install ffmpeg';
  return `brew install --cask ${tool}`;
}

function aptCommand(tool: ToolName): string {
  return `apt-get install -y ${tool}`;
}

function dnfCommand(tool: ToolName): string {
  return `dnf install -y ${tool}`;
}

// One frame of the install SSE stream. `event: log` carries a single line
// of combined stdout/stderr; `event: done` closes the stream with either
// "success" or "error".
export type InstallEvent =
  | { event: 'log'; data: string }
  | { event: 'done'; data: 'success' | 'error' };

// installTool consumes the /api/install SSE stream and yields one frame at
// a time. Cancellation: pass a signal in the AbortController and call
// `abort()` on it — the underlying fetch+reader cleans up cleanly.
export async function* installTool(
  tool: ToolName,
  signal?: AbortSignal,
): AsyncGenerator<InstallEvent, void, void> {
  const res = await fetch('/api/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool }),
    signal,
  });
  if (!res.ok || !res.body) {
    const msg = await readErrorMessage(res, `install failed (${res.status})`);
    throw new ApiError(msg, res.status);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by a blank line. Yield each complete one;
      // anything after the last \n\n stays in `buffer` for the next read.
      let sep = buffer.indexOf('\n\n');
      while (sep !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const evt = parseSSEBlock(block);
        if (evt) yield evt;
        sep = buffer.indexOf('\n\n');
      }
    }
    // Drain whatever remains in the buffer if the stream ended without a
    // trailing blank line.
    if (buffer.trim()) {
      const evt = parseSSEBlock(buffer);
      if (evt) yield evt;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

function parseSSEBlock(block: string): InstallEvent | null {
  let event = '';
  const dataLines: string[] = [];
  for (const raw of block.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line) continue;
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      // SSE data lines drop one leading space if present.
      const v = line.slice(5);
      dataLines.push(v.startsWith(' ') ? v.slice(1) : v);
    }
  }
  const data = dataLines.join('\n');
  if (event === 'log') return { event: 'log', data };
  if (event === 'done') {
    const d = data === 'success' ? 'success' : 'error';
    return { event: 'done', data: d };
  }
  return null;
}

// Settings: persisted user-editable config. Today this is just the
// downloads folder; future fields (port, language, sources) land in the
// same shape.
export type Settings = {
  downloadsDir: string;
  configPath: string;
  free: number;
  total: number;
  activeTorrents: number;
  canPickFolder: boolean;
  adult: boolean;
  /**
   * lanAccess: when true, the backend binds to 0.0.0.0 instead of
   * localhost so TVs / phones / other LAN devices can reach the SPA.
   * Toggle requires an app restart to apply (the http.Server is bound
   * once at startup).
   */
  lanAccess: boolean;
  /**
   * tvMode: tweaks the SPA layout for D-pad navigation on smart TVs —
   * larger focus rings, conservative <video preload>, autofocus on
   * first card. Pure-frontend; takes effect immediately, no restart.
   */
  tvMode: boolean;
  /**
   * lanUrls: every reachable http://<ip>:<port>/ URL the user can type
   * on their TV browser. Empty when lanAccess is false. Computed
   * server-side from network interfaces so the user doesn't have to
   * dig in `ipconfig` themselves.
   */
  lanUrls: string[];
};

export async function getSettings(signal?: AbortSignal): Promise<Settings> {
  const res = await fetch('/api/settings', { signal });
  if (!res.ok) {
    const msg = await readErrorMessage(res, `settings: ${res.status}`);
    throw new ApiError(msg, res.status);
  }
  const data = (await res.json()) as Partial<Settings>;
  return {
    downloadsDir: typeof data.downloadsDir === 'string' ? data.downloadsDir : '',
    configPath: typeof data.configPath === 'string' ? data.configPath : '',
    free: typeof data.free === 'number' ? data.free : 0,
    total: typeof data.total === 'number' ? data.total : 0,
    activeTorrents: typeof data.activeTorrents === 'number' ? data.activeTorrents : 0,
    canPickFolder: Boolean(data.canPickFolder),
    adult: Boolean(data.adult),
    lanAccess: Boolean(data.lanAccess),
    tvMode: Boolean(data.tvMode),
    lanUrls: Array.isArray(data.lanUrls) ? (data.lanUrls as string[]).filter((u) => typeof u === 'string') : [],
  };
}

// updateSettings posts a partial update. Pass only the fields you want to
// change — undefined keys are left untouched on the server. Throws
// ApiError(409) when active torrents prevent a downloadsDir swap.
export async function updateSettings(
  patch: { downloadsDir?: string; adult?: boolean; lanAccess?: boolean; tvMode?: boolean },
): Promise<{ downloadsDir: string; adult: boolean; lanAccess: boolean; tvMode: boolean; warning?: string }> {
  const body: Record<string, unknown> = {};
  if (patch.downloadsDir !== undefined) body.downloadsDir = patch.downloadsDir;
  if (patch.adult !== undefined) body.adult = patch.adult;
  if (patch.lanAccess !== undefined) body.lanAccess = patch.lanAccess;
  if (patch.tvMode !== undefined) body.tvMode = patch.tvMode;
  const res = await fetch('/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const msg = await readErrorMessage(res, `Could not save settings (${res.status})`);
    throw new ApiError(msg, res.status);
  }
  const data = (await res.json()) as {
    downloadsDir?: string;
    adult?: boolean;
    lanAccess?: boolean;
    tvMode?: boolean;
    warning?: string;
  };
  return {
    downloadsDir: typeof data.downloadsDir === 'string' ? data.downloadsDir : (patch.downloadsDir ?? ''),
    adult: typeof data.adult === 'boolean' ? data.adult : Boolean(patch.adult),
    lanAccess: typeof data.lanAccess === 'boolean' ? data.lanAccess : Boolean(patch.lanAccess),
    tvMode: typeof data.tvMode === 'boolean' ? data.tvMode : Boolean(patch.tvMode),
    warning: typeof data.warning === 'string' ? data.warning : undefined,
  };
}

// pickFolder asks the backend to spawn an OS-native folder picker. Returns
// the chosen path, or null if the user cancelled. Throws on transport or
// platform errors (e.g., running on Linux where we don't have a picker).
export async function pickFolder(): Promise<string | null> {
  const res = await fetch('/api/folder-picker', { method: 'POST' });
  if (res.status === 204) return null;
  if (!res.ok) {
    const msg = await readErrorMessage(res, `Could not open folder picker (${res.status})`);
    throw new ApiError(msg, res.status);
  }
  const data = (await res.json()) as { path?: string };
  return typeof data.path === 'string' && data.path.length > 0 ? data.path : null;
}

// CategoryDescriptor — wire shape returned by GET /api/categories.
export type CategoryDescriptor = {
  slug: string;
  label: string;
  rutorId: string;
};

// CategoryPage — wire shape returned by GET /api/category/{slug}?page=N.
// hasMore=false signals the end of the listing; nextPage echoes page+1 when
// hasMore=true (handy for the UI's loader state).
export type CategoryPage = {
  groups: Group[];
  page: number;
  hasMore: boolean;
};

// fetchCategories returns the list of browseable categories the backend
// knows about. Defensive parsing: anything that doesn't match the
// {slug, label, rutorId} string shape gets dropped silently so a stale
// server can't crash the menu.
export async function fetchCategories(signal?: AbortSignal): Promise<CategoryDescriptor[]> {
  const res = await fetch('/api/categories', { signal });
  if (!res.ok) {
    const msg = await readErrorMessage(res, `Could not load categories (${res.status})`);
    throw new ApiError(msg, res.status);
  }
  const data: unknown = await res.json();
  if (!Array.isArray(data)) return [];
  return data
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .filter(
      (c) =>
        typeof c.slug === 'string' &&
        typeof c.label === 'string' &&
        typeof c.rutorId === 'string',
    )
    .map((c) => ({
      slug: c.slug as string,
      label: c.label as string,
      rutorId: c.rutorId as string,
    }));
}

// fetchCategoryPage loads page N of the given category. Same defensive
// parsing as fetchFeatured/searchGroups: groups missing an `id` or `title`
// get filtered out so half-baked entries don't render as broken cards.
export async function fetchCategoryPage(
  slug: string,
  page: number,
  signal?: AbortSignal,
): Promise<CategoryPage> {
  const res = await fetch(
    `/api/category/${encodeURIComponent(slug)}?page=${page}`,
    { signal },
  );
  if (!res.ok) {
    const msg = await readErrorMessage(res, `Could not load category (${res.status})`);
    throw new ApiError(msg, res.status);
  }
  const data: unknown = await res.json();
  if (!data || typeof data !== 'object') {
    return { groups: [], page, hasMore: false };
  }
  const obj = data as Record<string, unknown>;
  const rawGroups = Array.isArray(obj.groups) ? obj.groups : [];
  const groups: Group[] = rawGroups
    .filter((g): g is Record<string, unknown> => !!g && typeof g === 'object')
    .filter((g) => typeof g.id === 'string' && typeof g.title === 'string')
    .map((g) => g as unknown as Group);
  return {
    groups,
    page: typeof obj.page === 'number' ? obj.page : page,
    hasMore: typeof obj.hasMore === 'boolean' ? obj.hasMore : false,
  };
}

// Metadata — wire shape from GET /api/metadata?title=X&year=N. Powered by
// TMDB. The backend returns 503 when TMDB_API_KEY isn't configured —
// callers should treat that as "feature disabled" and skip the section
// silently rather than surfacing an error.

export type Person = {
  name: string;
  character: string;
  photoUrl: string;       // possibly ""
};

export type MovieMetadata = {
  title: string;
  tagline: string;        // possibly ""
  overview: string;
  genres: string[];
  runtimeMin: number;
  voteAverage: number;
  year: number;
  status: string;         // english from TMDB ("Released", ...)
  countries: string[];    // RU names when language=ru-RU
  budget: number;         // 0 if unknown
  ageRating: string;      // e.g. "13+", "PG-13", "" if unknown
  imdbRating: number;     // OMDb 0..10, 0 if unknown
  imdbVotes: number;      // 0 if unknown
  kpRating: number;       // kinopoisk.dev 0..10, 0 if unknown
  kpVotes: number;        // 0 if unknown
  posterUrl: string;
  backdropUrl: string;
  trailerKey: string;     // YouTube id, "" if none
  imdbId: string;         // "tt..." or ""
  tmdbId: number;
  cast: Person[];         // top-15 by order, may be []
};

export async function fetchMovieMetadata(
  title: string,
  year: number,
  signal?: AbortSignal,
): Promise<MovieMetadata | null> {
  const params = `title=${encodeURIComponent(title)}` + (year > 0 ? `&year=${year}` : '');
  const res = await fetch(`/api/metadata?${params}`, { signal });
  // 503 = TMDB feature disabled (no API key). 404 = not found in TMDB.
  // Both collapse to null so callers can hide the section silently.
  if (res.status === 503 || res.status === 404) return null;
  if (!res.ok) {
    const msg = await readErrorMessage(res, `Could not load metadata (${res.status})`);
    throw new ApiError(msg, res.status);
  }
  const data: unknown = await res.json();
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;
  const rawGenres = Array.isArray(obj.genres) ? obj.genres : [];
  const genres: string[] = rawGenres.filter((g): g is string => typeof g === 'string');
  const rawCountries = Array.isArray(obj.countries) ? obj.countries : [];
  const countries: string[] = rawCountries.filter((c): c is string => typeof c === 'string');
  const rawCast = Array.isArray(obj.cast) ? obj.cast : [];
  const cast: Person[] = rawCast
    .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
    .filter((p) => typeof p.name === 'string' && p.name.length > 0)
    .map((p) => ({
      name: p.name as string,
      character: typeof p.character === 'string' ? p.character : '',
      photoUrl: typeof p.photoUrl === 'string' ? p.photoUrl : '',
    }));
  return {
    title: typeof obj.title === 'string' ? obj.title : '',
    tagline: typeof obj.tagline === 'string' ? obj.tagline : '',
    overview: typeof obj.overview === 'string' ? obj.overview : '',
    genres,
    runtimeMin: typeof obj.runtimeMin === 'number' ? obj.runtimeMin : 0,
    voteAverage: typeof obj.voteAverage === 'number' ? obj.voteAverage : 0,
    year: typeof obj.year === 'number' ? obj.year : 0,
    status: typeof obj.status === 'string' ? obj.status : '',
    countries,
    budget: typeof obj.budget === 'number' ? obj.budget : 0,
    ageRating: typeof obj.ageRating === 'string' ? obj.ageRating : '',
    imdbRating: typeof obj.imdbRating === 'number' ? obj.imdbRating : 0,
    imdbVotes: typeof obj.imdbVotes === 'number' ? obj.imdbVotes : 0,
    kpRating: typeof obj.kpRating === 'number' ? obj.kpRating : 0,
    kpVotes: typeof obj.kpVotes === 'number' ? obj.kpVotes : 0,
    posterUrl: typeof obj.posterUrl === 'string' ? obj.posterUrl : '',
    backdropUrl: typeof obj.backdropUrl === 'string' ? obj.backdropUrl : '',
    trailerKey: typeof obj.trailerKey === 'string' ? obj.trailerKey : '',
    imdbId: typeof obj.imdbId === 'string' ? obj.imdbId : '',
    tmdbId: typeof obj.tmdbId === 'number' ? obj.tmdbId : 0,
    cast,
  };
}

// ── Userdata ──────────────────────────────────────────────────────────────────
// Local per-movie state: reactions, bookmarks, watch progress.
// Endpoints live at /api/userdata/movie/{movieId}/...
// A 404 or 503 response means "not stored yet" / "feature off" — treat as
// the zero-state default and never surface an error to the UI.

export type Reaction = 'fire' | 'like' | 'meh' | 'wow' | 'poop';

export type UserdataMovieState = {
  myReaction: Reaction | null;
  bookmarked: boolean;
  lastWatched: { atSec: number; when: string } | null;
};

const USERDATA_DEFAULT: UserdataMovieState = {
  myReaction: null,
  bookmarked: false,
  lastWatched: null,
};

function isReaction(v: unknown): v is Reaction {
  return v === 'fire' || v === 'like' || v === 'meh' || v === 'wow' || v === 'poop';
}

export async function getUserdataMovie(
  movieId: string,
  signal?: AbortSignal,
): Promise<UserdataMovieState> {
  try {
    const res = await fetch(`/api/userdata/movie/${encodeURIComponent(movieId)}`, { signal });
    if (res.status === 404 || res.status === 503) return USERDATA_DEFAULT;
    if (!res.ok) return USERDATA_DEFAULT;
    const data: unknown = await res.json();
    if (!data || typeof data !== 'object') return USERDATA_DEFAULT;
    const obj = data as Record<string, unknown>;
    const rawLw = obj.lastWatched;
    let lastWatched: UserdataMovieState['lastWatched'] = null;
    if (rawLw && typeof rawLw === 'object') {
      const lw = rawLw as Record<string, unknown>;
      if (typeof lw.atSec === 'number' && typeof lw.when === 'string') {
        lastWatched = { atSec: lw.atSec, when: lw.when };
      }
    }
    return {
      myReaction: isReaction(obj.myReaction) ? obj.myReaction : null,
      bookmarked: typeof obj.bookmarked === 'boolean' ? obj.bookmarked : false,
      lastWatched,
    };
  } catch {
    return USERDATA_DEFAULT;
  }
}

export async function setReaction(movieId: string, emoji: Reaction | null): Promise<void> {
  const res = await fetch(`/api/userdata/movie/${encodeURIComponent(movieId)}/react`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emoji }),
  });
  if (!res.ok && res.status !== 204) {
    const msg = await readErrorMessage(res, `Could not save reaction (${res.status})`);
    throw new ApiError(msg, res.status);
  }
}

export async function setBookmark(
  movieId: string,
  on: boolean,
  snapshot?: { title: string; posterUrl: string; year: number },
): Promise<void> {
  const res = await fetch(`/api/userdata/movie/${encodeURIComponent(movieId)}/bookmark`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ on, ...snapshot }),
  });
  if (!res.ok && res.status !== 204) {
    const msg = await readErrorMessage(res, `Could not save bookmark (${res.status})`);
    throw new ApiError(msg, res.status);
  }
}

export async function saveProgress(
  movieId: string,
  atSec: number,
  snapshot?: { title: string; posterUrl: string; year: number },
): Promise<void> {
  const res = await fetch(`/api/userdata/movie/${encodeURIComponent(movieId)}/progress`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ atSec, ...snapshot }),
  });
  if (!res.ok && res.status !== 204) {
    const msg = await readErrorMessage(res, `Could not save progress (${res.status})`);
    throw new ApiError(msg, res.status);
  }
}
