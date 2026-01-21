# RUNERA MVP+++ API SPEC (DRAFT)

Base path: `/` (no versioning yet)
Auth: `Authorization: Bearer <token>` for protected endpoints.
Time: ISO8601 UTC. Units: meters, seconds.

## Enums

RunStatus:
- SUBMITTED
- VALIDATING
- VERIFIED
- REJECTED
- ONCHAIN_COMMITTED

RejectReason:
- ERR_DISTANCE_SHORT
- ERR_PACE_IMPOSSIBLE
- ERR_DURATION_SHORT
- ERR_TIMESTAMP_INVALID
- ERR_NO_DEVICE_ATTESTATION
- ERR_NOT_ELIGIBLE
- ERR_EVENT_CLOSED
- ERR_ALREADY_COMPLETED

EventParticipationStatus:
- JOINED
- COMPLETED
- REJECTED

## Error format

```json
{
  "error": {
    "code": "ERR_XXX",
    "message": "Human readable",
    "details": {}
  }
}
```

## Auth

### POST /auth/nonce (optional)
Request:
```json
{ "walletAddress": "0xabc...def" }
```
Response:
```json
{ "nonce": "random-string", "expiresAt": "2025-01-12T12:00:00Z" }
```

### POST /auth/connect
Request:
```json
{
  "walletAddress": "0xabc...def",
  "signature": "0x...",
  "message": "RUNERA login ...",
  "nonce": "random-string"
}
```
Response:
```json
{
  "token": "jwt-or-session",
  "user": {
    "id": "cuid",
    "walletAddress": "0xabc...def",
    "tier": 1,
    "exp": 500,
    "totalDistanceMeters": 20000,
    "runCount": 4,
    "verifiedRunCount": 3,
    "profileTokenId": "123"
  },
  "profileMinted": true,
  "profileMintTxHash": "0x..."
}
```

## Profile

### GET /profile
Auth required.
Response:
```json
{
  "walletAddress": "0xabc...def",
  "tier": 1,
  "exp": 500,
  "totalDistanceMeters": 20000,
  "runCount": 4,
  "verifiedRunCount": 3,
  "profileTokenId": "123",
  "achievements": [
    {
      "achievementId": "cuid",
      "eventId": 1,
      "eventName": "RUNERA Base Genesis 10K",
      "verifiedAt": "2025-01-12T12:00:00Z",
      "verifiedDistanceMeters": 10240,
      "txHash": "0x..."
    }
  ],
  "events": [
    {
      "eventId": 1,
      "status": "JOINED"
    }
  ]
}
```

### GET /profile/public/{wallet}
Public.
Response: same as `/profile` but no auth-only fields.

## Runs

### POST /run/submit
Auth optional for now; `walletAddress` required.
Request:
```json
{
  "walletAddress": "0xabc...def",
  "distanceMeters": 5240,
  "durationSeconds": 1800,
  "startTime": "2025-01-12T11:30:00Z",
  "endTime": "2025-01-12T12:00:00Z",
  "deviceHash": "device-hash"
}
```
Response:
```json
{
  "runId": "cuid",
  "status": "VALIDATING",
  "reasonCode": null
}
```

### GET /run/{id}/status
Auth required.
Response:
```json
{
  "runId": "cuid",
  "status": "VERIFIED",
  "reasonCode": null,
  "validatedAt": "2025-01-12T12:01:00Z",
  "onchainTxHash": "0x...",
  "history": [
    { "status": "SUBMITTED", "createdAt": "2025-01-12T12:00:10Z" },
    { "status": "VALIDATING", "createdAt": "2025-01-12T12:00:11Z" },
    { "status": "VERIFIED", "createdAt": "2025-01-12T12:01:00Z" }
  ]
}
```

## Events

### GET /events
Auth optional (if provided, include eligibility and user status).
Response:
```json
[
  {
    "eventId": 1,
    "name": "RUNERA Base Genesis 10K",
    "minTier": 1,
    "minTotalDistanceMeters": 20000,
    "targetDistanceMeters": 10000,
    "expReward": 500,
    "startTime": "2025-01-15T00:00:00Z",
    "endTime": "2025-01-30T23:59:59Z",
    "active": true,
    "eligible": true,
    "status": "JOINED"
  }
]
```

### POST /events/{id}/join
Auth required.
Response:
```json
{ "eventId": 1, "status": "JOINED" }
```

### GET /events/{id}/status
Auth required.
Response:
```json
{
  "eventId": 1,
  "status": "COMPLETED",
  "completionRunId": "cuid",
  "completedAt": "2025-01-12T12:01:00Z"
}
```

## Verification

### GET /verify/{achievement_id}
Public.
Response:
```json
{
  "achievementId": "cuid",
  "runnerWallet": "0xabc...def",
  "eventName": "RUNERA Base Genesis 10K",
  "verifiedDistanceMeters": 10240,
  "verifiedAt": "2025-01-12T12:01:00Z",
  "rulesetHash": "0x...",
  "validatorVersion": "1.0.0",
  "chainId": 84532,
  "txHash": "0x..."
}
```

## Proof Card

### GET /proof/{achievement_id}/card
Public.
Response: `image/png` binary, 1200x630.
