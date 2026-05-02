export type Magnet = {
  quality: string;
  url: string;
};

export type Movie = {
  title: string;
  year: number;
  rating: number;
  coverUrl: string;
  magnets: Magnet[];
};

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function searchMovies(query: string, signal?: AbortSignal): Promise<Movie[]> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal });
  if (!res.ok) {
    throw new ApiError(`Search failed (${res.status})`, res.status);
  }
  const data = (await res.json()) as Movie[];
  return Array.isArray(data) ? data : [];
}

export async function playMagnet(magnet: string): Promise<void> {
  const res = await fetch('/api/play', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ magnet }),
  });
  if (!res.ok && res.status !== 204) {
    throw new ApiError(`Could not start player (${res.status})`, res.status);
  }
}
