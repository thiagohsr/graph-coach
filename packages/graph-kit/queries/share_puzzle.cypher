// name: share_puzzle
// owner: 005
// mode: write
// params: $puzzleId (string), $userId (string), $targetId (string), $withSource (boolean), $now (integer)
// returns: status, hasSource, targetFound, shared, targetId, withSource, at
// No row = unknown puzzle or not owned by the caller (404). Ids only: no address or name is sent or stored. The edge is
// written only when the puzzle is published, the target exists and is not the owner, and a source exists when
// $withSource is true; otherwise the diagnostic columns say which error to answer. Idempotent; changing $withSource
// updates the edge and keeps `at`.
MATCH (owner:Learner {id: $userId})-[:OWNS]->(p:Puzzle {id: $puzzleId})
OPTIONAL MATCH (s:Source)-[:YIELDED]->(p)
OPTIONAL MATCH (target:Learner {id: $targetId})
WITH owner, p, s, target,
     p.status = 'published' AND target IS NOT NULL AND target.id <> owner.id
       AND (NOT $withSource OR s IS NOT NULL) AS allowed
FOREACH (_ IN CASE WHEN allowed THEN [1] ELSE [] END |
  MERGE (p)-[sh:SHARED_WITH]->(target)
    ON CREATE SET sh.at = $now
  SET sh.withSource = $withSource)
WITH p, s, target, allowed
OPTIONAL MATCH (p)-[sh2:SHARED_WITH]->(target)
RETURN p.status AS status, s IS NOT NULL AS hasSource, target IS NOT NULL AS targetFound,
       allowed AS shared, target.id AS targetId, sh2.withSource AS withSource, sh2.at AS at
