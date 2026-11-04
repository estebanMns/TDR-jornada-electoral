import { lazy } from 'react';
import { NavLink, Outlet, Route, Routes } from 'react-router';
import { getSession, logout } from '../../app/session';
import { NetworkBanner } from './components/NetworkBanner';
import { Marca } from '../../shared/ui/Marca';

const ActaFormPage = lazy(() => import('./pages/ActaFormPage'));
const SubmissionsPage = lazy(() => import('./pages/SubmissionsPage'));

const tabClass = ({ isActive }: { isActive: boolean }) =>
  `flex-1 rounded-lg py-2 text-center text-sm font-semibold transition ${isActive ? 'bg-hoja text-tinta shadow-sm' : 'text-tinta-suave'}`;

function JurorLayout() {
  const user = getSession()?.user;
  return (
    <div className="min-h-dvh">
      <NetworkBanner />
      <header className="border-b border-rejilla bg-hoja">
        <div className="mx-auto flex max-w-lg items-center gap-3 px-4 py-2.5">
          <a href="/" aria-label="Mesa a Mesa, inicio">
            <Marca className="text-base" />
          </a>
          <nav aria-label="Principal" className="ml-auto flex items-center gap-1 text-sm font-medium">
            <a href="/resultados" className="rounded-lg px-2.5 py-1.5 text-tinta-suave hover:text-tinta">
              Resultados
            </a>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg border border-rejilla px-2.5 py-1.5 font-semibold hover:border-indeleble"
            >
              Salir
            </button>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-lg px-4 pt-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-tinta-suave">Jurado</p>
        <p className="font-display text-lg font-bold tracking-tight">{user?.name}</p>
      </div>
      <nav aria-label="Secciones del jurado" className="mx-4 mt-3 flex max-w-lg gap-1 rounded-xl bg-rejilla/60 p-1 sm:mx-auto">
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
