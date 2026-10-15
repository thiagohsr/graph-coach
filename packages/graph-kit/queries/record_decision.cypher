// name: record_decision
// owner: 004
// mode: write
// params: $decisionId (string), $learnerId (string), $kind (string), $summary (string), $flags (list of strings), $now (integer), $modelCalls (integer), $inputTokens (integer), $outputTokens (integer), $embeddingTokens (integer), $puzzleId (string, '' = none), $goalId (string, '' = none), $evidence (list of {label, nodeId, role, reason, weight})
// returns: decisionId, becauseCount, linkedPuzzle
// The single decision write, atomic on the pinned FalkorDB (spike S10): Decision, MADE, FOR, one BECAUSE per matched
// evidence node, RECOMMENDED only when a puzzle was chosen, TOWARD only for a goal. If no evidence node matches,
// nothing is created and no row is returned.
MATCH (l:Learner {id: $learnerId}), (ag:Agent {name: 'Coach'})
UNWIND $evidence AS ev
OPTIONAL MATCH (c:Concept  {id: ev.nodeId}) WHERE ev.label = 'Concept'
OPTIONAL MATCH (s:Session  {id: ev.nodeId}) WHERE ev.label = 'Session'
OPTIONAL MATCH (q:Question {id: ev.nodeId}) WHERE ev.label = 'Question'
OPTIONAL MATCH (k:Chunk    {id: ev.nodeId}) WHERE ev.label = 'Chunk'
WITH l, ag, ev, coalesce(c, s, q, k) AS n
WHERE n IS NOT NULL
WITH l, ag, collect({node: n, role: ev.role, reason: ev.reason, weight: ev.weight}) AS items
CREATE (d:Decision {id: $decisionId, kind: $kind, summary: $summary, createdAt: $now, flags: $flags,
                    modelCalls: $modelCalls, inputTokens: $inputTokens,
                    outputTokens: $outputTokens, embeddingTokens: $embeddingTokens})
CREATE (ag)-[:MADE]->(d)
CREATE (d)-[:FOR]->(l)
WITH d, items
UNWIND items AS it
WITH d, it.node AS n, it
CREATE (d)-[:BECAUSE {role: it.role, reason: it.reason, weight: it.weight}]->(n)
WITH d, count(n) AS becauseCount
OPTIONAL MATCH (p:Puzzle {id: $puzzleId})
FOREACH (_ IN CASE WHEN p IS NULL THEN [] ELSE [1] END | CREATE (d)-[:RECOMMENDED]->(p))
WITH d, becauseCount, p
OPTIONAL MATCH (g:Goal {id: $goalId})
FOREACH (_ IN CASE WHEN g IS NULL THEN [] ELSE [1] END | CREATE (d)-[:TOWARD]->(g))
RETURN d.id AS decisionId, becauseCount, p IS NOT NULL AS linkedPuzzle
