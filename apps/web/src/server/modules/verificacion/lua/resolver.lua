-- Cierra un caso SOLO si el token coincide (compare-and-delete).
-- Un auditor cuyo lease expiró y fue reasignado tiene un token viejo → LOCK_PERDIDO.
-- KEYS[1] lock:acta:{acta}  KEYS[2] verif:taken  KEYS[3] verif:case:{acta}  KEYS[4] verif:stats
-- ARGV[1] valor esperado "{sub}:{token}"  ARGV[2] acta
-- Devuelve {1, fencing, score} | {0, 'LOCK_PERDIDO'}

if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return {0, 'LOCK_PERDIDO'}
end

local registro = redis.call('HGET', KEYS[2], ARGV[2])
if not registro then
  return {0, 'LOCK_PERDIDO'}
end
local datos = cjson.decode(registro)

redis.call('DEL', KEYS[1])
redis.call('HDEL', KEYS[2], ARGV[2])
redis.call('DEL', KEYS[3])
redis.call('HINCRBY', KEYS[4], 'resueltos', 1)
return {1, datos.fencing, datos.score}
