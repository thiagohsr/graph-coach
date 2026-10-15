// name: create_learner
// owner: 002
// mode: write
// params: $id (string), $displayName (string), $createdAt (integer)
// returns: id, displayName, createdAt, created
MERGE (l:Learner {id: $id})
ON CREATE SET l.displayName = $displayName, l.createdAt = $createdAt
RETURN l.id AS id, l.displayName AS displayName, l.createdAt AS createdAt,
       l.createdAt = $createdAt AS created
