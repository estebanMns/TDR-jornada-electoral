import { DetalleCaso } from '@/features/verificacion/componentes/DetalleCaso';

export default async function PaginaCaso({ params }) {
  const { acta } = await params;
  return <DetalleCaso acta={decodeURIComponent(acta)} />;
}
