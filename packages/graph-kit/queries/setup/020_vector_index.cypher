CREATE VECTOR INDEX FOR (c:Chunk) ON (c.embedding)
OPTIONS {dimension: $dim, similarityFunction: 'cosine'}
