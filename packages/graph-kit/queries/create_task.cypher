// name: create_task
// owner: 005
// mode: write
// params: $id (string), $kind ('ingest' | 'generate'), $requesterId (string), $sourceId (string), $now (integer)
// returns: taskId, status
// Deviation from the draft: the Curator agent node is MERGEd rather than MATCHed, so a graph that was not seeded (a test
// graph) still gets its task; on a seeded graph the MERGE finds the seeded node. Repeating the call changes nothing.
MATCH (l:Learner {id: $requesterId}), (s:Source {id: $sourceId})
MERGE (a:Agent {name: 'Curator'})
MERGE (t:Task {id: $id})
  ON CREATE SET t.kind = $kind, t.status = 'queued', t.createdAt = $now, t.updatedAt = $now,
                t.modelCalls = 0, t.inputTokens = 0, t.outputTokens = 0, t.embeddingTokens = 0
MERGE (l)-[:REQUESTED]->(t)
MERGE (t)-[:ASSIGNED_TO]->(a)
MERGE (t)-[:CONCERNS]->(s)
RETURN t.id AS taskId, t.status AS status
