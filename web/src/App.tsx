import { Route, Routes } from 'react-router-dom';
import SearchPage from './pages/SearchPage';
import MoviePage from './pages/MoviePage';
import PlayerPage from './pages/PlayerPage';
import NotFound from './pages/NotFound';
import { DownloadStrip } from './components/DownloadStrip';

export default function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<SearchPage />} />
        <Route path="/movie/:groupId" element={<MoviePage />} />
        <Route path="/play/:torrentId" element={<PlayerPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <DownloadStrip />
    </>
  );
}
