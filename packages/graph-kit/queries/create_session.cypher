// name: create_session
// owner: 003
// mode: write
// params: $sessionId (string), $userId (string), $puzzleId (string), $now (integer)
// returns: sessionId
MATCH (p:Puzzle {id: $puzzleId})
// canPlay fragment (002 contracts §5.3), verbatim
WHERE p.status = 'published'
  AND (p.visibility = 'public'
       OR (:Learner {id: $userId})-[:OWNS]->(p)
       OR (p)-[:SHARED_WITH]->(:Learner {id: $userId}))
MATCH (l:Learner {id: $userId})
CREATE (l)-[:PLAYED]->(s:Session {id: $sessionId, startedAt: $now})-[:OF]->(p)
RETURN s.id AS sessionId
