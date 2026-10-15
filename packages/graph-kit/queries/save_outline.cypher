// name: save_outline
// owner: 005
// mode: write
// params: $sourceId (string), $outline (JSON string)
// returns: sourceId
// INTERNAL (the pipeline's `outline` step). Stores the planner's outline on a prompt source so that a resumed run goes on
// from it instead of planning again. Overwrites; the same outline twice changes nothing. Internal: no endpoint returns it
// and the admin does not register it. Only a prompt source is matched.
MATCH (s:Source {id: $sourceId, kind: 'prompt'})
SET s.outline = $outline
RETURN s.id AS sourceId
