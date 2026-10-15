// name: list_shares
// owner: 005
// mode: read
// params: $puzzleId (string), $userId (string)
// returns: puzzleId, status, hasSource, targetId, withSource, at
// No row = unknown puzzle or not owned by the caller (404). One row with a null targetId = owned, no shares. Ids only;
// the service fills names and addresses from the user directory. Oldest share first.
MATCH (:Learner {id: $userId})-[:OWNS]->(p:Puzzle {id: $puzzleId})
OPTIONAL MATCH (s:Source)-[:YIELDED]->(p)
OPTIONAL MATCH (p)-[sh:SHARED_WITH]->(u:Learner)
RETURN p.id AS puzzleId, p.status AS status, s IS NOT NULL AS hasSource,
       u.id AS targetId, sh.withSource AS withSource, sh.at AS at
ORDER BY at ASC
