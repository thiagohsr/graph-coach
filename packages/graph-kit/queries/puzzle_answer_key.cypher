// name: puzzle_answer_key
// owner: 003
// mode: read
// params: $puzzleId (string)
// returns: questionId, order, sentence, answers, concepts
// server-only: grading. Called only from apps/api/src/apps/gameplay/. No access clause on purpose: it is reached
// only through a session the caller owns, and a session outlives a revoked share.
MATCH (p:Puzzle {id: $puzzleId})-[r:CONTAINS]->(q:Question)
WHERE q.status = 'approved'
OPTIONAL MATCH (q)-[:TESTS]->(c:Concept)
WITH q, r, collect(CASE WHEN c IS NULL THEN null ELSE {id: c.id, name: c.name} END) AS concepts
RETURN q.id AS questionId, r.order AS order, q.sentence AS sentence, q.answers AS answers, concepts
ORDER BY order
