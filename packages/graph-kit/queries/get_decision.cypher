// name: get_decision
// owner: 004
// mode: read
// params: $decisionId (string)
// returns: id, kind, summary, createdAt, flags, ownerId, puzzleId, puzzleName, targetConceptId, targetName, alternatives, coverageTaskId, coverageConcepts, goalConcepts
// One row for an existing decision. Access (the learner it is for, or an admin) is decided by the service from ownerId.
// coverageConcepts: the {conceptId, name} of each concept the linked cover task concerns; goalConcepts: those of the goal
// the decision is toward (both [] when there is no task or goal).
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
OPTIONAL MATCH (task)-[:CONCERNS]->(cc:Concept)
WITH d, l, p, t, task, alternatives, cc
ORDER BY cc.name ASC, cc.slug ASC
WITH d, l, p, t, task, alternatives,
     collect(CASE WHEN cc IS NULL THEN null ELSE {conceptId: cc.id, name: cc.name} END) AS coverageConcepts
OPTIONAL MATCH (d)-[:TOWARD]->(:Goal)-[:TARGETS]->(gc:Concept)
WITH d, l, p, t, task, alternatives, coverageConcepts, gc
ORDER BY gc.name ASC, gc.slug ASC
WITH d, l, p, t, task, alternatives, coverageConcepts,
     collect(CASE WHEN gc IS NULL THEN null ELSE {conceptId: gc.id, name: gc.name} END) AS goalConcepts
RETURN d.id AS id, d.kind AS kind, d.summary AS summary, d.createdAt AS createdAt,
       coalesce(d.flags, []) AS flags, l.id AS ownerId,
       p.id AS puzzleId, p.name AS puzzleName,
       t.id AS targetConceptId, t.name AS targetName,
       alternatives, task.id AS coverageTaskId, coverageConcepts, goalConcepts
