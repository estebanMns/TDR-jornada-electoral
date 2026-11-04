import { describe, expect, it } from 'vitest';
import { backoffDelay } from './backoff';
describe('backoff full jitter',()=>{
  it('calcula random(0, min(30s, 500ms*2^n))',()=>{
    expect(backoffDelay(3,()=>.5)).toBe(2000);
    expect(backoffDelay(20,()=>1)).toBe(30000);
    expect(backoffDelay(0,()=>0)).toBe(0);
  });
});
