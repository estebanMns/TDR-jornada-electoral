/** Marca: una mesa (cuadro) entintada junto al nombre. */
export function Marca({ className = '', soloIconoEnMovil = false }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display text-lg font-bold tracking-tight ${className}`}>
      <span aria-hidden className="grid grid-cols-2 gap-[2px]">
        <i className="h-[7px] w-[7px] rounded-[1.5px] bg-indeleble" />
        <i className="h-[7px] w-[7px] rounded-[1.5px] bg-indeleble" />
        <i className="h-[7px] w-[7px] rounded-[1.5px] bg-indeleble" />
        <i className="h-[7px] w-[7px] rounded-[1.5px] bg-rejilla" />
      </span>
      <span className={soloIconoEnMovil ? 'sr-only sm:not-sr-only' : undefined}>Mesa a Mesa</span>
    </span>
  );
}
