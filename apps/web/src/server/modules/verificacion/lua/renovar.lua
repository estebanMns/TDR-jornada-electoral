-- Renueva el lease solo si el lock sigue siendo de quien lo pide (compare-and-expire).
-- KEYS[1] lock:acta:{acta}   KEYS[2] verif:taken
-- ARGV[1] valor esperado "{sub}:{token}"  ARGV[2] ttl ms  ARGV[3] acta
-- Devuelve el `desde` (ms, texto) del caso tomado, o false si el lock ya no es suyo.

if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return false
end
redis.call('PEXPIRE', KEYS[1], ARGV[2])
local registro = redis.call('HGET', KEYS[2], ARGV[3])
if not registro then
  return '0'
end
return cjson.decode(registro).desde
