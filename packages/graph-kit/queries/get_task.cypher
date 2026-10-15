// name: get_task
// owner: 005
// mode: read
// params: $id (string), $userId (string, required)
// returns: id, kind, status, result, error, lastCompletedStep, createdAt, updatedAt, modelCalls, inputTokens, outputTokens, embeddingTokens, requesterId, sourceId, puzzleId, puzzleStatus, concepts, questions
// Request-facing and strictly requester-only (reconciliation G8): no row for anyone else, whatever their role. There is
// no value of $userId that skips the check; the API's parameter schema refuses a missing or null id before this is sent.
// For a cover task the requester is the learner its decision is FOR.
MATCH (t:Task {id: $id})
OPTIONAL MATCH (l:Learner)-[:REQUESTED]->(t)
OPTIONAL MATCH (d:Decision)-[:REQUESTED]->(t), (d)-[:FOR]->(dl:Learner)
WITH t, coalesce(l.id, dl.id) AS requesterId
WHERE requesterId = $userId
OPTIONAL MATCH (t)-[:CONCERNS]->(s:Source)
OPTIONAL MATCH (t)-[:PRODUCED]->(p:Puzzle)
WITH t, requesterId, s, p
OPTIONAL MATCH (t)-[:PRODUCED]->(c:Concept)
WITH t, requesterId, s, p, count(DISTINCT c) AS concepts
OPTIONAL MATCH (t)-[:PRODUCED]->(q:Question)
RETURN t.id AS id, t.kind AS kind, t.status AS status, t.result AS result, t.error AS error,
       t.lastCompletedStep AS lastCompletedStep, t.createdAt AS createdAt, t.updatedAt AS updatedAt,
       t.modelCalls AS modelCalls, t.inputTokens AS inputTokens, t.outputTokens AS outputTokens,
       t.embeddingTokens AS embeddingTokens,
       requesterId, s.id AS sourceId, p.id AS puzzleId, p.status AS puzzleStatus,
       concepts, count(DISTINCT q) AS questions
