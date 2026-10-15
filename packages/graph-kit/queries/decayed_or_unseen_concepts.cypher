// name: decayed_or_unseen_concepts
// owner: 004
// mode: read
// params: $userId (string), $now (integer, epoch ms), $before (integer, epoch ms cutoff), $decayDays (number), $depth (integer 1..8), $scopeIds (list of strings), $limit (integer)
// returns: conceptId, slug, name, kind, score, attempts, lastSeen, daysSince, risk, openPrereqs
// Tier 2 and 3 candidates: concepts tested by an approved question of a puzzle the learner can play (canPlay, 002
// contracts section 5.3, pasted verbatim) that are unseen or last practised at or before $before. Unseen first, then
// fewer unpractised prerequisites within the depth, then the oldest lastSeen.
MATCH (l:Learner {id: $userId})
MATCH (p:Puzzle)-[:CONTAINS]->(:Question {status: 'approved'})-[:TESTS]->(c:Concept)
WHERE (size($scopeIds) = 0 OR c.id IN $scopeIds)
  AND p.status = 'published'
  AND (p.visibility = 'public'
       OR (:Learner {id: $userId})-[:OWNS]->(p)
       OR (p)-[:SHARED_WITH]->(:Learner {id: $userId}))
WITH DISTINCT l, c
OPTIONAL MATCH (l)-[m:HAS_MASTERY]->(c)
WITH l, c, m
WHERE m IS NULL OR m.lastSeen <= $before
OPTIONAL MATCH path = (a:Concept)-[:PREREQUISITE_OF*1..8]->(c)
WHERE length(path) <= $depth AND NOT (l)-[:HAS_MASTERY]->(a)
WITH c, m, count(DISTINCT a) AS openPrereqs
WITH c, m, openPrereqs,
     CASE WHEN m IS NULL THEN null
          ELSE toInteger(floor(toFloat($now - m.lastSeen) / 86400000.0)) END AS days
RETURN c.id AS conceptId, c.slug AS slug, c.name AS name,
       CASE WHEN m IS NULL THEN 'unseen' ELSE 'decayed' END AS kind,
       m.score AS score, coalesce(m.attempts, 0) AS attempts, m.lastSeen AS lastSeen,
       days AS daysSince,
       CASE WHEN m IS NULL THEN null
            ELSE (1.0 - m.score) *
                 CASE WHEN 1.0 + days / toFloat($decayDays) > 2.0 THEN 2.0
                      ELSE 1.0 + days / toFloat($decayDays) END END AS risk,
       openPrereqs
ORDER BY CASE WHEN m IS NULL THEN 0 ELSE 1 END ASC,
         openPrereqs ASC, coalesce(m.lastSeen, 0) ASC, c.name ASC, c.slug ASC
LIMIT $limit
