// name: cover_concepts
// owner: 005
// mode: read
// params: $ids (list of strings, concept ids)
// returns: id, name, description
// INTERNAL (cover pickup). Concepts are global, so there is no access parameter; only concept fields leave the query.
// Ordered by name so the brief built from them is stable.
MATCH (c:Concept)
WHERE c.id IN $ids
RETURN c.id AS id, c.name AS name, coalesce(c.description, '') AS description
ORDER BY c.name ASC
