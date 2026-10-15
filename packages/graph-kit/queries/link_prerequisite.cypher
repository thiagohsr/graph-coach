// name: link_prerequisite
// owner: 005
// mode: write
// params: $fromSlug (string), $toSlug (string), $confidence (float)
// returns: linked
// `from` is the prerequisite. The write repeats the cycle condition so that the check and the write cannot be
// separated by another run. The first confidence is kept on a repeat. linked = false when the guard clause refused (or
// a concept does not exist).
MATCH (a:Concept {slug: $fromSlug}), (b:Concept {slug: $toSlug})
WHERE a.slug <> b.slug AND NOT (b)-[:PREREQUISITE_OF*1..16]->(a)
MERGE (a)-[r:PREREQUISITE_OF]->(b)
  ON CREATE SET r.confidence = $confidence
RETURN count(r) > 0 AS linked
