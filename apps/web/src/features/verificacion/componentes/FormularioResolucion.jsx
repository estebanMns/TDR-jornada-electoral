'use client';

import { useState } from 'react';
import { Decision } from '@preconteo/shared/schemas/verificacion';
import { cuadra } from '@preconteo/shared/reglaContable';
import { TablaVotos } from './TablaVotos';
import { Boton } from './ui';

const OPCIONES = [
  { valor: Decision.APROBAR, etiqueta: 'Aprobar' },
  { valor: Decision.APROBAR_CON_CORRECCION, etiqueta: 'Aprobar con corrección' },
  { valor: Decision.RECHAZAR, etiqueta: 'Rechazar' },
];

/**
 * Las tres decisiones del auditor. La validación del cliente es solo de ayuda:
 * el servidor vuelve a validar (regla contable, token, fencing).
 */
export function FormularioResolucion({ caso, deshabilitado, onResolver, onSoltar }) {
  const [decision, setDecision] = useState(Decision.APROBAR);
  const [votos, setVotos] = useState(caso.votos);
  const [sufragantes, setSufragantes] = useState(caso.sufragantes);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

  const corrigiendo = decision === Decision.APROBAR_CON_CORRECCION;
  const valido =
    decision === Decision.APROBAR ||
    (corrigiendo && cuadra(votos, sufragantes)) ||
    (decision === Decision.RECHAZAR && motivo.trim().length > 0);

  async function enviar(evento) {
    evento.preventDefault();
    setEnviando(true);
    const datos =
      decision === Decision.APROBAR_CON_CORRECCION
        ? { decision, votos, sufragantes, motivo: motivo || undefined }
        : decision === Decision.RECHAZAR
          ? { decision, motivo: motivo.trim() }
          : { decision, motivo: motivo || undefined };
    try {
      await onResolver(datos);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="space-y-4">
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-2 text-sm font-medium">Decisión</legend>
        {OPCIONES.map(({ valor, etiqueta }) => (
          <label
            key={valor}
            className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${decision === valor ? 'border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900' : 'border-slate-300 dark:border-slate-700'}`}
          >
            <input
              type="radio"
              name="decision"
              value={valor}
              checked={decision === valor}
              onChange={() => setDecision(valor)}
              className="sr-only"
            />
            {etiqueta}
          </label>
        ))}
      </fieldset>

      <TablaVotos
        votos={corrigiendo ? votos : caso.votos}
        sufragantes={corrigiendo ? sufragantes : caso.sufragantes}
        habilitados={caso.habilitados}
        editable={corrigiendo}
        onCambiarVoto={(candidato, valor) => setVotos((v) => ({ ...v, [candidato]: valor }))}
        onCambiarSufragantes={setSufragantes}
      />

      <label className="block text-sm font-medium">
        {decision === Decision.RECHAZAR
          ? 'Motivo del rechazo (obligatorio)'
          : 'Observación (opcional)'}
        <textarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          maxLength={500}
          rows={2}
          className="mt-1 block w-full rounded-lg border border-slate-300 bg-transparent px-3 py-2 dark:border-slate-700"
        />
      </label>

      <div className="flex justify-between gap-2">
        <Boton
          type="button"
          variante="borde"
          onClick={onSoltar}
          disabled={deshabilitado || enviando}
        >
          Soltar caso
        </Boton>
        <Boton
          type="submit"
          variante={decision === Decision.RECHAZAR ? 'peligro' : 'exito'}
          disabled={deshabilitado || enviando || !valido}
        >
          {enviando ? 'Enviando…' : 'Confirmar decisión'}
        </Boton>
      </div>
    </form>
  );
}
