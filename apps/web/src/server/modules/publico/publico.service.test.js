import { describe, expect, it, vi } from 'vitest';
import { TopicRegistry } from './topic-registry.js';

describe('TopicRegistry',()=>{
  it('mantiene índice bidireccional y elimina en O(topics de conexión)',()=>{
    const r=new TopicRegistry(), a={}, b={};
    r.add('dep',a);r.add('mun:11',a);r.add('dep',b);
    expect(r.count('dep')).toBe(2);
    r.removeConnection(a);
    expect(r.count('dep')).toBe(1);
    expect(r.count('mun:11')).toBe(0);
  });
  it('no duplica suscriptores',()=>{
    const r=new TopicRegistry(), a={};
    expect(r.add('dep',a)).toBe(true);
    expect(r.add('dep',a)).toBe(false);
    expect(r.count('dep')).toBe(1);
  });
});
