// name: approve_question
// owner: 005
// mode: write
// params: $questionId (string), $userId (string), $now (integer)
// returns: id
// No row = already decided, or not in a puzzle the caller owns. The status condition and the SET are one query, so
// the first decision wins. The REVIEWED edge records who decided, what, and when (epoch milliseconds).
MATCH (u:Learner {id: $userId})-[:OWNS]->(p:Puzzle)-[:CONTAINS]->(q:Question {id: $questionId})
WHERE q.status = 'draft'
SET q.status = 'approved', q.reviewedAt = $now
MERGE (u)-[r:REVIEWED]->(q)
SET r.decision = 'approved', r.at = $now
RETURN q.id AS id
