// name: create_draft_puzzle
// owner: 005
// mode: write
// params: $id (string), $ownerId (string), $sourceId (string), $taskId (string), $name (string), $origin ('upload' | 'prompt'), $now (integer)
// returns: puzzleId, status
// One draft private puzzle per source. Every puzzle 005 creates has a source (an upload or a brief), so YIELDED is
// always written and canReadSource and "share with the source" work the same for both origins.
MATCH (l:Learner {id: $ownerId}), (t:Task {id: $taskId}), (s:Source {id: $sourceId})
MERGE (p:Puzzle {id: $id})
  ON CREATE SET p.name = $name, p.origin = $origin, p.status = 'draft', p.visibility = 'private',
                p.distractors = [], p.createdAt = $now
MERGE (l)-[:OWNS]->(p)
MERGE (t)-[:PRODUCED]->(p)
MERGE (s)-[:YIELDED]->(p)
RETURN p.id AS puzzleId, p.status AS status
