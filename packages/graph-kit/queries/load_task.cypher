// name: load_task
// owner: 005
// mode: read
// params: $id (string)
// returns: id, kind, status, result, error, lastCompletedStep, createdAt, updatedAt, modelCalls, inputTokens, outputTokens, embeddingTokens, requesterId, sourceId, puzzleId, puzzleStatus, concepts, questions, steps
// INTERNAL. No access check, on purpose: this is the pipeline's own read (run orchestrator, step recorder, nodes of both
// graphs, start-up resume). It is never called from a controller or from a service method that serves a request; a test
// enforces that. `steps` holds {stepId, node, status, log, modelCalls, inputTokens, outputTokens, embeddingTokens,
// startedAt, finishedAt, order} ordered by order; a task with no step yields one map of nulls, which the caller drops.
MATCH (t:Task {id: $id})
OPTIONAL MATCH (l:Learner)-[:REQUESTED]->(t)
OPTIONAL MATCH (d:Decision)-[:REQUESTED]->(t), (d)-[:FOR]->(dl:Learner)
OPTIONAL MATCH (t)-[:CONCERNS]->(s:Source)
OPTIONAL MATCH (t)-[:PRODUCED]->(p:Puzzle)
WITH t, coalesce(l.id, dl.id) AS requesterId, s, p
OPTIONAL MATCH (t)-[:PRODUCED]->(c:Concept)
WITH t, requesterId, s, p, count(DISTINCT c) AS concepts
OPTIONAL MATCH (t)-[:PRODUCED]->(q:Question)
WITH t, requesterId, s, p, concepts, count(DISTINCT q) AS questions
OPTIONAL MATCH (t)-[r:HAS_STEP]->(st:Step)
WITH t, requesterId, s, p, concepts, questions, r, st ORDER BY r.order ASC
RETURN t.id AS id, t.kind AS kind, t.status AS status, t.result AS result, t.error AS error,
       t.lastCompletedStep AS lastCompletedStep, t.createdAt AS createdAt, t.updatedAt AS updatedAt,
       t.modelCalls AS modelCalls, t.inputTokens AS inputTokens, t.outputTokens AS outputTokens,
       t.embeddingTokens AS embeddingTokens,
       requesterId, s.id AS sourceId, p.id AS puzzleId, p.status AS puzzleStatus, concepts, questions,
       collect({stepId: st.id, node: st.node, status: st.status, log: st.log, modelCalls: st.modelCalls,
                inputTokens: st.inputTokens, outputTokens: st.outputTokens, embeddingTokens: st.embeddingTokens,
                startedAt: st.startedAt, finishedAt: st.finishedAt, order: r.order}) AS steps
