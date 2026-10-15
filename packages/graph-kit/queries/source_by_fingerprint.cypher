// name: source_by_fingerprint
// owner: 005
// mode: read
// params: $ownerId (string), $fingerprint (string)
// returns: sourceId, taskId, taskStatus
// The caller's own upload with this text, if any (per owner: another owner's identical text is not a duplicate).
// taskId and taskStatus are null when an earlier request died between the source write and the task write.
MATCH (:Learner {id: $ownerId})-[:OWNS]->(s:Source {fingerprint: $fingerprint})
OPTIONAL MATCH (t:Task {kind: 'ingest'})-[:CONCERNS]->(s)
RETURN s.id AS sourceId, t.id AS taskId, t.status AS taskStatus
LIMIT 1
