import { useEffect } from 'react';

export type ToastKind = 'info' | 'error';

export type ToastMessage = {
  id: number;
  kind: ToastKind;
  text: string;
};

type Props = {
  toast: ToastMessage | null;
  onDismiss: () => void;
};

export function Toast({ toast, onDismiss }: Props) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, toast.kind === 'error' ? 4500 : 3000);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;

  const isError = toast.kind === 'error';

  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[60] animate-rise-in">
      <div
        className={`
          flex items-center gap-3
          px-5 py-3
          bg-ink-900/95 backdrop-blur-md
          border ${isError ? 'border-ember-400/60' : 'border-ink-600'}
          shadow-xl shadow-black/40
        `}
        style={{ borderRadius: 2 }}
      >
        <span
          className={`
            inline-block w-1.5 h-1.5 rounded-full
            ${isError ? 'bg-ember-300' : 'bg-ember-300 animate-pulse'}
          `}
        />
        <span className="text-bone-50 text-sm tracking-wide">{toast.text}</span>
      </div>
    </div>
  );
}
