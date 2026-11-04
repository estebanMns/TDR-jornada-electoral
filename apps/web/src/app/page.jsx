import Link from 'next/link';
import { AvanceEnVivo } from '@/features/inicio/AvanceEnVivo';
import { BarraPublica, Marca, Rotulo } from '@/shared/ui';

export const metadata = { title: { absolute: 'Mesa a Mesa · Preconteo electoral en tiempo real' } };

const RECORRIDO = [
  {
    titulo: 'El jurado transmite el acta',
    texto:
      'Al cerrar la mesa fotografía el acta E-14 y digita los votos. Si no hay señal, el acta queda guardada en el teléfono y se envía sola cuando vuelve la red.',
  },
  {
    titulo: 'Se suma una sola vez',
    texto:
      'Si el jurado reenvía porque no vio la confirmación, el sistema reconoce el envío y no lo vuelve a sumar. Mesa, puesto, municipio y departamento se actualizan juntos.',
  },
  {
    titulo: 'Si no cuadra, la revisa una persona',
    texto:
      'Cuando los votos no suman lo que dice el acta, pasa a una cola de verificación. Un auditor la toma —nadie más puede tocarla— y la aprueba, la corrige o la devuelve.',
  },
  {
    titulo: 'Llega a todos al mismo tiempo',
    texto:
      'Cada dos segundos sale una actualización para quien mira ese municipio o puesto. Si un número baja, la pantalla dice por qué.',
  },
];

const ACCESOS = [
  { quien: 'Ciudadanía', que: 'Resultados en vivo por departamento, municipio y puesto. Sin registro.', ruta: '/resultados', accion: 'Ver resultados' },
  { quien: 'Jurados', que: 'Transmitir el acta de su mesa y confirmar que quedó registrada.', ruta: '/jurado/', accion: 'Transmitir un acta' },
  { quien: 'Auditores', que: 'Revisar las actas que no cuadran, una a la vez y sin choques.', ruta: '/verificacion', accion: 'Abrir la cola' },
  { quien: 'Coordinación', que: 'Ver quién está conectado, qué caso revisa y desde hace cuánto.', ruta: '/coordinacion', accion: 'Ver el equipo' },
  { quien: 'Operación', que: 'Conexiones, mensajes y salud de las 8 instancias del servidor.', ruta: '/ops', accion: 'Ver el tablero' },
];

export default function Inicio() {
  return (
    <>
      <BarraPublica />

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-6 lg:grid-cols-[1.05fr_1fr] lg:pt-12">
          <div>
            <Rotulo>Preconteo departamental · Valle Central</Rotulo>
            <h1 className="mt-4 font-display text-[2.6rem] font-bold leading-[1.02] tracking-tight sm:text-6xl">
              Cada mesa que informa aparece aquí en segundos.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-tinta-suave">
              Mesa a Mesa recibe las actas que transmiten los jurados al cerrar las urnas, las suma una sola vez y
              publica el avance por departamento, municipio y puesto de votación.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/resultados"
                className="rounded-xl bg-indeleble px-5 py-3 font-semibold text-white transition hover:brightness-110 dark:text-papel"
              >
                Ver resultados en vivo
              </Link>
              <Link
                href="/login"
                className="rounded-xl border border-rejilla bg-hoja px-5 py-3 font-semibold transition hover:border-indeleble"
              >
                Ingresar como jurado o auditor
              </Link>
            </div>
            <p className="mt-6 max-w-xl text-sm text-tinta-suave">
              Es un preconteo informativo. El resultado oficial sale del escrutinio de las actas físicas en los días
              siguientes.
            </p>
          </div>
          <AvanceEnVivo />
        </section>

        <section id="como-funciona" className="scroll-mt-16 border-y border-rejilla bg-hoja">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <Rotulo>Cómo funciona</Rotulo>
            <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight sm:text-4xl">
              El recorrido de un acta, de la mesa a tu pantalla
            </h2>
            <ol className="mt-10 grid gap-px overflow-hidden rounded-xl border border-rejilla bg-rejilla sm:grid-cols-2 lg:grid-cols-4">
              {RECORRIDO.map(({ titulo, texto }, i) => (
                <li key={titulo} className="bg-hoja p-6">
                  <span className="font-mono text-sm font-semibold text-indeleble">Paso {i + 1}</span>
                  <h3 className="mt-3 font-display text-xl font-bold tracking-tight">{titulo}</h3>
                  <p className="mt-2 leading-relaxed text-tinta-suave">{texto}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 py-16">
          <Rotulo>Quién lo usa</Rotulo>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight sm:text-4xl">Una entrada para cada papel</h2>
          <ul className="mt-8 divide-y divide-rejilla rounded-xl border border-rejilla bg-hoja">
            {ACCESOS.map(({ quien, que, ruta, accion }) => (
              <li key={quien} className="grid gap-2 p-5 sm:grid-cols-[11rem_1fr_auto] sm:items-center sm:gap-6">
                <p className="font-display text-lg font-bold">{quien}</p>
                <p className="text-tinta-suave">{que}</p>
                <Link href={ruta} className="font-medium text-indeleble underline-offset-4 hover:underline">
                  {accion} →
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-tinta-suave">
            Jurados, auditores, coordinación y operación entran con el usuario que se les asigna.
          </p>
        </section>
      </main>

      <footer className="border-t border-rejilla">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-sm text-tinta-suave">
          <Marca className="text-base text-tinta" />
          <p>Proyecto académico · Programación orientada a la web · Ingeniería de Software</p>
        </div>
      </footer>
    </>
  );
}
