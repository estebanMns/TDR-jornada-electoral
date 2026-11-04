import { TONE_CLASSES, type StatusView } from '../status';

export function StatusChip({ view }: { view: StatusView }) {
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ring-1 ${TONE_CLASSES[view.tone]}`}>
      {view.label}
    </span>
  );
}
