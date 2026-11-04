import { Suspense } from 'react';
import ResultadosPage from '../../features/publico/ResultadosPage';
export default function Page() { return <Suspense fallback={<p className="p-6">Cargando resultados…</p>}><ResultadosPage /></Suspense>; }
