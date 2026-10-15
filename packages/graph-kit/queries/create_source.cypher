// name: create_source
// owner: 005
// mode: write
// params: $id (string), $ownerId (string), $title (string), $kind (string), $fingerprint (string or null), $content (string or null), $brief (JSON string or null), $now (integer)
// returns: sourceId
// `createdAt` and `kind` are set once, ON CREATE, at submission time: 002's creation_counts counts a user's Source
// nodes by kind and createdAt, so a repeated call must never move them. A null parameter writes no property.
MATCH (l:Learner {id: $ownerId})
MERGE (s:Source {id: $id})
  ON CREATE SET s.title = $title, s.kind = $kind, s.fingerprint = $fingerprint,
                s.content = $content, s.brief = $brief, s.createdAt = $now
MERGE (l)-[:OWNS]->(s)
RETURN s.id AS sourceId
