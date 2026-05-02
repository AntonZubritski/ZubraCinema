import { ALL_LANGUAGES, LANG_LABELS, type Language } from '../lib/lang';
import {
  ALL_QUALITIES,
  QUALITY_LABELS,
  SORT_LABELS,
  type QualityBucket,
  type SortKey,
} from '../lib/sortFilter';

type Props = {
  sort: SortKey;
  langs: Language[];
  qualities: QualityBucket[];
  onSortChange: (s: SortKey) => void;
  onLangsChange: (l: Language[]) => void;
  onQualitiesChange: (q: QualityBucket[]) => void;
};

const SORT_KEYS: SortKey[] = ['relevance', 'seeders', 'size', 'title', 'year'];

function toggle<T>(values: T[], item: T, all: readonly T[]): T[] {
  const set = new Set(values);
  if (set.has(item)) {
    set.delete(item);
  } else {
    set.add(item);
  }
  // keep canonical order
  return all.filter((a) => set.has(a));
}

export function SortBar({
  sort,
  langs,
  qualities,
  onSortChange,
  onLangsChange,
  onQualitiesChange,
}: Props) {
  const langSet = new Set(langs);
  const allLangs = langSet.size === ALL_LANGUAGES.length;
  const qSet = new Set(qualities);
  const allQ = qSet.size === ALL_QUALITIES.length;

  return (
    <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex flex-col gap-3 min-w-0">
        <ChipGroup
          label="Язык"
          items={[
            { key: '__all', label: 'Все', active: allLangs },
            ...ALL_LANGUAGES.map((l) => ({
              key: l,
              label: LANG_LABELS[l],
              active: !allLangs && langSet.has(l),
            })),
          ]}
          onClick={(key) => {
            if (key === '__all') {
              onLangsChange([...ALL_LANGUAGES]);
              return;
            }
            const next = allLangs ? [key as Language] : toggle(langs, key as Language, ALL_LANGUAGES);
            onLangsChange(next.length === 0 ? [...ALL_LANGUAGES] : next);
          }}
        />
        <ChipGroup
          label="Качество"
          items={[
            { key: '__all', label: 'Все', active: allQ },
            ...ALL_QUALITIES.map((q) => ({
              key: q,
              label: QUALITY_LABELS[q],
              active: !allQ && qSet.has(q),
            })),
          ]}
          onClick={(key) => {
            if (key === '__all') {
              onQualitiesChange([...ALL_QUALITIES]);
              return;
            }
            const next = allQ
              ? [key as QualityBucket]
              : toggle(qualities, key as QualityBucket, ALL_QUALITIES);
            onQualitiesChange(next.length === 0 ? [...ALL_QUALITIES] : next);
          }}
        />
      </div>

      <div className="flex items-center gap-3 flex-shrink-0 self-start">
        <span className="text-bone-300/50 text-[10px] uppercase tracking-[0.25em]">Сортировка</span>
        <div className="relative">
          <select
            value={sort}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
            className="
              focus-ring
              appearance-none
              bg-ink-900/70 border border-ink-700/80
              hover:border-ember-300/40 focus:border-ember-300/60
              text-bone-50 text-xs uppercase tracking-[0.18em] font-medium
              pl-4 pr-9 py-2.5
              transition-colors
              cursor-pointer
            "
            style={{ borderRadius: 1 }}
          >
            {SORT_KEYS.map((k) => (
              <option key={k} value={k} className="bg-ink-900 text-bone-50 normal-case tracking-normal">
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-bone-300/60">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </span>
        </div>
      </div>
    </div>
  );
}

type ChipItem = { key: string; label: string; active: boolean };

function ChipGroup({
  label,
  items,
  onClick,
}: {
  label: string;
  items: ChipItem[];
  onClick: (key: string) => void;
}) {
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <span className="text-bone-300/50 text-[10px] uppercase tracking-[0.25em] flex-shrink-0">
        {label}
      </span>
      <div className="flex items-center gap-1.5 flex-wrap">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            onClick={() => onClick(it.key)}
            className={`
              focus-ring
              px-2.5 py-1
              text-[10px] uppercase tracking-[0.18em] font-medium
              border transition-colors
              ${it.active
                ? 'bg-ember-400/[0.15] border-ember-300/50 text-ember-100'
                : 'bg-ink-900/40 border-ink-700/70 text-bone-300/70 hover:border-ink-600 hover:text-bone-100'}
            `}
            style={{ borderRadius: 1 }}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}
