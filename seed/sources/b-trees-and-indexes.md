# How B-trees make indexes fast

A table with ten million rows can still answer a simple lookup in a few milliseconds. The reason is a careful data structure, not faster hardware. This text explains how Indexes work, why most of them are built as B-trees, and what they cost when data changes.

## Pages and the buffer pool

A database does not read single rows from disk. It stores data in fixed-size units called pages, and every read or write moves a whole page. Pages used recently are kept in a region of memory called the buffer pool. If a query needs a page that is in the buffer pool, the answer comes from memory. If the page is missing, the database must perform disk I/O, which is many times slower.
## Filtering with WHERE

Most queries narrow a table with a condition. Filtering with WHERE keeps only the rows for which the condition is true. Without help, the database cannot know which rows match, so it reads every page of the table and tests each row. This is called a full table scan. On a small table a scan is fine. On a large table it is slow, because the cost grows with the number of pages.

## B-trees

A B-tree is a tree whose nodes are pages. Each node holds a list of keys in sorted order, with pointers to child nodes. Three properties make it useful.

First, the keys are sorted. A search compares the wanted value with the keys in a node, decides which child can contain it, and descends. A range of values, such as all orders between two dates, sits together and can be read in sequence.

Second, the tree is balanced. Every leaf is at the same depth, so no lookup is much longer than any other.

Third, each node is wide. One page can hold hundreds of keys, so the tree is shallow. A B-tree with three or four levels can address millions of rows. A lookup visits one node per level, so the number of nodes visited is proportional to the logarithm of the number of keys.
### Node splits

When a row is inserted, its key must go into the correct leaf. If the leaf has room, the key is added in sorted position. If the leaf is full, the node splits into two nodes, each holding about half of the keys, and a separating key moves up into the parent. If the parent is full it splits as well, and the change can travel up to the root. When the root splits, the tree grows one level taller. Because growth happens at the top, all leaves stay at the same depth.

## Indexes

An index is an extra structure kept next to a table. It stores the values of one or more columns in a B-tree, and each entry points to the row that holds the value. When a query filters on an indexed column, the database walks down the tree to the first matching entry and follows the pointers, which avoids the full table scan. Most relational databases build their default index as a B-tree, because single-value lookups are fast and ranges come out in order.

### The write cost

Indexes are not free. Each index is a separate B-tree that must stay in step with the table. An insert, a change to an indexed column, or a delete must update the table and every index on it, and each update may cause a node split. A table with many indexes therefore has slower writes and uses more disk space.
## Composite indexes

A composite index covers more than one column, for example the pair (country, city). Its entries are sorted by country first, and within one country by city. This ordering decides what the index can do. A filter on country alone can use it, because all entries for one country sit together. A filter on city alone cannot, because the cities of different countries are scattered through the tree. This is the leftmost-prefix rule: a composite index can be used only from its first columns onward. Put the column you filter on most often first.

## Query planning

The database does not always use an index just because one exists. The query planner lists the possible ways to run a query and estimates the cost of each, usually from statistics about the table. It then picks the cheapest plan. If a filter matches most of the table, reading everything in order can be cheaper than jumping through an index for each row, so the planner chooses the scan. If the filter matches a handful of rows, the index wins by a wide margin.

## Summary

Pages and the buffer pool make disk access the main cost. B-trees keep keys sorted and balanced, so a lookup touches a number of pages proportional to the logarithm of the table size. Indexes use that structure to avoid full table scans, at the price of slower writes. Composite indexes extend the idea to several columns under the leftmost-prefix rule, and query planning decides whether an index is worth using.
