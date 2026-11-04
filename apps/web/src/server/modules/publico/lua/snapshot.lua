-- KEYS[1] tot:<topic>, KEYS[2] cat:n:<topic>, KEYS[3] ev:all
local totals = redis.call('HGETALL', KEYS[1])
local informed = redis.call('GET', KEYS[2]) or '0'
local last = redis.call('XREVRANGE', KEYS[3], '+', '-', 'COUNT', 1)
local lastId = '0-0'
if last[1] then lastId = last[1][1] end
return { totals, informed, lastId }
