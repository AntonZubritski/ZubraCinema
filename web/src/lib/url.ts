import { ALL_LANGUAGES, type Language } from './lang';
import { ALL_QUALITIES, type QualityBucket, type SortKey } from './sortFilter';

export type ViewState = {
  q: string;
  sort: SortKey;
  langs: Language[];
  qualities: QualityBucket[];
};

const SORT_KEYS: SortKey[] = ['relevance', 'seeders', 'size', 'title', 'year'];

export const DEFAULT_STATE: ViewState = {
  q: '',
  sort: 'relevance',
  langs: [...ALL_LANGUAGES],
  qualities: [...ALL_QUALITIES],
};

function parseList<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (raw === null) return [...allowed];
  if (raw === '') return [];
  const allow = new Set<string>(allowed);
  const out: T[] = [];
  for (const piece of raw.split(',')) {
    const v = piece.trim().toLowerCase();
    if (allow.has(v)) out.push(v as T);
  }
  return out;
}

export function parseState(params: URLSearchParams): ViewState {
  const sortRaw = (params.get('sort') ?? '').toLowerCase();
  const sort: SortKey = (SORT_KEYS as string[]).includes(sortRaw)
    ? (sortRaw as SortKey)
    : DEFAULT_STATE.sort;
  return {
    q: params.get('q') ?? '',
    sort,
    langs: parseList(params.get('lang'), ALL_LANGUAGES),
    qualities: parseList(params.get('quality'), ALL_QUALITIES),
  };
}

function listEqualsAll<T extends string>(values: T[], allowed: readonly T[]): boolean {
  if (values.length !== allowed.length) return false;
  const set = new Set<string>(values);
  for (const a of allowed) if (!set.has(a)) return false;
  return true;
}

export function serializeState(state: ViewState): URLSearchParams {
  const out = new URLSearchParams();
  if (state.q.trim().length > 0) out.set('q', state.q.trim());
  if (state.sort !== DEFAULT_STATE.sort) out.set('sort', state.sort);
  if (!listEqualsAll(state.langs, ALL_LANGUAGES)) {
    out.set('lang', state.langs.join(','));
  }
  if (!listEqualsAll(state.qualities, ALL_QUALITIES)) {
    out.set('quality', state.qualities.join(','));
  }
  return out;
}
