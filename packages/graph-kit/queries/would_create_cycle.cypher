// name: would_create_cycle
// owner: 005
// mode: read
// params: $fromSlug (string), $toSlug (string)
// returns: wouldCycle
// `from` is the prerequisite. True for a self-link and when `to` already leads to `from`. No row when either concept
// does not exist (the caller treats that as "no cycle"; the link itself then finds nothing to link). The depth bound
// is written into the statement because a parameter cannot be a variable-length bound (spike).
MATCH (a:Concept {slug: $fromSlug}), (b:Concept {slug: $toSlug})
OPTIONAL MATCH p = (b)-[:PREREQUISITE_OF*1..16]->(a)
RETURN a.slug = b.slug OR p IS NOT NULL AS wouldCycle
LIMIT 1
