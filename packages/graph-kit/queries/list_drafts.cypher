// name: list_drafts
// owner: 005
// mode: read
// params: $userId (string), $status (string or null = any), $taskId (string or null), $questionId (string or null)
// returns: id, sentence, answers, distractors, status, critique, origin, hasBrief, concepts, chunkId, chunkText, puzzleId, taskId, questionOrder
// canReview: the caller owns the puzzle that contains the question. No role sees another user's questions and a user a
// puzzle is shared with sees none. Concepts are collected in a stage of their own (no aggregate next to projected
// properties in one RETURN). `questionOrder` is CONTAINS.order (`order` is a reserved word). Each concept map has null
// fields when the question tests nothing; the caller drops those.
MATCH (:Learner {id: $userId})-[:OWNS]->(p:Puzzle)-[ct:CONTAINS]->(q:Question)
WHERE ($status IS NULL OR q.status = $status) AND ($questionId IS NULL OR q.id = $questionId)
OPTIONAL MATCH (t:Task)-[:PRODUCED]->(q)
WITH p, ct, q, t
WHERE $taskId IS NULL OR t.id = $taskId
OPTIONAL MATCH (q)-[:TESTS]->(c:Concept)
WITH p, ct, q, t, collect(DISTINCT {id: c.id, name: c.name, slug: c.slug}) AS concepts
OPTIONAL MATCH (q)-[:GROUNDED_IN]->(ch:Chunk)
OPTIONAL MATCH (q)-[:GENERATED_FROM]->(b:Source)
RETURN q.id AS id, q.sentence AS sentence, q.answers AS answers, q.distractors AS distractors,
       q.status AS status, q.critique AS critique, p.origin AS origin, b IS NOT NULL AS hasBrief,
       concepts, ch.id AS chunkId, ch.text AS chunkText, p.id AS puzzleId, t.id AS taskId,
       ct.order AS questionOrder
ORDER BY taskId, questionOrder
