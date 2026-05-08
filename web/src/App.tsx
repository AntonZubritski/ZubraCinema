import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import SearchPage from './pages/SearchPage';
import MoviePage from './pages/MoviePage';
import PlayerPage from './pages/PlayerPage';
import CategoryPage from './pages/CategoryPage';
import NotFound from './pages/NotFound';
import { DownloadStrip } from './components/DownloadStrip';
import { getSettings } from './api';

export default function App() {
  // Mirror the saved `tvMode` flag onto <body> as a class so the CSS
  // rules in index.css (larger fonts, beefier focus rings) take effect
  // app-wide. Re-checks every minute in case the user toggled the
  // setting in another tab — too cheap to bother with a real event bus.
  useEffect(() => {
    let cancelled = false;
    const apply = async () => {
      try {
        const s = await getSettings();
        if (cancelled) return;
        document.body.classList.toggle('tv-mode', s.tvMode);
      } catch {
        // best-effort — settings unavailable means we just leave the
        // body class unset (default desktop UX).
      }
    };
    void apply();
    const id = window.setInterval(() => void apply(), 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return (
    <>
      <Routes>
        <Route path="/" element={<SearchPage />} />
        <Route path="/category/:slug" element={<CategoryPage />} />
        <Route path="/movie/:groupId" element={<MoviePage />} />
        <Route path="/play/:torrentId" element={<PlayerPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <DownloadStrip />
    </>
  );
}
