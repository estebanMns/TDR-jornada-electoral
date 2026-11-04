import { Route, Routes } from 'react-router';
import ResultsPage from './ResultsPage';

/** Public routes (no login). Loaded lazily from App.tsx. */
export default function PublicRoutes() {
  return (
    <Routes>
      <Route index element={<ResultsPage />} />
      <Route path=":level/:id" element={<ResultsPage />} />
    </Routes>
  );
}
