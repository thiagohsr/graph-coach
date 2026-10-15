// name: list_puzzles
// owner: 003
// mode: read
// params: $userId (string)
// returns: id, name, visibility, origin, access, ownerName, sourceShared, sourceId, questionCount, concepts
MATCH (p:Puzzle)
// canPlay fragment (002 contracts §5.3), verbatim
WHERE p.status = 'published'
  AND (p.visibility = 'public'
       OR (:Learner {id: $userId})-[:OWNS]->(p)
       OR (p)-[:SHARED_WITH]->(:Learner {id: $userId}))
OPTIONAL MATCH (owner:Learner)-[:OWNS]->(p)
OPTIONAL MATCH (p)-[sh:SHARED_WITH]->(:Learner {id: $userId})
OPTIONAL MATCH (s:Source)-[:YIELDED]->(p)
// canReadSource as a value: a pattern predicate cannot be projected as a boolean on this FalkorDB (spike), so the
// fallback form is used: one OPTIONAL MATCH per branch (owns the source; a puzzle it yielded is shared with
// withSource = true), collapsed with count().
OPTIONAL MATCH (:Learner {id: $userId})-[ow:OWNS]->(s)
OPTIONAL MATCH (s)-[:YIELDED]->(:Puzzle)-[sw:SHARED_WITH {withSource: true}]->(:Learner {id: $userId})
WITH p, owner, sh, s, count(ow) > 0 OR count(sw) > 0 AS sourceShared
WITH p, owner, s, sourceShared,
     CASE WHEN owner.id = $userId THEN 'owner'
          WHEN sh IS NOT NULL THEN 'shared'
          ELSE 'public' END AS access
MATCH (p)-[:CONTAINS]->(q:Question)
WHERE q.status = 'approved'
OPTIONAL MATCH (q)-[:TESTS]->(c:Concept)
WITH p, owner, access, sourceShared,
     CASE WHEN sourceShared THEN s.id ELSE null END AS sourceId,
     count(DISTINCT q) AS questionCount,
     collect(DISTINCT CASE WHEN c IS NULL THEN null ELSE {id: c.id, name: c.name} END) AS concepts
RETURN p.id AS id, p.name AS name, p.visibility AS visibility, p.origin AS origin, access,
       owner.displayName AS ownerName, sourceShared, sourceId, questionCount, concepts
ORDER BY name, id
