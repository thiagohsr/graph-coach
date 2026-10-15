// name: get_decision
// owner: 004
// mode: read
// params: $decisionId (string)
// returns: id, kind, summary, createdAt, flags, ownerId, puzzleId, puzzleName, targetConceptId, targetName, alternatives, coverageTaskId
// One row for an existing decision. Access (the learner it is for, or an admin) is decided by the service from ownerId.
MATCH (d:Decision {id: $decisionId})-[:FOR]->(l:Learner)
OPTIONAL MATCH (d)-[:RECOMMENDED]->(p:Puzzle)
OPTIONAL MATCH (d)-[bt:BECAUSE]->(t:Concept) WHERE bt.role = 'target'
OPTIONAL MATCH (d)-[:REQUESTED]->(task:Task)
WITH d, l, p, t, task
OPTIONAL MATCH (d)-[ba:BECAUSE]->(alt:Concept) WHERE ba.role = 'alternative'
WITH d, l, p, t, task, alt, ba
ORDER BY ba.weight DESC, alt.name ASC, alt.slug ASC
WITH d, l, p, t, task,
     collect(CASE WHEN alt IS NULL THEN null ELSE {conceptId: alt.id, name: alt.name} END) AS alternatives
RETURN d.id AS id, d.kind AS kind, d.summary AS summary, d.createdAt AS createdAt,
       coalesce(d.flags, []) AS flags, l.id AS ownerId,
       p.id AS puzzleId, p.name AS puzzleName,
       t.id AS targetConceptId, t.name AS targetName,
       alternatives, task.id AS coverageTaskId
