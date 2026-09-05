/**
 * Realtime notification fan-out substrate barrel.
 *
 * NOTE: `ioredis-fanout-client` is deliberately NOT re-exported here. The
 * selection factory imports it lazily so ioredis never loads in
 * in-process/test import graphs; re-exporting it statically would undo that.
 * Deep-import `@/backend/services/notifications/realtime/ioredis-fanout-client`
 * only where the concrete client is genuinely needed.
 */
export * from "./fanout-transport";
export * from "./fanout-transport.factory";
export * from "./in-process-transport";
export * from "./redis-pubsub-transport";
