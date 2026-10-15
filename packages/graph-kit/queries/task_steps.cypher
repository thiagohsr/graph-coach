// name: task_steps
// owner: 005
// mode: read
// params: $taskId (string), $userId (string, required)
// returns: stepId, node, status, log, modelCalls, inputTokens, outputTokens, embeddingTokens, startedAt, finishedAt, order
// Request-facing and strictly requester-only, like get_task: no rows for anyone else, whatever their role.
MATCH (t:Task {id: $taskId})
OPTIONAL MATCH (l:Learner)-[:REQUESTED]->(t)
OPTIONAL MATCH (d:Decision)-[:REQUESTED]->(t), (d)-[:FOR]->(dl:Learner)
WITH t, coalesce(l.id, dl.id) AS requesterId
WHERE requesterId = $userId
MATCH (t)-[r:HAS_STEP]->(st:Step)
RETURN st.id AS stepId, st.node AS node, st.status AS status, st.log AS log,
       st.modelCalls AS modelCalls, st.inputTokens AS inputTokens, st.outputTokens AS outputTokens,
       st.embeddingTokens AS embeddingTokens, st.startedAt AS startedAt, st.finishedAt AS finishedAt, r.order AS order
ORDER BY r.order ASC
