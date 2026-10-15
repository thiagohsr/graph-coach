// name: delete_learner
// owner: 002
// mode: write
// params: $id (string)
// returns: deleted
MATCH (l:Learner {id: $id})
OPTIONAL MATCH (l)-[r]-()
WITH l, count(r) AS relCount
WHERE relCount = 0
WITH l, l.id AS id
DELETE l
RETURN count(id) AS deleted
