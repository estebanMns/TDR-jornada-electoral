import { lazy } from 'react';
import { NavLink, Outlet, Route, Routes } from 'react-router';
import { getSession } from '../../app/session';
import { NetworkBanner } from './components/NetworkBanner';

const ActaFormPage = lazy(() => import('./pages/ActaFormPage'));
const SubmissionsPage = lazy(() => import('./pages/SubmissionsPage'));

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `flex-1 rounded-lg py-2 text-center text-sm font-medium ${isActive ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`;

function JurorLayout() {
  const user = getSession()?.user;
  return (
    <div className="min-h-dvh">
      <NetworkBanner />
      <header className="mx-auto flex max-w-lg items-center justify-between px-4 pt-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Preconteo · Jurado</p>
          <p className="font-semibold">{user?.name}</p>
        </div>
      </header>
      <nav className="mx-4 mt-3 flex max-w-lg gap-1 rounded-xl bg-slate-200/70 p-1 sm:mx-auto">
        <NavLink to="/jurado" end className={tabClass}>
          Acta
        </NavLink>
        <NavLink to="/jurado/envios" className={tabClass}>
          Envíos
        </NavLink>
      </nav>
      <main className="mx-auto max-w-lg p-4">
        <Outlet />
      </main>
    </div>
  );
}

/** Juror feature (owner: Jose): `/jurado` and `/jurado/envios`. */
export default function JurorRoutes() {
  return (
    <Routes>
      <Route element={<JurorLayout />}>
        <Route index element={<ActaFormPage />} />
        <Route path="envios" element={<SubmissionsPage />} />
      </Route>
    </Routes>
  );
}
