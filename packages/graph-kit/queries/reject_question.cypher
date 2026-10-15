// name: reject_question
// owner: 005
// mode: write
// params: $questionId (string), $userId (string), $reason (string or null), $now (integer)
// returns: id
// No row = already decided, or not in a puzzle the caller owns. A null reason writes no property.
MATCH (u:Learner {id: $userId})-[:OWNS]->(p:Puzzle)-[:CONTAINS]->(q:Question {id: $questionId})
WHERE q.status = 'draft'
SET q.status = 'rejected', q.reviewedAt = $now
MERGE (u)-[r:REVIEWED]->(q)
SET r.decision = 'rejected', r.reason = $reason, r.at = $now
RETURN q.id AS id
