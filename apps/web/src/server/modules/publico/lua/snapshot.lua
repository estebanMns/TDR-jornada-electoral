--[[
snapshot.lua — fotografía atómica de un tópico público (RF-6).
Lee los totales del tópico y el último id de ev:all en una sola ejecución:
el cliente que recibe la fotografía con ese id nunca se salta ni repite eventos.

KEYS  1 tot:<topico>   2 cat:n:<topico> (número de mesas del nivel)   3 ev:all
Devuelve { totales (HGETALL plano), mesasTotal, ultimoId }
]]
local totales = redis.call('HGETALL', KEYS[1])
local mesasTotal = redis.call('GET', KEYS[2]) or '0'
local ultimo = redis.call('XREVRANGE', KEYS[3], '+', '-', 'COUNT', 1)
local ultimoId = '0-0'
if ultimo[1] then ultimoId = ultimo[1][1] end
return { totales, mesasTotal, ultimoId }
