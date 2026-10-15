// name: remaining_drafts
// owner: 005
// mode: read
// params: $taskId (string)
// returns: remaining, approved, rejected
// Internal: counts the questions a task produced by status; no access check (called after a decision that already
// passed the owner filter).
MATCH (:Task {id: $taskId})-[:PRODUCED]->(q:Question)
RETURN sum(CASE WHEN q.status = 'draft' THEN 1 ELSE 0 END) AS remaining,
       sum(CASE WHEN q.status = 'approved' THEN 1 ELSE 0 END) AS approved,
       sum(CASE WHEN q.status = 'rejected' THEN 1 ELSE 0 END) AS rejected
