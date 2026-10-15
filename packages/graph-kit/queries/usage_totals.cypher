// name: usage_totals
// owner: 002
// mode: read
// params: $userIds (list of strings), $monthStart (integer)
// returns: userId, modelCalls, inputTokens, outputTokens, embeddingTokens
UNWIND $userIds AS userId
OPTIONAL MATCH (:Learner {id: userId})-[:REQUESTED]->(t:Task)
WHERE t.createdAt >= $monthStart
WITH userId,
     sum(coalesce(t.modelCalls, 0))      AS taskCalls,
     sum(coalesce(t.inputTokens, 0))     AS taskInput,
     sum(coalesce(t.outputTokens, 0))    AS taskOutput,
     sum(coalesce(t.embeddingTokens, 0)) AS taskEmbedding
OPTIONAL MATCH (d:Decision)-[:FOR]->(:Learner {id: userId})
WHERE d.createdAt >= $monthStart
WITH userId, taskCalls, taskInput, taskOutput, taskEmbedding,
     sum(coalesce(d.modelCalls, 0))      AS decisionCalls,
     sum(coalesce(d.inputTokens, 0))     AS decisionInput,
     sum(coalesce(d.outputTokens, 0))    AS decisionOutput,
     sum(coalesce(d.embeddingTokens, 0)) AS decisionEmbedding
RETURN userId,
       taskCalls     + decisionCalls     AS modelCalls,
       taskInput     + decisionInput     AS inputTokens,
       taskOutput    + decisionOutput    AS outputTokens,
       taskEmbedding + decisionEmbedding AS embeddingTokens
