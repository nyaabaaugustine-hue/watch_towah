"use client";

import { type DBSchema, type IDBPDatabase, openDB } from "idb";

/**
 * Offline ping queue.
 *
 * Location reporting is the one thing this app must never silently drop. A phone
 * that walks into a tunnel or onto a dead 2G edge will fail the POST, and a
 * failed POST that is simply forgotten leaves a guardian watching a stale dot
 * with no indication anything is wrong. So every ping that cannot be sent is
 * written to IndexedDB and retried on reconnect.
 *
 * Queued pings are deliberately capped: on a long outage a phone can accumulate
 * thousands of points, and replaying all of them at once would burn the data
 * the user is trying to conserve. The oldest are discarded first, because
 * during an outage the most recent fix is the one that matters.
 */

const DATABASE_NAME = "watchtower-location";
/**
 * Bump when the shape below changes; `upgrade` creates the new store.
 *
 * Version 2 added `clientId`. Anything queued under version 1 has no such key and
 * therefore cannot be replayed safely, so the upgrade empties the store rather
 * than sending breadcrumbs the server would have to treat as fresh readings.
 * The discarded fixes are the oldest in the queue by construction, and the trail
 * resumes from the next capture, which is the right trade for a safety app.
 */
const DATABASE_VERSION = 2;
const PING_STORE = "pending-pings";
/** Roughly an hour of background pings at the default interval. */
const MAX_QUEUED_PINGS = 60;

export type QueuedPing = {
  id?: number;
  lat: number;
  lng: number;
  accuracy: number | null;
  batteryLevel: number | null;
  source: "background" | "manual" | "journey" | "sos" | "shared";
  recordedAt: string;
  /**
   * Idempotency key for this reading.
   *
   * Generated once when the ping is first captured and carried unchanged through
   * every retry, so the server can recognise a re-send of a row it already has.
   * Without it, a response lost on a weak connection is indistinguishable from a
   * request that never arrived, and the retry stores a second breadcrumb at the
   * same instant.
   */
  clientId: string;
};

interface WatchtowerLocationDb extends DBSchema {
  "pending-pings": {
    key: number;
    value: QueuedPing;
    indexes: { "by-recorded-at": string };
  };
}

let databasePromise: Promise<IDBPDatabase<WatchtowerLocationDb>> | null = null;

const database = (): Promise<IDBPDatabase<WatchtowerLocationDb>> => {
  databasePromise ??= openDB<WatchtowerLocationDb>(DATABASE_NAME, DATABASE_VERSION, {
    upgrade(db, oldVersion) {
      // Only create the store when it is genuinely absent. A fresh `upgrade` for
      // an existing version would otherwise throw on a repeat open.
      if (!db.objectStoreNames.contains(PING_STORE)) {
        const store = db.createObjectStore(PING_STORE, {
          keyPath: "id",
          autoIncrement: true,
        });
        store.createIndex("by-recorded-at", "recordedAt");
        return;
      }

      if (oldVersion < 2) {
        // v1 rows have no clientId and cannot be retried idempotently.
        db.transaction(PING_STORE, "readwrite").objectStore(PING_STORE).clear();
      }
    },
  });

  return databasePromise;
};

/** True when this browser can queue at all. Private mode can refuse IndexedDB. */
const queueAvailable = (): boolean =>
  typeof window !== "undefined" && typeof window.indexedDB !== "undefined";

/**
 * Store a ping that could not be sent.
 *
 * Never throws: losing the queue is bad, but crashing a background location
 * timer because storage is unavailable is worse. The caller is expected to treat
 * this as best-effort.
 *
 * @returns True when the ping was queued.
 */
export const queuePing = async (ping: QueuedPing): Promise<boolean> => {
  if (!queueAvailable()) {
    return false;
  }

  try {
    const db = await database();
    const tx = db.transaction(PING_STORE, "readwrite");
    await tx.store.add(ping);

    const count = await tx.store.count();
    if (count > MAX_QUEUED_PINGS) {
      // Trim from the front: during an outage the newest fix is the useful one.
      const keys = await tx.store.index("by-recorded-at").getAllKeys();
      for (const key of keys.slice(0, count - MAX_QUEUED_PINGS)) {
        await tx.store.delete(key);
      }
    }

    await tx.done;
    return true;
  } catch (cause) {
    console.error("could not queue location ping", { cause });
    return false;
  }
};

export const queuedPingCount = async (): Promise<number> => {
  if (!queueAvailable()) {
    return 0;
  }

  try {
    const db = await database();
    return db.count(PING_STORE);
  } catch {
    return 0;
  }
};

/**
 * True while this tab is already draining.
 *
 * Two tabs on the same device both fire on the `online` event. Without a guard
 * they each read the queue, both send every ping, and both then delete, so the
 * backlog is uploaded twice and the server has to dedupe it. A module-level flag
 * is enough here: the race that matters is same-device tabs, and `online` fires
 * per window. A `navigator.locks` claim would close the gap properly, but it is
 * not available in every browser this app supports and a module flag degrades to
 * merely a performance cost rather than a crash.
 */
let draining = false;

/**
 * Oldest-first queue drain.
 *
 * Order matters: replaying breadcrumbs backwards would draw a line that jumps
 * through walls. Stops at the first failure and leaves the rest queued, so a
 * server that is genuinely down does not get hammered by the whole backlog.
 *
 * @param send Called for each ping. Returning false stops the drain.
 * @returns How many pings were handed off successfully.
 */
export const drainQueue = async (
  send: (ping: QueuedPing) => Promise<boolean>,
): Promise<number> => {
  if (!queueAvailable() || draining) {
    return 0;
  }

  draining = true;
  let sent = 0;

  try {
    const db = await database();
    const entries = await db.getAllFromIndex(PING_STORE, "by-recorded-at");

    for (const entry of entries) {
      if (entry.id === undefined) {
        continue;
      }

      // Rebuilt explicitly so the IndexedDB auto-increment key is never sent to
      // the server as if it were a field the API understands. `clientId` is
      // carried through deliberately: it is the field that makes this retry
      // recognisable as the same reading.
      const ping: QueuedPing = {
        lat: entry.lat,
        lng: entry.lng,
        accuracy: entry.accuracy,
        batteryLevel: entry.batteryLevel,
        source: entry.source,
        recordedAt: entry.recordedAt,
        clientId: entry.clientId,
      };
      const ok = await send(ping);

      if (!ok) {
        break;
      }

      await db.delete(PING_STORE, entry.id);
      sent += 1;
    }
  } catch (cause) {
    console.error("could not drain location queue", { cause });
  } finally {
    draining = false;
  }

  return sent;
};

/** Drop everything. Used when the user signs out or clears location history. */
export const clearQueue = async (): Promise<void> => {
  if (!queueAvailable()) {
    return;
  }

  try {
    const db = await database();
    await db.clear(PING_STORE);
  } catch (cause) {
    console.error("could not clear location queue", { cause });
  }
};
