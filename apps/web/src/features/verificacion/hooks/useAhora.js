'use client';

import { useEffect, useState } from 'react';

/** Hora actual que se actualiza cada `intervaloMs` (para "tiempo en cola", cuentas atrás…). */
export function useAhora(intervaloMs = 1_000) {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs]);
  return ahora;
}
