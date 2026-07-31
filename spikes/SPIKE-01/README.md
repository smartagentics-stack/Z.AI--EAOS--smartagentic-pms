# SPIKE-01: Offline LAN Synchronization

**Status:** Run 1 complete (REVISE), Run 2 pending (with replay fix)
**Owner:** Engineering Office

## Research Question
Can two PMS clients sync via LAN with zero data loss using SQLite + TCP?

## Run 1 Results (before replay fix)
- Duration: 3600s (1 hour)
- Duplicates: 0 ✅
- Latency p95: 1ms ✅
- Data loss: 59 records ❌ (root cause: no replay on reconnect)
- Endurance: 3600s, 0 crashes ✅
- Recommendation: REVISE

## Run 1 Root Cause
59 records written by Client A during network interruptions were never synced to Client B. The sync protocol only pulled from peer on reconnect; it did not push queued writes.

## Fix Applied (Phase 4)
Added `replayQueuedRecords()` function in sync-client.ts. On reconnect, client now:
1. Replays all local records with sequenceNumber > peerLastSequence
2. Sends sync_request to pull peer's missed records
This makes sync bidirectional on reconnect.

## Run 2 (pending)
Same workload, same interruption frequency, same duration. Expected: 0 data loss.
