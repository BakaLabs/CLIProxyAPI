import { useCallback, useEffect, useRef, useState } from "react";
import { consumeSSE } from "@/api/sse";
import { requestDB, type RecordFilter } from "@/api/management";
import type { RequestRecord } from "@/api/types";

const MAX_RECORDS = 2000;

export type LiveStatus = "connecting" | "live" | "reconnecting";

export interface LiveRecordsState {
  /** Newest first. */
  records: RequestRecord[];
  status: LiveStatus;
  /** Records received while paused, not yet shown. */
  pending: number;
  live: boolean;
  setLive: (live: boolean) => void;
  /** Drop the shown history and re-attach (fresh backlog). */
  reload: () => void;
  /** Append an older page (fetched with a before_id cursor) under the list. */
  appendOlder: (older: RequestRecord[]) => void;
}

function getRecordKey(r: RequestRecord): string {
  if (r.id && r.id > 0) return `id:${r.id}`;
  if (r.request_id) return `req:${r.request_id}`;
  return `time:${r.requested_at}:${Math.random()}`;
}

function markSeen(seenSet: Set<string>, r: RequestRecord) {
  const key = getRecordKey(r);
  seenSet.add(key);
  if (r.id && r.id > 0) seenSet.add(`id:${r.id}`);
  if (r.request_id) seenSet.add(`req:${r.request_id}`);
}

function isSeen(seenSet: Set<string>, r: RequestRecord): boolean {
  if (r.id && r.id > 0 && seenSet.has(`id:${r.id}`)) return true;
  if (r.request_id && seenSet.has(`req:${r.request_id}`)) return true;
  return seenSet.has(getRecordKey(r));
}

/**
 * Live request-log tail: replays a small backlog from the request database on
 * connect, then appends SSE events. Records are deduplicated by id and request_id
 * because the subscription is attached before the backlog query.
 */
export function useLiveRecords(filter: RecordFilter): LiveRecordsState {
  const [records, setRecords] = useState<RequestRecord[]>([]);
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const [live, setLive] = useState(true);
  const [pending, setPending] = useState(0);
  const [nonce, setNonce] = useState(0);

  const liveRef = useRef(live);
  liveRef.current = live;
  const seen = useRef(new Set<string>());
  const pendingRef = useRef<RequestRecord[]>([]);

  const flushPending = useCallback(() => {
    if (pendingRef.current.length === 0) return;
    const batch = pendingRef.current;
    pendingRef.current = [];
    setPending(0);
    setRecords((previous) => {
      const merged = [...previous];
      for (const record of batch) {
        if (isSeen(seen.current, record)) continue;
        markSeen(seen.current, record);
        merged.unshift(record);
      }
      return merged.slice(0, MAX_RECORDS);
    });
    // setPending/setRecords are stable setters.
  }, []);

  const filterKey = JSON.stringify(filter);
  useEffect(() => {
    seen.current = new Set();
    pendingRef.current = [];
    setRecords([]);
    setPending(0);

    const controller = new AbortController();
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    const buffer: RequestRecord[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleFlush = () => {
      if (flushTimer !== null) return;
      flushTimer = setTimeout(() => {
        flushTimer = null;
        if (buffer.length === 0) return;
        const incoming = buffer.splice(0, buffer.length);
        setRecords((previous) => [...incoming, ...previous].slice(0, MAX_RECORDS));
      }, 150);
    };

    const push = (record: RequestRecord) => {
      if (isSeen(seen.current, record)) return;
      markSeen(seen.current, record);
      if (!liveRef.current) {
        pendingRef.current.push(record);
        setPending(pendingRef.current.length);
        return;
      }
      buffer.unshift(record);
      scheduleFlush();
    };

    const attach = async () => {
      setStatus((current) => (current === "live" ? "reconnecting" : "connecting"));
      // Subscribe first so nothing is missed while the backlog query runs.
      await consumeSSE(
        requestDB.streamPath(filter),
        {
          onOpen: () => setStatus("live"),
          onBacklog: (backlog) => {
            // Backlog arrives oldest-first; show newest first after it.
            setRecords((previous) => {
              const merged = [...previous];
              for (const record of [...backlog].reverse()) {
                if (isSeen(seen.current, record)) continue;
                markSeen(seen.current, record);
                merged.push(record);
              }
              return merged.slice(0, MAX_RECORDS);
            });
          },
          onRequest: push,
          onEnd: (error) => {
            if (controller.signal.aborted) return;
            void error;
            setStatus("reconnecting");
            reconnectTimer = setTimeout(() => void attach(), 2000);
          },
        },
        controller.signal,
      );
    };

    void attach();
    return () => {
      if (flushTimer) clearTimeout(flushTimer);
      controller.abort();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [filterKey, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const appendOlder = useCallback((older: RequestRecord[]) => {
    if (older.length === 0) return;
    setRecords((previous) => {
      const merged = [...previous];
      for (const record of older) {
        if (isSeen(seen.current, record)) continue;
        markSeen(seen.current, record);
        merged.push(record);
      }
      return merged.slice(0, MAX_RECORDS);
    });
  }, []);

  const toggleLive = useCallback(
    (next: boolean) => {
      setLive(next);
      if (next) flushPending();
    },
    [flushPending],
  );

  return { records, status, pending, live, setLive: toggleLive, reload, appendOlder };
}
