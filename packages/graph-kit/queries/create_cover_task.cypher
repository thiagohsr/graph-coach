// name: create_cover_task
// owner: 004
// mode: write
// params: $taskId (string), $learnerId (string), $decisionId (string), $conceptIds (list of strings, non-empty), $now (integer, epoch ms)
// returns: taskId, status, concerns
// A queued 'cover' Task for the Curator: REQUESTED by the learner and the decision, ASSIGNED_TO the Curator, CONCERNS each
// concept. An existing task with the same id is returned unchanged, whatever its status (MERGE never rewrites it).
MATCH (l:Learner {id: $learnerId})<-[:FOR]-(d:Decision {id: $decisionId})
MERGE (cur:Agent {name: 'Curator'})
MERGE (t:Task {id: $taskId})
  ON CREATE SET t.kind = 'cover', t.status = 'queued', t.createdAt = $now, t.updatedAt = $now,
                t.modelCalls = 0, t.inputTokens = 0, t.outputTokens = 0, t.embeddingTokens = 0
MERGE (l)-[:REQUESTED]->(t)
MERGE (d)-[:REQUESTED]->(t)
MERGE (t)-[:ASSIGNED_TO]->(cur)
WITH t
UNWIND $conceptIds AS cid
MATCH (c:Concept {id: cid})
MERGE (t)-[:CONCERNS]->(c)
RETURN t.id AS taskId, t.status AS status, count(c) AS concerns
