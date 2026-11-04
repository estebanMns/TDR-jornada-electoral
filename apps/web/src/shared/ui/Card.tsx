import type { HTMLAttributes } from 'react';
import { cn } from './cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={cn('rounded-2xl border border-line bg-surface p-4 shadow-sm', className)} {...props} />;
}
