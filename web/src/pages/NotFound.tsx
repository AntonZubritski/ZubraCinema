import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="grain vignette min-h-screen relative">
      <div className="relative z-10 max-w-xl mx-auto px-8 py-32 text-center animate-fade-in">
        <p className="text-[11px] uppercase tracking-[0.35em] text-ember-300/70 mb-6">
          Lost in the dark
        </p>
        <h1 className="font-display text-5xl md:text-6xl text-bone-50 tracking-tightest leading-[1.05]">
          404
        </h1>
        <p className="font-display italic text-xl md:text-2xl text-bone-200/70 leading-relaxed tracking-tight mt-8">
          "This reel isn't on any shelf."
        </p>
        <Link
          to="/"
          className="
            focus-ring
            inline-flex items-center
            mt-10 px-6 py-3
            text-xs uppercase tracking-[0.18em] font-medium
            text-bone-50
            bg-ember-400 hover:bg-ember-300
            transition-colors
          "
          style={{ borderRadius: 1 }}
        >
          Back to search
        </Link>
      </div>
    </div>
  );
}
