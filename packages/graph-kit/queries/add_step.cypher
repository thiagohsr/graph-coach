// name: add_step
// owner: 005
// mode: write
// params: $taskId (string), $id (string), $node (string), $status (string), $log (string), $order (integer), $startedAt (integer), $finishedAt (integer or null), $usage (map {modelCalls, inputTokens, outputTokens, embeddingTokens})
// returns: stepId, status, modelCalls, inputTokens, outputTokens, embeddingTokens
// Creates the step on first call and updates it in place afterwards; startedAt and the HAS_STEP order are set once. The
// returned numbers are the task totals AFTER this write: they are recomputed as the sum over all of the task's steps in
// the same query, never incremented, so they stay right across resume (the same step is replaced) and retry (a new
// step is added, and the failed attempt keeps what it spent). Writing the same step twice gives the same totals.
MATCH (t:Task {id: $taskId})
MERGE (st:Step {id: $id})
  ON CREATE SET st.node = $node, st.startedAt = $startedAt
SET st.status = $status, st.log = $log, st.finishedAt = $finishedAt,
    st.modelCalls = $usage.modelCalls, st.inputTokens = $usage.inputTokens,
    st.outputTokens = $usage.outputTokens, st.embeddingTokens = $usage.embeddingTokens
MERGE (t)-[r:HAS_STEP]->(st)
  ON CREATE SET r.order = $order
WITH t, st
MATCH (t)-[:HAS_STEP]->(x:Step)
WITH t, st, sum(x.modelCalls) AS mc, sum(x.inputTokens) AS it, sum(x.outputTokens) AS ot, sum(x.embeddingTokens) AS et
SET t.modelCalls = mc, t.inputTokens = it, t.outputTokens = ot, t.embeddingTokens = et
RETURN st.id AS stepId, st.status AS status, mc AS modelCalls, it AS inputTokens, ot AS outputTokens, et AS embeddingTokens
