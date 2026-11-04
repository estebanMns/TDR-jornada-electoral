--[[
apply_acta.lua — atomic, idempotent application of an acta version (RF-1, RF-2, RF-3).

Redis runs a script without interleaving any other command, so no client can
ever read a municipality already updated while its station is not, and a
crash can never leave the four levels half applied.

Rule: the state of an acta is its HIGHEST version received. If that version is
valid it is the one that counts; if it is doubtful the acta contributes 0
until an auditor resolves it. Lower versions are OBSOLETE. Hence the totals
depend only on the SET of versions received, never on their order.

All totals are updated through net deltas (new contribution - previous
contribution), so reverting the applied version and applying the new one is a
single step, and `abs` carries only the fields whose value really changed.

KEYS
  1  idem:{key}             (placeholder when there is no idempotency key)
  2  acta:{id}
  3  acta:{id}:v:{n}
  4  juror:{sub}:actas
  5  tot:table:{id}         6  tot:station:{id}     7  tot:mun:{id}     8  tot:dep
  9  rank:station:{id}      10 rank:mun:{id}        11 rank:dep
  12 ev:all                 13 ev:actas
  14 verif:queue            15 verif:case:{id}

The review queue and cases follow the verification module's contract
(packages/shared/src/schemas/verificacion.js → casoVerificacionSchema): the case
is a JSON STRING, announced on ch:verif as { tipo = 'caso_nuevo', item }. Once a
case is enqueued it belongs to that module; RESOLUTION mode does not touch it.

ARGV
  1  JSON context (see actas.repository.ts → ApplyActaContext)

Returns a JSON string: { result, reason?, receiptId?, registeredAt?, replayed?, status? }
or { error } for programming / contract errors.
]]

local ctx = cjson.decode(ARGV[1])

local K_IDEM, K_ACTA, K_VERSION, K_JUROR = KEYS[1], KEYS[2], KEYS[3], KEYS[4]
local K_EV_ALL, K_EV_ACTAS, K_QUEUE, K_CASE = KEYS[12], KEYS[13], KEYS[14], KEYS[15]

-- Level i: totals key, ranking key (nil for the table level), public topic (nil for the table level).
local LEVELS = {
  { totals = KEYS[5], rank = nil, topic = nil },
  { totals = KEYS[6], rank = KEYS[9], topic = 'station:' .. ctx.stationId },
  { totals = KEYS[7], rank = KEYS[10], topic = 'mun:' .. ctx.munId },
  { totals = KEYS[8], rank = KEYS[11], topic = 'dep' },
}

local REPORTED, VOTERS = '_reported', '_voters'

local rankable = {}
for _, id in ipairs(ctx.rankFields) do rankable[id] = true end

-- --------------------------------------------------------------- state

local state = redis.call('HMGET', K_ACTA,
  'vmax', 'vapplied', 'hash', 'status', 'appliedVotes', 'appliedVoters', 'receiptId', 'registeredAt', 'resolvedVersion', 'fencing')
local vmax = tonumber(state[1]) or 0
local vapplied = tonumber(state[2]) or 0
local storedHash = state[3]
local status = state[4]
local appliedVotes = (state[5] and state[5] ~= '') and cjson.decode(state[5]) or nil
local appliedVoters = tonumber(state[6]) or 0
local storedReceiptId = state[7]
local storedRegisteredAt = tonumber(state[8])
local resolvedVersion = tonumber(state[9]) or 0
local lastFencing = tonumber(state[10]) or -1

-- --------------------------------------------------------------- helpers

local function xadd(key, maxlen, fields)
  local args = { 'XADD', key, 'MAXLEN', '~', maxlen, '*' }
  for i = 1, #fields do args[#args + 1] = fields[i] end
  return redis.call(unpack(args))
end

local function persist(kind, data)
  xadd(K_EV_ACTAS, ctx.evActasMaxLen, { 'kind', kind, 'data', cjson.encode(data) })
end

-- Doubt reasons of this module → `motivo` of the verification contract.
local CASE_REASON = {
  TALLY_MISMATCH = 'DESCUADRE',
  VOTERS_EXCEED_ENABLED = 'SUFRAGANTES_EXCEDEN',
  CONTENT_CONFLICT = 'CONFLICTO',
}

local function publishVerification(message)
  redis.call('PUBLISH', ctx.verificationChannel, cjson.encode(message))
end

-- Stores the receipt under the idempotency key (first writer wins) and returns it.
local function finish(receipt)
  if ctx.mode == 'SUBMIT' and ctx.idempotencyKey ~= '' then
    local stored = {
      result = receipt.result, reason = receipt.reason, receiptId = receipt.receiptId,
      registeredAt = receipt.registeredAt, actaId = ctx.actaId, version = ctx.version,
      contentHash = ctx.contentHash,
    }
    redis.call('SET', K_IDEM, cjson.encode(stored), 'EX', ctx.idemTtlSeconds, 'NX')
  end
  return cjson.encode(receipt)
end

--[[
Moves the contribution of the acta from what is applied now to `newVotes`
(nil = contributes nothing). Updates the 4 levels, the rankings, the acta
hash and emits ONE ev:all event when something changed.
]]
local function transition(newVotes, newVoters, newVersion, reason)
  local delta = {}
  local function add(field, amount) delta[field] = (delta[field] or 0) + amount end

  if vapplied > 0 and appliedVotes then
    for field, count in pairs(appliedVotes) do add(field, -count) end
    add(VOTERS, -appliedVoters)
    add(REPORTED, -1)
  end
  if newVotes then
    for field, count in pairs(newVotes) do add(field, count) end
    add(VOTERS, newVoters)
    add(REPORTED, 1)
  end

  local abs, changed = {}, false
  for _, level in ipairs(LEVELS) do
    for field, amount in pairs(delta) do
      if amount ~= 0 then
        changed = true
        local value = redis.call('HINCRBY', level.totals, field, amount)
        if level.topic then
          abs[level.topic] = abs[level.topic] or {}
          abs[level.topic][field] = value
        end
        if level.rank and rankable[field] then
          redis.call('ZINCRBY', level.rank, amount, field)
        end
      end
    end
  end

  local eventType
  if newVotes and vapplied > 0 then eventType = 'CORRECTION'
  elseif newVotes then eventType = 'APPLIED'
  else eventType = 'REVERSAL' end

  if newVotes then
    redis.call('HSET', K_ACTA, 'vapplied', newVersion, 'appliedVotes', cjson.encode(newVotes), 'appliedVoters', newVoters)
  else
    redis.call('HSET', K_ACTA, 'vapplied', 0, 'appliedVotes', '', 'appliedVoters', 0)
  end
  vapplied = newVotes and newVersion or 0

  if changed then
    xadd(K_EV_ALL, ctx.evAllMaxLen, {
      'acta', ctx.actaId, 'version', newVersion, 'type', eventType, 'reason', reason,
      'tsRx', ctx.tsRx, 'table', ctx.tableId, 'station', ctx.stationId, 'mun', ctx.munId,
      'abs', cjson.encode(abs),
    })
  end
end

--[[
Creates the review case of the current version (one case per acta, always
about vmax). `review` = { level = 1..3 (1 = first), score } computed in TS:
score = level * 1e13 + enqueuedAt (scoreDeCaso of the verification module).
]]
local function enqueueCase(reason, record, review, conflicting)
  local case = {
    acta = ctx.actaId, version = ctx.version, prioridad = review.level,
    motivo = CASE_REASON[reason], mesa = ctx.tableId,
    puesto = { id = ctx.stationId, nombre = ctx.stationName },
    municipio = { id = ctx.munId, nombre = ctx.munName },
    votos = record.votes, sufragantes = record.voters, habilitados = ctx.enabled,
    encoladaEn = ctx.tsRx,
  }
  if conflicting then
    -- Additive fields: the copy that disagrees with the registered one.
    case.votosEnConflicto = conflicting.votes
    case.sufragantesEnConflicto = conflicting.voters
  end
  redis.call('SET', K_CASE, cjson.encode(case))
  redis.call('ZADD', K_QUEUE, review.score, ctx.actaId)
  publishVerification({ tipo = 'caso_nuevo', item = case })
end

-- A newer version makes the pending case of an older one meaningless.
local function supersedeCase()
  local removed = redis.call('ZREM', K_QUEUE, ctx.actaId)
  local existed = redis.call('DEL', K_CASE)
  if removed == 1 or existed == 1 then
    publishVerification({ tipo = 'caso_resuelto', acta = ctx.actaId, motivo = 'SUPERSEDED' })
  end
end

-- --------------------------------------------------------------- RESOLUTION

if ctx.mode == 'RESOLUTION' then
  -- Fencing: a decision taken under an older lock than one already applied is late.
  if ctx.fencing <= lastFencing then
    return cjson.encode({ result = 'STALE_FENCING', status = status })
  end
  if ctx.version < vmax then
    return cjson.encode({ result = 'OBSOLETE', status = status })
  end
  if ctx.version ~= vmax or (status ~= 'UNDER_REVIEW' and status ~= 'CONFLICT') then
    return cjson.encode({ result = 'NOT_UNDER_REVIEW', status = status })
  end

  local votes, voters = ctx.votes, ctx.voters
  if ctx.decision == 'APPROVE' or votes == nil then
    local version = cjson.decode(redis.call('GET', K_VERSION))
    votes = votes or version.votes
    voters = voters or version.voters
  end

  local newStatus
  if ctx.decision == 'REJECT' then
    newStatus = 'REJECTED'
  else
    newStatus = 'APPLIED'
    transition(votes, voters, ctx.version, 'RESOLUTION')
  end

  -- The verification module already closed the case and the queue entry.
  redis.call('HSET', K_ACTA, 'status', newStatus, 'reason', ctx.decision, 'resolvedVersion', ctx.version,
    'fencing', ctx.fencing, 'updatedAt', ctx.tsRx)

  local resolution = {
    actaId = ctx.actaId, version = ctx.version, status = newStatus, decision = ctx.decision,
    auditor = ctx.auditor, fencing = ctx.fencing, reason = ctx.reason, resolvedAt = ctx.tsRx,
  }
  if ctx.decision == 'APPROVE_WITH_CORRECTION' then
    resolution.votes = votes
    resolution.voters = voters
  end
  persist('RESOLUTION', resolution)
  return cjson.encode({ result = 'RESOLVED', status = newStatus })
end

-- --------------------------------------------------------------- SUBMIT

-- 1. Idempotency: a resend with the same key gets the original receipt.
if ctx.idempotencyKey ~= '' then
  local stored = redis.call('GET', K_IDEM)
  if stored then
    local receipt = cjson.decode(stored)
    if receipt.actaId ~= ctx.actaId or receipt.version ~= ctx.version or receipt.contentHash ~= ctx.contentHash then
      return cjson.encode({ error = 'IDEMPOTENCY_KEY_REUSED' })
    end
    receipt.actaId, receipt.version, receipt.contentHash = nil, nil, nil
    if receipt.result == 'REGISTERED' then receipt.result = 'ALREADY_REGISTERED' end
    receipt.replayed = true
    return cjson.encode(receipt)
  end
end

-- 2. Older version: nothing changes.
if ctx.version < vmax then
  return finish({ result = 'OBSOLETE', reason = 'NEWER_VERSION_EXISTS', receiptId = ctx.receiptId, registeredAt = ctx.tsRx })
end

-- 3. Same version: identical content is a resend (covers an expired idempotency key);
--    different content is a conflict that goes to review.
if ctx.version == vmax then
  if storedHash == ctx.contentHash then
    return finish({ result = 'ALREADY_REGISTERED', receiptId = storedReceiptId, registeredAt = storedRegisteredAt, replayed = true })
  end
  if resolvedVersion == vmax then
    -- An auditor already decided on this version: a late conflicting copy cannot reopen it.
    return finish({ result = 'CONFLICT', reason = 'ALREADY_RESOLVED', receiptId = ctx.receiptId, registeredAt = ctx.tsRx })
  end
  if status ~= 'CONFLICT' then
    transition(nil, 0, vmax, 'UNDER_REVIEW')
    redis.call('HSET', K_ACTA, 'status', 'CONFLICT', 'reason', 'CONTENT_CONFLICT', 'updatedAt', ctx.tsRx)
    -- The case shows the first registered content and the conflicting copy side by side.
    local original = cjson.decode(redis.call('GET', K_VERSION))
    enqueueCase('CONTENT_CONFLICT', original, ctx.conflictReview, { votes = ctx.votes, voters = ctx.voters })
    persist('STATUS', { actaId = ctx.actaId, version = ctx.version, status = 'CONFLICT', reason = 'CONTENT_CONFLICT' })
  end
  return finish({ result = 'CONFLICT', reason = 'CONTENT_CONFLICT', receiptId = ctx.receiptId, registeredAt = ctx.tsRx })
end

-- 4. New highest version.
local valid = not ctx.doubtful
local newStatus = valid and 'APPLIED' or 'UNDER_REVIEW'
local reason = valid and '' or ctx.reason

supersedeCase()
if valid then
  transition(ctx.votes, ctx.voters, ctx.version, vapplied > 0 and 'CORRECTION' or 'FIRST_REPORT')
else
  transition(nil, 0, ctx.version, 'UNDER_REVIEW')
end

redis.call('HSET', K_ACTA,
  'vmax', ctx.version, 'hash', ctx.contentHash, 'status', newStatus, 'reason', reason,
  'receiptId', ctx.receiptId, 'registeredAt', ctx.tsRx, 'updatedAt', ctx.tsRx,
  'tableId', ctx.tableId, 'stationId', ctx.stationId, 'munId', ctx.munId, 'juror', ctx.juror)

local versionRecord = {
  actaId = ctx.actaId, version = ctx.version, tableId = ctx.tableId, stationId = ctx.stationId,
  munId = ctx.munId, juror = ctx.juror, votes = ctx.votes, voters = ctx.voters, photoHash = ctx.photoHash,
  status = newStatus, reason = reason, idempotencyKey = ctx.idempotencyKey, instance = ctx.instance,
  receiptId = ctx.receiptId, receivedAt = ctx.tsRx,
}
redis.call('SET', K_VERSION, cjson.encode(versionRecord))
redis.call('SADD', K_JUROR, ctx.actaId)

if not valid then enqueueCase(reason, versionRecord, ctx.review) end
persist('VERSION', versionRecord)

return finish({
  result = valid and 'REGISTERED' or 'UNDER_REVIEW',
  reason = valid and nil or reason,
  receiptId = ctx.receiptId,
  registeredAt = ctx.tsRx,
})
