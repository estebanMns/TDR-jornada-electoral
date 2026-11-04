import { accion } from '@/server/contenedorGlobal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = accion('auth', 'logout');
