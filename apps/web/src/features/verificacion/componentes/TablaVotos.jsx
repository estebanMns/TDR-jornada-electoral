'use client';

import { sumarVotos } from '@preconteo/shared/reglaContable';

/**
 * Valores digitados frente a la regla contable. Descuadre en rojo.
 * En modo editable (aprobar con corrección) los valores se pueden cambiar.
 */
export function TablaVotos({
  votos,
  sufragantes,
  habilitados,
  editable = false,
  onCambiarVoto,
  onCambiarSufragantes,
}) {
  const total = sumarVotos(votos);
  const diferencia = total - sufragantes;
  const excede = sufragantes > habilitados;

  return (
    <table className="w-full text-sm">
      <tbody>
        {Object.entries(votos).map(([candidato, valor]) => (
          <tr key={candidato} className="border-b border-rejilla">
            <th scope="row" className="py-1.5 text-left font-normal">
              {candidato}
            </th>
            <td className="py-1.5 text-right tabular-nums">
              {editable ? (
                <EntradaNumero
                  valor={valor}
                  onCambio={(v) => onCambiarVoto(candidato, v)}
                  etiqueta={candidato}
                />
              ) : (
                valor
              )}
            </td>
          </tr>
        ))}
        <tr className="font-medium">
          <th scope="row" className="pt-3 text-left">
            Total votos
          </th>
          <td className={`pt-3 text-right tabular-nums ${diferencia !== 0 ? 'text-red-600' : ''}`}>
            {total}
          </td>
        </tr>
        <tr className="font-medium">
          <th scope="row" className="text-left">
            Sufragantes
          </th>
          <td className={`text-right tabular-nums ${excede ? 'text-red-600' : ''}`}>
            {editable ? (
              <EntradaNumero
                valor={sufragantes}
                onCambio={onCambiarSufragantes}
                etiqueta="Sufragantes"
              />
            ) : (
              sufragantes
            )}
          </td>
        </tr>
        <tr className="text-tinta-suave">
          <th scope="row" className="text-left font-normal">
            Habilitados
          </th>
          <td className="text-right tabular-nums">{habilitados}</td>
        </tr>
      </tbody>
      <caption className="caption-bottom pt-3 text-left">
        {diferencia === 0 ? (
          <span className="text-registrada">Cuadra con la regla contable.</span>
        ) : (
          <span className="font-medium text-red-600">
            Descuadre: {diferencia > 0 ? `sobran ${diferencia}` : `faltan ${-diferencia}`} votos.
          </span>
        )}
        {excede && (
          <span className="block text-red-600">Sufragantes superan a los habilitados.</span>
        )}
      </caption>
    </table>
  );
}

function EntradaNumero({ valor, onCambio, etiqueta }) {
  return (
    <input
      type="number"
      min={0}
      inputMode="numeric"
      aria-label={etiqueta}
      value={valor}
      onChange={(e) => onCambio(Math.max(0, Number.parseInt(e.target.value || '0', 10)))}
      className="w-20 rounded-md border border-rejilla bg-transparent px-2 py-1 text-right"
    />
  );
}
