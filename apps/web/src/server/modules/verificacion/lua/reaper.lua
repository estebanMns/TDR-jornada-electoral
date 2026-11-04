-- Devuelve a la cola los casos tomados cuyo lock ya expiró. Idempotente:
-- que lo ejecuten las 8 instancias a la vez no causa problema.
-- KEYS[1] verif:taken   KEYS[2] verif:queue
-- ARGV[1] prefijo de lock ("lock:acta:")
-- Nota: construye claves lock:acta:* que no van en KEYS. Válido en una sola
-- instancia de Redis; en Cluster se usaría un hash tag común.
-- Devuelve la lista de actas liberadas.

local liberadas = {}
local entradas = redis.call('HGETALL', KEYS[1])
for i = 1, #entradas, 2 do
  local acta = entradas[i]
  if redis.call('EXISTS', ARGV[1] .. acta) == 0 then
    local datos = cjson.decode(entradas[i + 1])
    redis.call('HDEL', KEYS[1], acta)
    redis.call('ZADD', KEYS[2], datos.score, acta)
    table.insert(liberadas, acta)
  end
end
return liberadas
