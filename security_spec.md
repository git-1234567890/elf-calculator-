# Security Specification — Elf Calculator Global Leaderboard

## 1. Data Invariants
1. **Unique Per-User Per-Puzzle Entry**: Every document in `/leaderboardEntries/{entryId}` uses the deterministic key `{puzzleId}_{uid}`, binding the entry permanently to `request.auth.uid` and a valid `puzzleId` (`1..1000`).
2. **Verified Users Only for Writes**: Creating, updating, or deleting a leaderboard entry requires `request.auth != null` and `request.auth.token.email_verified == true`.
3. **No PII Exposure**: Public leaderboard entries never store `email`, `phone`, or private credentials; only `displayName` (1–60 chars), `uid`, `puzzleId`, `steps`, `parSteps`, and server timestamps.
4. **Monotonic Improvement & Immutability**: `uid`, `puzzleId`, and `createdAt` are immutable after creation. Updates only allow modifying `displayName`, `steps`, `parSteps`, and `updatedAt`, and require `incoming().steps <= existing().steps`.
5. **Strict Server Timestamps**: `createdAt` and `updatedAt` must equal `request.time` on creation, and `updatedAt` must equal `request.time` on updates.
6. **Bounded Payloads & IDs**: All document IDs match `^[a-zA-Z0-9_\-]+$` (`<= 128` chars), `steps` is bounded `1..500`, `puzzleId` is bounded `1..1000`, and unknown/shadow keys are rejected via `hasOnly()`.

## 2. Dirty Dozen Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Unauthenticated Write**: `create` on `/leaderboardEntries/1_userA` with `request.auth == null`.
2. **Unverified Email Write**: `create` with `request.auth.token.email_verified == false`.
3. **UID Spoofing on Create**: `create` on `/leaderboardEntries/1_victimUid` with `incoming.uid == "victimUid"` while signed in as `"attackerUid"`.
4. **ID-Field Mismatch**: `create` on `/leaderboardEntries/99_attackerUid` with `incoming.puzzleId == 1`.
5. **Shadow / Ghost Field Injection**: `create` including extra key `{ isAdmin: true }` or `{ email: "leak@example.com" }`.
6. **Out-of-Range Puzzle ID**: `create` with `puzzleId: 9999` or `puzzleId: 0`.
7. **Zero / Negative Step Cheat**: `create` with `steps: 0` or `steps: -5`.
8. **Client-Spoofed Timestamp**: `create` with `createdAt` set to a past client `Timestamp` instead of `request.time`.
9. **Oversized Display Name (DoW)**: `create` with `displayName` length 200 chars (`> 60`).
10. **Cross-User Update**: `update` on `/leaderboardEntries/1_victimUid` while signed in as `"attackerUid"`.
11. **Immutable Field Tampering**: `update` changing `puzzleId` or `createdAt` or `uid`.
12. **Score Regression / Invalid Type**: `update` setting `steps` to a larger number (`incoming.steps > existing.steps`) or string `"3"`.
