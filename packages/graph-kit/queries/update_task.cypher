// name: update_task
// owner: 005
// mode: write
// params: $id (string), $expectedStatuses (list of strings), $patch (map: any of status, result, error, lastCompletedStep), $now (integer)
// returns: taskId, status, result, error, lastCompletedStep
// No row = the task was not in an expected status (the caller lost a race). A null value in $patch removes the
// property (used to clear `error` on retry). Returns the columns the terminal task event needs.
MATCH (t:Task {id: $id})
WHERE t.status IN $expectedStatuses
SET t += $patch, t.updatedAt = $now
RETURN t.id AS taskId, t.status AS status, t.result AS result, t.error AS error,
       t.lastCompletedStep AS lastCompletedStep
