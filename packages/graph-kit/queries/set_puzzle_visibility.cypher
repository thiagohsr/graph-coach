// name: set_puzzle_visibility
// owner: 005
// mode: write
// params: $puzzleId (string), $userId (string), $visibility (string: 'public' or 'private')
// returns: id, status, visibility, origin
// No row = unknown puzzle or not owned by the caller (404). A returned status of 'draft' means nothing was changed
// (409). The role half of canPublish is checked by the role guard before this runs. Nothing here touches the source
// or any SHARED_WITH edge.
MATCH (:Learner {id: $userId})-[:OWNS]->(p:Puzzle {id: $puzzleId})
SET p.visibility = CASE WHEN p.status = 'published' THEN $visibility ELSE p.visibility END
RETURN p.id AS id, p.status AS status, p.visibility AS visibility, p.origin AS origin
