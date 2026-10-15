// name: unshare_puzzle
// owner: 005
// mode: write
// params: $puzzleId (string), $userId (string), $targetId (string)
// returns: removed
// No row = unknown puzzle or not owned by the caller (404); removed = 0 when there was no share, still a success.
// Removing the edge ends play access and source access together (both rules read this one edge).
MATCH (:Learner {id: $userId})-[:OWNS]->(p:Puzzle {id: $puzzleId})
OPTIONAL MATCH (p)-[sh:SHARED_WITH]->(:Learner {id: $targetId})
WITH p, sh, CASE WHEN sh IS NULL THEN 0 ELSE 1 END AS removed
DELETE sh
RETURN removed
