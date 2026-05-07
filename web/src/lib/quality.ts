import type { Group } from '../api';

// Streamability — predicted in-browser playback quality based on swarm
// health. We pick the MAX seeder count across torrents in the group (the
// user gets to pick the best one) rather than summing — a 100-seeder
// release plus four dead releases is still a great group.
//
// Thresholds tuned for 1080p H.264 (5-12 Mbps ≈ 0.6-1.5 MB/s sustained):
//   good (≥30 peers) → typically saturates 1080p with headroom
//   ok   (≥5  peers) → scrapes by on 1080p, fine for 720p
//   poor (<5  peers) → noticeable buffering, may stall
export type Streamability = 'good' | 'ok' | 'poor';

const GOOD_THRESHOLD = 30;
const OK_THRESHOLD = 5;

export function maxSeedersInGroup(group: Group): number {
  let max = 0;
  for (const t of group.torrents) {
    if (t.seeders > max) max = t.seeders;
  }
  return max;
}

export function streamabilityOf(group: Group): Streamability {
  const peers = maxSeedersInGroup(group);
  if (peers >= GOOD_THRESHOLD) return 'good';
  if (peers >= OK_THRESHOLD) return 'ok';
  return 'poor';
}

// Score for sort comparators — higher is better.
export function streamabilityScore(s: Streamability): number {
  if (s === 'good') return 2;
  if (s === 'ok') return 1;
  return 0;
}

export const STREAMABILITY_LABELS: Record<Streamability, string> = {
  good: 'Хорошая раздача — стрим без проблем',
  ok: 'Раздача терпимая — может подтормаживать',
  poor: 'Слабая раздача — стрим может тормозить',
};
