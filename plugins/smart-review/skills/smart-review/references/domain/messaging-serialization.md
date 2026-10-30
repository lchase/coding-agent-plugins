# Domain: messaging / serialization

Injected into **security**, **correctness**, and **spec-conformance** when the diff changes a DTO, event, or message that crosses a process boundary: Kafka/SQS/PubSub producers and consumers, websocket or RPC payloads, event schemas, golden JSON fixtures, `@Json*`/`pydantic`/`serde` models.

## → security

- **Every ingress, not one handler.** List each place the type is deserialized (each consumer, socket handler, HTTP body, test or admin API). A field the server must own is only safe if every one of them drops or overwrites it before use (`ingress-gap`).
- **The window before the overwrite.** If the server overwrites a client-supplied field later in the flow, what reads, persists, or logs the message before that point? Error paths and "ignored message" copies are the usual leaks.

## → correctness

- **Old and new readers.** During a rolling deploy, old consumers see new payloads and new consumers see old ones. Is an unknown field ignored on the old side? Does a missing field read as the right default on the new side? Is rollback safe for rows or events already written with the new value?
- **Default omitted on the wire.** Omitting a field when it equals its default keeps payloads stable, but readers then cannot tell "false" from "producer never set it" (`sentinel-ambiguity`).
- **Every producer sets the new field.** Retry, timeout, synthetic, and error-path producers often build the message by hand and miss it (`incomplete-propagation`).

## → spec-conformance

- **Schema change is a contract change.** A new or changed field on an event that downstream teams consume needs the schema registry, golden fixture, or doc of record updated, and a "byte-identical" claim needs a test that pins the bytes (`false-claim` if it does not hold).
