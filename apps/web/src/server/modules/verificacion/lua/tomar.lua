-- Toma exclusiva de un caso (RF-7). Atómico: nadie puede intercalar comandos.
-- KEYS[1] verif:queue   KEYS[2] verif:taken   KEYS[3] fence:seq   KEYS[4] lock:acta:{acta}
-- ARGV[1] acta  ARGV[2] sub del auditor  ARGV[3] token  ARGV[4] ttl ms
-- ARGV[5] nombre del auditor  ARGV[6] ahora (ms)
-- Devuelve {1, fencing} | {0, 'YA_TOMADO'} | {0, 'NO_EXISTE'}

local score = redis.call('ZSCORE', KEYS[1], ARGV[1])
if not score then
  if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 1 then
    return {0, 'YA_TOMADO'}
  end
  return {0, 'NO_EXISTE'}
end

local valor = ARGV[2] .. ':' .. ARGV[3]
if not redis.call('SET', KEYS[4], valor, 'NX', 'PX', ARGV[4]) then
  return {0, 'YA_TOMADO'}
end

redis.call('ZREM', KEYS[1], ARGV[1])
local fencing = redis.call('INCR', KEYS[3])
redis.call('HSET', KEYS[2], ARGV[1], cjson.encode({
  auditor = ARGV[2],
  nombre = ARGV[5],
  desde = ARGV[6],
  fencing = fencing,
  score = score
}))
return {1, fencing}
