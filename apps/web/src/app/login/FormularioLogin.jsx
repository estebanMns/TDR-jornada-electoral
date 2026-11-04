'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { destinoSeguro } from '@/app/auth/rutasProtegidas';

const MENSAJES = {
  CREDENCIALES_INVALIDAS: 'Usuario o contraseña incorrectos.',
  RATE_LIMIT: 'Demasiados intentos. Espera un momento.',
  REDIS_NO_DISPONIBLE: 'El servicio está degradado. Intenta de nuevo en unos segundos.',
  AUTENTICACION_NO_DISPONIBLE:
    'No se pudo verificar el usuario. Intenta de nuevo en unos segundos.',
};

export function FormularioLogin({ siguiente }) {
  const router = useRouter();
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function ingresar(evento) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);
    const datos = Object.fromEntries(new FormData(evento.currentTarget));
    try {
      const respuesta = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(datos),
      });
      const cuerpo = await respuesta.json();
      if (!respuesta.ok) {
        const extra = cuerpo.reintentarEn ? ` (${cuerpo.reintentarEn} s)` : '';
        setError((MENSAJES[cuerpo.error] ?? 'No se pudo ingresar.') + extra);
        return;
      }
      router.replace(destinoSeguro(siguiente, cuerpo.usuario.rol));
      router.refresh();
    } catch {
      setError('Sin conexión con el servidor.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={ingresar} className="mt-6 space-y-4">
      <Campo etiqueta="Usuario" name="username" autoComplete="username" />
      <Campo
        etiqueta="Contraseña"
        name="password"
        type="password"
        autoComplete="current-password"
      />
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
        >
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={enviando}
        className="w-full rounded-xl bg-indeleble px-4 py-3 font-semibold text-white transition hover:brightness-110 disabled:opacity-60 dark:text-papel"
      >
        {enviando ? 'Ingresando…' : 'Ingresar'}
      </button>
    </form>
  );
}

function Campo({ etiqueta, ...props }) {
  return (
    <label className="block text-sm font-medium">
      {etiqueta}
      <input
        required
        className="mt-1.5 block w-full rounded-lg border border-rejilla bg-papel px-3 py-2.5 outline-none focus:border-indeleble focus:ring-2 focus:ring-indeleble/20"
        {...props}
      />
    </label>
  );
}
