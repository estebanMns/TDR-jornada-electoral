import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { OpsPoint } from '../opsSeries';

const compactFormat = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 });
const compact = (value: number) => compactFormat.format(value);

/** Small uPlot line chart (only loaded by the /ops route). */
export function TimeSeriesChart({
  title,
  unit,
  points,
  read,
  color,
}: {
  title: string;
  unit: string;
  points: OpsPoint[];
  read: (point: OpsPoint) => number;
  color: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<uPlot | null>(null);

  useEffect(() => {
    const element = container.current!;
    chart.current = new uPlot(
      {
        width: element.clientWidth,
        height: 160,
        legend: { show: false },
        scales: { x: { time: true } },
        axes: [
          { stroke: '#8a94a6' },
          { stroke: '#8a94a6', size: 56, values: (_u, ticks) => ticks.map(compact) },
        ],
        series: [{}, { label: title, stroke: color, width: 2, fill: `${color}22` }],
      },
      [[], []],
      element,
    );
    const resize = new ResizeObserver(() => chart.current?.setSize({ width: element.clientWidth, height: 160 }));
    resize.observe(element);
    return () => {
      resize.disconnect();
      chart.current?.destroy();
    };
  }, [title, color]);

  useEffect(() => {
    chart.current?.setData([points.map((p) => p.ts / 1_000), points.map(read)]);
  }, [points, read]);

  const last = points.at(-1);
  return (
    <figure>
      <figcaption className="flex items-baseline justify-between text-sm">
        <span className="font-medium">{title}</span>
        <span className="tabular-nums text-ink-soft">
          {last ? `${read(last).toLocaleString('es-CO', { maximumFractionDigits: 1 })} ${unit}` : '—'}
        </span>
      </figcaption>
      <div ref={container} className="mt-2 w-full" />
    </figure>
  );
}
