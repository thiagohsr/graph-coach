// name: weak_concepts_with_weak_prereqs
// owner: 004
// mode: read
// params: $learnerId (string), $now (integer, epoch ms), $decayDays (number), $threshold (number), $depth (integer 1..8), $scopeIds (list of strings, [] = no scope)
// returns: conceptId, slug, name, score, attempts, lastSeen, daysSince, risk, weakestPrereq (map or null), cyclic
// One row per weak concept (risk >= threshold) with its highest-risk practised upstream prerequisite. The traversal bound
// cannot be a parameter (spike: *1..$n fails), so the literal 8 (MAX_DEPTH) is used and $depth is applied as a filter.
// risk = (1 - score) * min(1 + days / decayDays, 2), days = floor((now - lastSeen) / 86400000).
MATCH (l:Learner {id: $learnerId})-[m:HAS_MASTERY]->(c:Concept)
WHERE size($scopeIds) = 0 OR c.id IN $scopeIds
WITH l, c, m, toInteger(floor(toFloat($now - m.lastSeen) / 86400000.0)) AS days
WITH l, c, m, days,
     (1.0 - m.score) *
     CASE WHEN 1.0 + days / toFloat($decayDays) > 2.0 THEN 2.0
          ELSE 1.0 + days / toFloat($decayDays) END AS risk
WHERE risk >= $threshold
OPTIONAL MATCH p = (a:Concept)-[:PREREQUISITE_OF*1..8]->(c)
WHERE length(p) <= $depth
WITH l, c, m, days, risk, a, min(length(p)) AS distance
OPTIONAL MATCH (l)-[am:HAS_MASTERY]->(a)
WITH c, m, days, risk, a, distance, am,
     CASE WHEN am IS NULL THEN null
          ELSE toInteger(floor(toFloat($now - am.lastSeen) / 86400000.0)) END AS aDays
WITH c, m, days, risk, a, distance, am, aDays,
     CASE WHEN am IS NULL THEN null
          ELSE (1.0 - am.score) *
               CASE WHEN 1.0 + aDays / toFloat($decayDays) > 2.0 THEN 2.0
                    ELSE 1.0 + aDays / toFloat($decayDays) END
     END AS aRisk
ORDER BY aRisk DESC, distance DESC, a.slug ASC
WITH c, m, days, risk,
     sum(CASE WHEN a IS NOT NULL AND a.id = c.id THEN 1 ELSE 0 END) > 0 AS cyclic,
     collect(CASE WHEN am IS NULL OR a.id = c.id THEN null ELSE {
       conceptId: a.id, slug: a.slug, name: a.name, distance: distance,
       score: am.score, attempts: am.attempts,
       lastSeen: am.lastSeen, daysSince: aDays, risk: aRisk } END) AS practised
RETURN c.id AS conceptId, c.slug AS slug, c.name AS name,
       m.score AS score, m.attempts AS attempts, m.lastSeen AS lastSeen,
       days AS daysSince, risk,
       practised[0] AS weakestPrereq,
       cyclic
ORDER BY risk DESC, attempts ASC, name ASC, slug ASC
