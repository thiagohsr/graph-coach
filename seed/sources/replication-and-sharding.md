# Replication and sharding

A single database server has limits. It can fail, run out of disk, or be too busy to answer every request. Replication keeps copies of the data on several servers. Sharding divides the data so that each server holds only a part. They solve different problems and are often used together.

## Leader and follower replication

The most common design has one leader and one or more followers. The leader accepts every write and records each change in its log. The followers read that log and apply the same changes in the same order, so each ends up with a copy of the leader's data.

Any server can answer reads. Sending read-only queries to followers spreads the load, which suits applications that read far more than they write. Followers also provide safety: if the leader's disk is lost, the data still exists elsewhere, and a copy in another region can survive the loss of a whole site.

## Synchronous and asynchronous copies

The leader must decide when to tell the client that a write is done. With synchronous replication it waits until a follower confirms that it stored the change. The write is slower, but the data is known to exist in two places. With asynchronous replication the leader answers as soon as it has stored the change itself, and followers catch up afterwards. Writes are fast, but a change not yet copied is lost if the leader fails at that moment.

## Replication lag

With asynchronous copies a follower is always slightly behind. The delay between a write on the leader and its appearance on a follower is called replication lag. Usually it is a fraction of a second, but under heavy load it can grow to minutes. Lag causes surprises: a user saves a comment, the page reloads from a follower that has not received it yet, and the comment seems to have vanished. A common remedy is to read a user's own recent writes from the leader.
## Failover

When the leader fails, a follower must be promoted to take its place. The cluster first notices that the leader is gone, usually because it stopped answering heartbeat messages. It then chooses the follower with the most recent data, and finally points the other followers and the clients to the new leader.

Failover is delicate. If the timeout is too short, a leader that is merely slow may be replaced while still alive, and two servers may both believe they are the leader, a situation called split brain. If the chosen follower was behind, the changes it had not received are lost.
## Why replication is not enough

Replication copies everything to every server. Each follower needs enough disk for the complete dataset, and the leader still handles every write. When the data outgrows one machine, or writes exceed what one leader can do, more followers do not help. The data itself must be divided.

## Shard keys

Sharding splits a dataset into pieces called shards and places each on a different server. Each row belongs to exactly one shard, chosen from a shard key, a column or combination of columns in the row. A router looks at the shard key of a query and sends it to the correct server.

There are two common mappings. With range sharding, each shard owns a continuous interval of key values. Range queries stay on one or two shards, but a popular range can become a hot spot. With hash sharding, a hash of the key decides the shard. The load spreads evenly, but neighbouring keys land on different servers, so range queries must ask every shard. A good shard key has many distinct values, spreads traffic evenly, and appears in most queries.

## Rebalancing

Data and traffic change over time. A shard may grow too large, and servers may be added. Moving data between servers to restore an even spread is called rebalancing. Taking the hash modulo the number of servers is a poor scheme, because adding one server changes the assignment of almost every key. Systems instead create many small shards and move whole shards between servers, so only a small part of the data travels.
## Combining the two

In practice each shard is itself replicated. Sharding gives capacity, replication gives availability, and the price is complexity: queries that touch several shards, transactions that span servers, and a failover procedure for every shard.
