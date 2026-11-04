/**
 * Bootstrap app shell (owner: Meneses). Routes are lazy so the public page
 * stays light (RT-9); each feature registers its own subtree.
 */
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { RequireRole } from './RequireRole';
import { adoptDevTokenFromUrl } from './session';

const JurorRoutes = lazy(() => import('../features/jurado/JurorRoutes'));

adoptDevTokenFromUrl();

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<p className="p-6 text-slate-500">Cargando…</p>}>
        <Routes>
          <Route path="/" element={<Navigate to="/jurado" replace />} />
          <Route
            path="/jurado/*"
            element={
              <RequireRole roles={['JUROR']}>
                <JurorRoutes />
              </RequireRole>
            }
          />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
