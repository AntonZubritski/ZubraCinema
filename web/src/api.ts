export type GroupTorrent = {
  id: string;
  title: string;
  size: number;
  seeders: number;
  leechers: number;
  quality: string | null;
  source: string;
  magnet: string;
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
  peers: number;
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

export async function startTorrent(
  magnet: string,
  mode: TorrentMode = 'stream',
): Promise<TorrentSession> {
  const res = await fetch('/api/torrents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ magnet, mode }),
  });
  if (res.status === 504) {
    throw new ApiError('Metadata fetch timed out — try a torrent with more seeders', 504);
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
  const res = await fetch(
    `/api/torrents/${encodeURIComponent(id)}?deleteFiles=${deleteFiles ? 'true' : 'false'}`,
    { method: 'DELETE' },
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
export function transcodeUrl(torrentId: string, fileIdx: number): string {
  return `/api/torrents/${encodeURIComponent(torrentId)}/transcode/${fileIdx}`;
}

export type Capabilities = {
  ffmpeg: boolean;
};

export async function getCapabilities(signal?: AbortSignal): Promise<Capabilities> {
  const res = await fetch('/api/capabilities', { signal });
  if (!res.ok) {
    throw new ApiError(`capabilities: ${res.status}`, res.status);
  }
  const data: unknown = await res.json();
  if (data && typeof data === 'object' && 'ffmpeg' in data) {
    return { ffmpeg: Boolean((data as { ffmpeg: unknown }).ffmpeg) };
  }
  return { ffmpeg: false };
}
