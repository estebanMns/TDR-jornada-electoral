--[[
Atomic snapshot of one or more public topics (RF-6). Reads the totals, the
table count and the LAST id of ev:all in one execution, so the id matches the
totals exactly: deltas after that id can be applied on top without gaps.

KEYS
  1          ev:all
  2k, 2k+1   tot:<topic>, cat:n:<topic>   (one pair per topic)

Returns { lastId, totals_1 (flat HGETALL), tables_1, totals_2, tables_2, ... }
]]

local last = redis.call('XREVRANGE', KEYS[1], '+', '-', 'COUNT', 1)
local lastId = '0-0'
if #last > 0 then lastId = last[1][1] end

local result = { lastId }
for i = 2, #KEYS, 2 do
  result[#result + 1] = redis.call('HGETALL', KEYS[i])
  result[#result + 1] = redis.call('GET', KEYS[i + 1]) or '0'
end
return result
