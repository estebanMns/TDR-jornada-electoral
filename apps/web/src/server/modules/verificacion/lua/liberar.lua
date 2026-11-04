-- Soltar un caso voluntariamente (compare-and-delete): solo con el token vigente.
-- KEYS[1] lock:acta:{acta}   KEYS[2] verif:taken   KEYS[3] verif:queue
-- ARGV[1] valor esperado "{sub}:{token}"  ARGV[2] acta
-- Devuelve 1 si se liberó, 0 si el lock ya no era suyo.

if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end

local registro = redis.call('HGET', KEYS[2], ARGV[2])
redis.call('DEL', KEYS[1])
redis.call('HDEL', KEYS[2], ARGV[2])
if registro then
  redis.call('ZADD', KEYS[3], cjson.decode(registro).score, ARGV[2])
end
return 1
