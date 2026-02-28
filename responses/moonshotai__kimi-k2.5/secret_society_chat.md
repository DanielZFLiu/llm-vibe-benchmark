**Secret Society: System Design Document**

*A self-hosted, invite-only, end-to-end encrypted chat platform for trusted communities of ≤1,000 members.*

---

## 1. Architecture Overview

### Philosophy
The architecture prioritizes **operational simplicity** over hyperscale resilience. A single VPS (2 vCPU, 4GB RAM, 40GB SSD) is sufficient. All state fits on one host; there are no distributed systems to debug at 2 AM.

### Component Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                         VPS Host                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │    Caddy     │  │   Go App     │  │   PostgreSQL     │   │
│  │   (TLS/RP)   │──│   (Stateless)│──│   (Persistent)   │   │
│  └──────────────┘  └──────┬───────┘  └──────────────────┘   │
│         │                 │          ┌──────────────────┐   │
│         │                 └──────────│      Redis       │   │
│         │                            │  (PubSub/Cache)  │   │
│         │                            └──────────────────┘   │
│         └───────────────────────┐                            │
│                                 ▼                            │
│                      ┌──────────────────┐                    │
│                      │  MinIO (Optional)│                    │
│                      │  (Object Store)  │                    │
│                      └──────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
           ▲                                    │
           │         TLS 1.3                    │
           └────────────────────────────────────┘
                    [Clients: Web/Electron/Mobile]
```

### Technology Choices

| Component | Choice | Justification |
|-----------|--------|---------------|
| **Reverse Proxy** | Caddy | Automatic HTTPS via Let's Encrypt; single static binary; config via Caddyfile. Eliminates certbot cron jobs. |
| **Application** | Go (stdlib `net/http` + `gorilla/websocket`) | Single static binary deployment; memory-safe; easy cross-compilation for ARM (Raspberry Pi fallback hosting). |
| **Database** | PostgreSQL 15 | Relational integrity for invite trees (closure table); ACID compliance for message queueing; familiar to many self-hosters. |
| **Cache/Queue** | Redis | Ephemeral message TTLs, presence pub/sub, rate-limit counters. Data loss acceptable (reconstructible). |
| **Object Storage** | MinIO (or filesystem) | S3-compatible for encrypted file blobs. Can be disabled to reduce complexity (store files as blobs in PG). |
| **Client** | React + Electron | Cross-platform desktop; mobile can use React Native sharing crypto core. |

**Trade-off:** We accept that the server sees metadata (who talks to whom) to avoid the operational complexity of a mix network like Tor or Pond. For a 1,000-person society, the threat model assumes the operator is trusted to *run* the server but not to *read* content.

---

## 2. End-to-End Encryption Design

We implement the **Signal Protocol** (X3DH + Double Ratchet) using `libsodium` primitives. This provides forward secrecy, future secrecy, and deniability.

### Key Hierarchy

| Key | Type | Rotation | Storage |
|-----|------|----------|---------|
| **IK** (Identity) | X25519 long-term | Never (unless compromise) | Client device only; seed encoded in 24-word BIP39 recovery phrase |
| **SPK** (Signed PreKey) | X25519 medium-term | Weekly | Server stores public key; client holds private |
| **OPK** (One-Time PreKeys) | X25519 ephemeral | Per-use | Server stores 100 public keys; client generates batch |
| **GK** (Group Key) | X25519 symmetric | Per-message chain | Derived per group; never touches server plaintext |

### 1:1 Conversation Establishment (X3DH)

1.  **Alice** fetches Bob's `IK_B`, `SPK_B`, and one `OPK_B` from the server.
2.  Alice generates an ephemeral key `EK_A`.
3.  **Shared Secret** `SK` is derived via X25519 scalar multiplication of four keys (IK_A + EK_A combined with IK_B + SPK_B + OPK_B).
4.  Alice sends the public components of `EK_A` and the ID of used `OPK_B` to Bob (wrapped in a `KeyExchange` message).
5.  Both initialize a **Double Ratchet** (KDF chain) using `SK`.
6.  **Forward Secrecy:** Each message advances the chain key. Compromising `IK_A` or `IK_B` does not reveal past messages because `SK` included ephemeral `EK_A` and `OPK_B` (deleted after use).

### Group Conversations (Sender Keys)

For groups up to 50 members, pairwise Double Ratchet is too slow (O(n²) key exchanges).

1.  **Group Creation:** Creator generates a random 32-byte `GroupKey` (GK).
2.  **Distribution:** Creator sends GK to each initial member via their 1:1 Double Ratchet channels.
3.  **Messaging:** Each message is encrypted with `AES-256-GCM` using the current GK-derived message key. The ratchet updates locally per sender (each sender maintains their own chain within the group).
4.  **Membership Changes:**
    *   **Add:** Existing member sends current GK to new member via 1:1.
    *   **Remove:** Server triggers a "rotate keys" event to all remaining members. Each generates new GK, encrypts to others, and abandons old GK. This ensures removed members cannot read future messages.

### Message Storage & Retrieval

The server is a **dumb encrypted blob store**.

```json
{
  "message_id": "uuid",
  "conversation_id": "uuid",
  "sender_id": "user_uuid",
  "ciphertext": "base64(aes_gcm(payload))",
  "header": {
    "ephemeral_ttl": 86400,
    "key_id": "chain_key_index"
  },
  "timestamp_server": "2024-01-01T00:00:00Z"
}
```

*   **Payload** contains the actual text/files, encrypted with the Double Ratchet output key.
*   **Server Actions:** Stores blob, enforces TTL (Redis expiry), routes to recipient WebSockets if online.

### Key Recovery & Multi-Device

**Deliberate Trade-off:** We support **single active device per user** to reduce complexity. Multi-device sync is a support nightmare for self-hosters.

*   **Backup:** During registration, the client displays a **24-word recovery phrase** (BIP39 encoding of the `IK` private key seed).
*   **Migration:** User installs app on new device, enters phrase. New device generates new `SPK`/`OPK` and uploads them, invalidating old device's prekeys (old device loses access).
*   **No Server Backup:** The server never holds key material that could decrypt messages.

---

## 3. Invite System

The invite system must create an auditable chain without allowing the server to forge invites (preventing Sybil attacks by a malicious admin).

### Lifecycle

**1. Generation (Client-Side)**
```text
invite_secret = random(32 bytes)
invite_code   = base64url(invite_secret)
invite_hash   = SHA-256(invite_secret)  // Stored on server
```

**2. Server Registration**
Inviter's client sends to server:
```json
{
  "invite_hash": "abc123...",
  "inviter_id": "user_uuid",
  "created_at": "timestamp",
  "signature": "sig_inviter(invite_hash || timestamp)"
}
```
*   Server verifies signature with inviter's `IK`.
*   Server stores `invite_hash`, `inviter_id`, expiry (30 days), `redeemed_by: null`.
*   **Rate Limit:** Max 5 pending invites per user (enforced by Redis counter).

**3. Delivery**
Inviter sends `invite_code` to prospective member via **out-of-band channel** (Signal, PGP email, in-person QR code). Server never sees the code, only the hash.

**4. Redemption**
New user submits `invite_code` during registration. Server hashes it, looks up `invite_hash`, marks `redeemed_by = new_user_id`, and records timestamp.

**5. Audit Trail (Invite Tree)**
PostgreSQL closure table pattern:
```sql
CREATE TABLE invite_tree (
  ancestor_id UUID REFERENCES users(id),
  descendant_id UUID REFERENCES users(id),
  depth INT,
  PRIMARY KEY (ancestor_id, descendant_id)
);
```
*   On redemption, insert rows for every ancestor (O(depth) writes; acceptable for depth < 20 in 1k user society).
*   **Admin Query:** "Who invited user X?" → direct parent. "All descendants of user Y?" → closure table query.

### Revocation & Removal

*   **Unused Invite:** Inviter or admin posts `invite_hash` to `/revoke`. Server marks revoked; redemption fails.
*   **Member Removal:**
    *   Admin suspends user in DB.
    *   Server notifies all groups containing user to trigger Sender Key rotation (see §2).
    *   User's client certificates (WebSocket auth tokens) are invalidated via Redis blacklist.
    *   **Chain Integrity:** The invite tree row remains; we add `removed_at` timestamp. The audit trail persists even if membership is revoked.

### Abuse Prevention

| Attack | Defense |
|--------|---------|
| **Mass Generation** | Redis rate limit (5 invites/hour/user) |
| **Replay** | `invite_hash` marked used atomically in PG transaction |
| **Transfer** | Invites are bearer tokens; design limitation. Mitigated by short expiry (7 days). |
| **Server Forgery** | Invites signed by inviter's `IK`; admin cannot forge valid signatures without private key. |

---

## 4. Data Model

### Schema (PostgreSQL)

**Plaintext (Server Readable):**
```sql
-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(32) UNIQUE NOT NULL,  -- Public handle
    identity_key_pub BYTEA NOT NULL,       -- X25519 public key
    signed_prekey_pub BYTEA NOT NULL,
    prekey_signature BYTEA NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    recovery_phrase_hash BYTEA,            -- Argon2id of recovery phrase (for verification only)
    is_admin BOOLEAN DEFAULT false,
    suspended_at TIMESTAMPTZ
);

-- One-Time PreKeys (public only)
CREATE TABLE prekeys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    key_id INT NOT NULL,                   -- Sequence number
    public_key BYTEA NOT NULL,
    UNIQUE(user_id, key_id)
);

-- Invite Tree (Closure Table)
CREATE TABLE invite_relations (
    ancestor_id UUID REFERENCES users(id),
    descendant_id UUID REFERENCES users(id),
    depth INT CHECK (depth > 0),
    created_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (ancestor_id, descendant_id)
);

-- Conversations (metadata only)
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(10) CHECK (type IN ('dm', 'group')),
    created_at TIMESTAMPTZ DEFAULT now(),
    encrypted_subject BYTEA,               -- Group name, encrypted by GK
    creator_id UUID REFERENCES users(id)
);

-- Conversation Membership
CREATE TABLE members (
    conversation_id UUID REFERENCES conversations(id),
    user_id UUID REFERENCES users(id),
    joined_at TIMESTAMPTZ DEFAULT now(),
    role VARCHAR(10) DEFAULT 'member',
    PRIMARY KEY (conversation_id, user_id)
);
```

**Encrypted/Opaque (Server Opaque Blobs):**
```sql
-- Messages
CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id),
    sender_id UUID REFERENCES users(id),
    ciphertext_payload BYTEA NOT NULL,     -- Opaque Double Ratchet payload
    ephemeral_ttl INT DEFAULT 0,           -- Seconds until hard delete (0 = never)
    server_timestamp TIMESTAMPTZ DEFAULT now(),
    client_timestamp TIMESTAMPTZ          -- For ordering, untrusted
);

-- Delivery Receipts (metadata only, encrypted payload indicates read status)
CREATE TABLE receipts (
    message_id UUID REFERENCES messages(id),
    user_id UUID REFERENCES users(id),
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    PRIMARY KEY (message_id, user_id)
);

-- Pending Invites
CREATE TABLE invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invite_hash BYTEA UNIQUE NOT NULL,     -- SHA-256 of secret
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    redeemed_by UUID REFERENCES users(id),
    redeemed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ
);
```

**Redis (Ephemeral):**
*   `presence:{user_id}` → "online" | "last_seen_timestamp"
*   `typing:{conversation_id}` → Set of user_ids currently typing (expire 10s)
*   `ratelimit:invite:{user_id}` → Counter for invite generation
*   `ws_sessions:{user_id}` → Set of active WebSocket connection IDs

---

## 5. Real-Time Protocol

### Transport: WebSocket (RFC 6455)

**Why:** True bidirectional streaming is required for typing indicators and presence. SSE is unidirectional (can't send from client efficiently). Long-polling introduces latency unacceptable for "online" status.

*   **Protocol:** Binary frames using Protocol Buffers (efficient) or JSON (debuggable). *Recommendation:* Support JSON for easier self-hosting troubleshooting.
*   **Authentication:** Bearer token in subprotocol header `Sec-WebSocket-Protocol: secret-society, <jwt>`.
*   **Heartbeat:** Ping/Pong frames every 30s; server drops connection after 90s silence.

### Message Routing

**Online Delivery:**
1.  Alice encrypts message to Bob using Double Ratchet (1:1) or Group Key.
2.  Alice sends WS frame: `{"type": "message", "to": "conv_uuid", "payload": "<base64_ciphertext>"}`.
3.  Server looks up members of `conv_uuid` (from plaintext `members` table).
4.  Server routes payload to their active WebSocket connections (via Redis pub-sub if horizontally scaled, though single VPS uses in-memory map).
5.  **Server Never Decrypts:** Payload is opaque bytes.

**Offline Queue:**
If Bob is offline, server stores `ciphertext_payload` in `messages` table. When Bob reconnects:
1.  Client sends `{"type": "sync", "since": "last_message_id"}`.
2.  Server returns paginated encrypted blobs.
3.  Client decrypts locally, displays, and sends receipt: `{"type": "receipt", "message_id": "uuid", "status": "read"}`.

### Presence & Typing

*   **Presence:** Client sends `{"type": "heartbeat", "status": "online"}` every 30s. Server updates Redis TTL key. On disconnect, key expires → "last seen" updated in PostgreSQL.
*   **Typing Indicators:** `{"type": "typing", "conversation_id": "uuid", "is_typing": true}`. Server broadcasts to conversation members **without persisting to disk** (ephemeral only).

### Ephemeral Message Implementation

1.  Sender includes `ephemeral_ttl: 3600` in message header.
2.  Server writes to DB with `expires_at = now() + ttl`.
3.  **Cleanup:** PostgreSQL `pg_cron` extension or external cron job runs `DELETE FROM messages WHERE expires_at < now()` every 10 minutes.
4.  **Client Enforcement:** Client apps must respect TTL and auto-delete local copies after viewing. Server cannot enforce client deletion (design limitation), but honest clients comply.

---

## 6. Self-Hosting & Operations

### Deployment: Docker Compose

```yaml
version: '3.8'
services:
  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
  app:
    build: .
    environment:
      - DATABASE_URL=postgres://society:secret@db/society?sslmode=disable
      - REDIS_URL=redis:6379
      - SIGNING_KEY=${SIGNING_KEY}  # HS256 key for JWTs
    depends_on: [db, redis]
  db:
    image: postgres:15-alpine
    volumes:
      - pg_data:/var/lib/postgresql/data
      - ./backups:/backups
    environment:
      - POSTGRES_USER=society
      - POSTGRES_PASSWORD=${DB_PASSWORD}
  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    volumes:
      - minio_data:/data
    environment:
      - MINIO_ROOT_USER=society
      - MINIO_ROOT_PASSWORD=${MINIO_PASSWORD}
```

### External Dependencies

*   **DNS:** A record pointing to VPS IP.
*   **SMTP:** **Not required.** Invites are out-of-band (URL copying).
*   **TLS:** Handled automatically by Caddy + Let's Encrypt.
*   **Backups:** S3-compatible bucket (AWS S3, Backblaze B2, or local MinIO mirror) for daily `pg_dump`.

### Backup & Restore Strategy

**Critical Rule:** The server operator **must not** back up user private keys. Clients hold keys; server holds only public material.

**Automated (Server-side):**
```bash
# Daily cron on host
docker exec society-db pg_dump -U society society | gzip > /backups/society_$(date +%F).sql.gz
rclone sync /backups remote:society-backups
```

**Disaster Recovery:**
*   **Server Destroyed:** Restore PostgreSQL from backup to new VPS. Users reconnect; they have their recovery phrases to regenerate identity keys. They re-verify safety numbers with contacts.
*   **Client Lost:** User enters 24-word recovery phrase on new device. Re-downloads message history (encrypted blobs) from server, decrypts locally.

### Monitoring (Minimal Viable)

Given the "non-infrastructure-specialist" constraint, avoid Kubernetes complexity.

*   **Health Check:** `GET /health` returns DB and Redis connectivity.
*   **Uptime:** UptimeKuma (self-hosted) or Healthchecks.io pings `/health`.
*   **Logs:** `docker-compose logs -f` or `journald` forwarding to simple Loki instance if desired.
*   **Alerts:** Configure UptimeKuma to send email/Telegram if `/health` fails for >5 minutes.

**Admin CLI:**
```bash
# Included in container for manual intervention
docker exec -it society-app ./admin \
  --revoke-user $UUID \
  --list-invite-tree $UUID \
  --rotate-server-keys  # For JWT signing key rotation
```

---

## 7. Threat Model

### Assumptions

*   The server operator is honest but curious (wants to read messages but follows software).
*   Users are technically competent enough to verify safety numbers.
*   The underlying crypto libraries (`libsodium`, Go `crypto/subtle`) are secure.

### What a Malicious Server Operator Can Observe

| Observable | Mitigation | Limitation |
|------------|------------|------------|
| **Social Graph** | Server sees `conversation_members` and `invite_tree`. | Unavoidable without mix networks. Acceptable for this threat model. |
| **Timing Metadata** | Server sees when Alice sends to Bob. | No latency padding implemented (too complex). |
| **Message Sizes** | Traffic analysis possible (e.g., large file vs text). | Padding could be added; deferred for simplicity. |
| **Active Hours** | Server sees login/logout patterns. | Use VPN/Tor if critical. |

### What a Malicious Server Operator **Cannot** Do

*   **Decrypt Content:** Cannot read messages without private keys (never on server).
*   **Forge Invites:** Cannot create valid invite signatures without inviter's private `IK`.
*   **Impersonate Users:** Cannot sign messages as Alice without Alice's private keys.
*   **MITM (if users verify):** If Alice and Bob compare safety numbers (fingerprint of shared secrets) out-of-band, server cannot perform active interception.

### Database Exfiltration Impact

*   **Attacker Gains:** All `ciphertext_payload` blobs, public keys, social graph, invite tree.
*   **Attacker Cannot:** Decrypt past messages (forward secrecy via Double Ratchet) or impersonate users (no private keys).
*   **Future Risk:** Attacker could MITM *future* communications by serving their own public keys to new users unless users verify safety numbers.

### Single Device Compromise (Blast Radius)

*   **1:1 Chats:** Attacker can read all future messages and send as user. Cannot read past messages due to Double Ratchet forward secrecy (keys deleted).
*   **Group Chats:** Attacker reads all future group messages. **Mitigation:** When compromise detected, admin removes user; remaining members rotate group keys automatically.
*   **Recovery Phrase:** If written down and not on device, attacker cannot migrate to new hardware.

### Invite System Limitations

*   **Social Engineering:** A malicious member can invite an attacker. The system only ensures the *chain is recorded*, not that invitees are trustworthy.
*   **Server Bypass:** If server is compromised at invite creation time, it could drop the rate limit check. This is detectable post-hoc via audit logs.
*   **Transfer:** Invites are bearer tokens. If Alice posts her invite code on Twitter, anyone can use it. Mitigated by short expiry (7 days) and user education.

---

**Conclusion:** This design provides cryptographic privacy for message content with operational simplicity suitable for a single administrator. The explicit trade-offs—metadata visibility for routing simplicity, single-device for key management sanity—are appropriate for a closed society of 1,000 trusted members rather than a mass-market dissident tool.