// name: open_tasks
// owner: 005
// mode: read
// params: $statuses (list of strings), $kinds (list of strings)
// returns: id, kind, status, lastCompletedStep, requesterId, sourceId, conceptIds
// INTERNAL (start-up resume and cover pickup). Oldest first.
MATCH (t:Task)-[:ASSIGNED_TO]->(:Agent {name: 'Curator'})
WHERE t.status IN $statuses AND t.kind IN $kinds
OPTIONAL MATCH (l:Learner)-[:REQUESTED]->(t)
OPTIONAL MATCH (d:Decision)-[:REQUESTED]->(t), (d)-[:FOR]->(dl:Learner)
OPTIONAL MATCH (t)-[:CONCERNS]->(s:Source)
OPTIONAL MATCH (t)-[:CONCERNS]->(c:Concept)
RETURN t.id AS id, t.kind AS kind, t.status AS status, t.lastCompletedStep AS lastCompletedStep,
       coalesce(l.id, dl.id) AS requesterId, s.id AS sourceId, collect(DISTINCT c.id) AS conceptIds
ORDER BY t.createdAt ASC
