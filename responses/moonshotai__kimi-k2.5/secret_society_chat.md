**Secret Society: System Design Document**

---

## 1. Architecture Overview

### Philosophy
The architecture prioritizes **operational simplicity** for a solo administrator while maintaining **cryptographic rigor**. We trade server-side complexity for client-side logic, ensuring the server remains a "dumb pipe" that routes opaque blobs.

### Component Stack

```
┌─────────────────────────────────────────────────────────────┐
│                         CLIENT                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │   UI (Web/   │  │ Signal Proto │  │ Local Storage    │   │
│  │   Desktop)   │◄─┤ (Double      │◄─┤ (SQLite/IndexedDB│   │
│  │  (React/Elec)│  │  Ratchet)    │  │ + File System)   │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
└──────────┬──────────────────────────────────────────────────┘
           │ WebSocket (WSS) / HTTPS
           ▼
┌─────────────────────────────────────────────────────────────┐
│                        SERVER (Go)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │   Gateway    │  │   Invite     │  │    Admin     │       │
│  │  (WS Router) │  │   Validator  │  │    Panel     │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└──────────┬──────────────────────────────┬───────────────────┘
           │ SQL (TLS)                    │ S3 API (optional)
           ▼                              ▼
┌────────────────────┐          ┌────────────────────┐
│   PostgreSQL 14+   │          │   MinIO (Object)   │
│   (Single Node)    │          │   (Encrypted blobs)│
└────────────────────┘          └────────────────────┘
```

### Technology Justifications

*   **Server: Go (Golang)**: Compiles to a single static binary, trivial to deploy on a VPS. Goroutines handle 1,000 concurrent WebSocket connections effortlessly on modest hardware (2 vCPU/2GB RAM). Strong cryptography standard library.
*   **Database: PostgreSQL**: ACID compliance is critical for the invite chain audit log and preventing race conditions in key distribution. At 1,000 users, a single-node PostgreSQL instance with daily `pg_dump` backups is sufficient; no need for clustering complexity.
*   **Protocol: WebSocket (WSS)**: Provides bidirectional real-time communication without the complexity of WebRTC TURN/STUN servers in a self-hosted context. Falls back to HTTP/2 Server-Sent Events (SSE) if WebSockets are blocked by client firewalls.
*   **Client: React + Electron/Tauri**: Cross-platform desktop deployment with native access to filesystem for local key storage. Tauri is preferred over Electron for smaller binary size and lower memory footprint, but either satisfies the "technically competent admin" constraint.
*   **Object Storage: MinIO (Optional)**: For file attachments. Files are client-side encrypted (AES-256-GCM) before upload, making MinIO a blind storage depot.

---

## 2. End-to-End Encryption Design

We implement the **Signal Protocol (Double Ratchet Algorithm)** with **X3DH** key agreement, adapted for small groups using Sender Keys.

### Key Hierarchy

| Key | Purpose | Storage |
|-----|---------|---------|
| **Identity Key (IK)** | X25519 long-term identity | Client local storage only; public key registered on server |
| **Signed PreKey (SPK)** | X25519 medium-term key (rotated weekly) | Client local; public part on server |
| **One-Time PreKeys (OPK)** | X25519 single-use keys | Client local; public parts uploaded to server (100/pkg) |
| **Sender Key Chain** | Group message encryption | Generated per group; distributed encrypted to members |

### Session Initiation (1:1)

1.  **Key Retrieval**: Alice requests Bob's public key bundle `(IK_b, SPK_b, OPK_b)` from the server.
2.  **X3DH**: Alice calculates a shared secret using her ephemeral key + Bob's IK/SPK/OPK.
3.  **Initial Message**: Alice sends a "pre-key message" containing her IK, ephemeral key, and the index of the used OPK, encrypted with the shared secret.
4.  **Double Ratchet**: Upon decryption, both parties initialize the Double Ratchet with the shared secret, deriving a root key and chain keys for each message direction.

**Forward Secrecy**: Compromising a long-term IK *after* a session ends does not expose past messages because the root key was derived from ephemeral keys (X3DH) and chain keys are ratcheted forward (Double Ratchet). Compromising the current chain key only exposes future messages until the next Diffie-Hellman ratchet step (asymmetric).

### Group Chats (≤50 members)

*   **Sender Keys**: Each member generates a Curve25519 key pair for the group (group identity) and a chain key.
*   **Distribution**: When joining, a member receives the group's sender key encrypted via 1:1 sessions with each existing member.
*   **Messaging**: Members encrypt group messages with the symmetric chain key, then ratchet the key forward. This avoids $O(n)$ encryption overhead for the sender.
*   **Membership Changes**: When a member is removed, the admin (or group creator) distributes a new sender key to all remaining members, excluding the removed one (post-compromise security).

### Message Storage & Retrieval

*   **Payload**: The server stores only `encrypted_payload` (binary blob) + metadata (`sender_id`, `recipient_id`, `timestamp`, `ephemeral_ttl`).
*   **Structure**:
    ```
    {
      "ciphertext": <bytes>,
      "tag": <16 bytes auth tag>,
      "header": {
        "sender_ik": <public key>,
        "message_number": <int>,
        "ratchet_key": <optional DH public key>
      }
    }
    ```
*   **Ephemeral Messages**: The client includes `ephemeral_ttl` (seconds). The server schedules deletion via PostgreSQL `DELETE` with `pg_cron` or lazy expiration on read. Clients must also enforce local deletion upon receipt + TTL.

### Key Restoration (New Device)

**The server never stores private keys.** Restoration requires:
1.  **Recovery Phrase**: BIP-39 mnemonic (24 words) generated on first launch derives the Identity Key seed. Users write this down offline.
2.  **Cross-Signing**: If a user has an existing device, the new device can be verified by scanning a QR code containing a one-time authorization key, establishing a secure channel to sync the Sender Keys for active groups.

### Server Observability

*   **Can Observe**: Who registers, who connects when, message timestamps, byte sizes, group membership lists (IDs only, not content), invite chain graph.
*   **Cannot Observe**: Message plaintext, group conversation content, file contents, contact lists (if encrypted), or read receipt content (encrypted as messages).

---

## 3. Invite System

The invite system must satisfy: **Privacy** (server doesn't know the invitee's identity before redemption), **Auditability** (admins see who invited whom), and **Revocability**.

### Invite Lifecycle

**Generation (Client-side)**
1.  Inviter Alice generates a cryptographically random 256-bit token `T` (the invite secret).
2.  Alice computes `H = SHA-256(T)` (the invite hash).
3.  Alice signs the hash with her Identity Key: `Sig = Sign(IK_alice_priv, H || timestamp || nonce)`.
4.  Alice sends `(H, Sig, timestamp, nonce)` to the server.

**Server Storage**
```sql
invites:
  hash: BYTEA PRIMARY KEY      -- H
  inviter_id: UUID FK          -- Alice
  created_at: TIMESTAMP
  expires_at: TIMESTAMP        -- e.g., now() + 7 days
  revoked_at: TIMESTAMP NULL
  used_by: UUID NULL FK        -- Bob (set on redemption)
  used_at: TIMESTAMP NULL
```

**Transmission**
Alice sends Bob the URL: `https://chat.example.com/join#<base64(T)>`
The fragment (`#...`) is **never sent to the server** when the URL is clicked/loaded.

**Redemption**
1.  Bob's client extracts `T` from the URL fragment.
2.  Bob generates a new Identity Key pair `(IK_bob_pub, IK_bob_priv)`.
3.  Bob computes `H` locally, sends `(H, IK_bob_pub)` to the server.
4.  Server verifies:
    *   `H` exists and `revoked_at IS NULL`
    *   `expires_at > now()`
    *   `used_by IS NULL` (single use)
    *   Verifies `Sig` against stored `inviter_id` public key
5.  On success, server creates user `Bob`, sets `users.invited_by = Alice`, updates `invites.used_by = Bob`.

### Abuse Mitigation

*   **Rate Limiting**: Per-inviter limit of 5 active (unused) invites. Max 3 redemptions per day per inviter.
*   **Non-transferable**: The invite token `T` is single-use. If intercepted and redeemed by Eve, Bob cannot use it (server sees `used_by != NULL`). Bob knows the invite was stolen.
*   **Replay Protection**: The `nonce` in the signature prevents replay of the redemption request.
*   **Revocation**: Alice can request revocation of `H`. Server sets `revoked_at`. Unused tokens become invalid.

### Chain Integrity on Removal

If Alice is revoked/banned:
*   Her row in `users` is marked `is_active = false`.
*   The `invited_by` chain remains immutable for audit purposes (`ON DELETE RESTRICT`).
*   Admins can query the invite tree: Recursive CTE on `users.invited_by` to identify all descendants of a compromised actor.

---

## 4. Data Model

**Plaintext** = Server can read. **Encrypted** = Opaque blob, client only.

### Core Tables

```sql
-- USERS
users:
  id: UUID PRIMARY KEY
  username_hash: BYTEA UNIQUE        -- Argon2id of chosen handle (privacy)
  identity_pubkey: BYTEA             -- X25519 public key (plaintext)
  signed_prekey: BYTEA               -- Current SPK public component
  prekey_signature: BYTEA            -- Sig of SPK by Identity Key
  registration_id: INTEGER           -- Signal Protocol registration ID
  invited_by: UUID NULL FK -> users.id -- Plaintext (audit trail)
  created_at: TIMESTAMP
  last_active: TIMESTAMP
  is_active: BOOLEAN                 -- Soft delete/revoke

-- DEVICES (for multi-device support)
devices:
  device_id: UUID PRIMARY KEY
  user_id: UUID FK -> users.id
  device_name_hash: BYTEA            -- Encrypted blob (name encrypted with device key)
  registration_id: INTEGER
  prekey_bundle_json: JSONB          -- One-time prekeys (public only)

-- INVITES (see Section 3)
invites: [...]

-- GROUPS
groups:
  id: UUID PRIMARY KEY
  creator_id: UUID FK -> users.id
  created_at: TIMESTAMP
  encrypted_state: BYTEA             -- **Encrypted**: Member list, group title, avatar URL
  sender_key_epoch: INTEGER          -- Incremented on member removal

-- GROUP_MEMBERS (Links users to groups, metadata only)
group_members:
  group_id: UUID FK
  user_id: UUID FK
  role: ENUM('admin', 'member')
  joined_at: TIMESTAMP
  encrypted_sender_key: BYTEA        -- **Encrypted**: The group's sender key, encrypted to this user's IK
  PRIMARY KEY (group_id, user_id)

-- MESSAGES
messages:
  id: UUID PRIMARY KEY
  -- Routing metadata (plaintext)
  sender_id: UUID FK -> users.id
  recipient_id: UUID NULL FK -> users.id  -- NULL for group messages
  group_id: UUID NULL FK -> groups.id
  created_at: TIMESTAMP
  
  -- Payload (encrypted)
  ciphertext: BYTEA                  -- **Encrypted**: Signal message body
  ephemeral_ttl: INTEGER             -- Seconds until deletion (0 = permanent)
  expires_at: TIMESTAMP NULL         -- Calculated by server
  
  -- Receipts (plaintext flags, encrypted content)
  delivery_status: ENUM('sent', 'delivered', 'read')
  read_receipt_ciphertext: BYTEA     -- **Encrypted**: Timestamp of read, encrypted to sender

-- PRESENCE (Ephemeral)
presence:
  user_id: UUID PRIMARY KEY
  status: ENUM('online', 'away', 'offline')
  last_seen: TIMESTAMP
  typing_in_group: UUID NULL         -- Plaintext: group ID where typing (privacy trade-off)
  typing_to_user: UUID NULL          -- Plaintext: user ID for DM typing
```

### Media Storage (Optional)

Files are encrypted client-side with a random key (AES-256-GCM), then uploaded.
*   `files` table stores `file_id`, `owner_id`, `size`, `stored_at`, `encrypted_key` (key encrypted to group or recipient).
*   Actual bytes stored in MinIO/filesystem bucket `secret-society-files` with random UUID filename.

---

## 5. Real-Time Protocol

### Transport: WebSocket with MessagePack

*   **Why**: Lower overhead than JSON, binary-native for encrypted blobs.
*   **Connection**: Persistent WSS connection per device.
*   **Authentication**: On connect, client sends `AuthMessage`:
    ```json
    {
      "user_id": "uuid",
      "device_id": "uuid",
      "nonce": "server-issued-challenge",
      "signature": "ed25519(sig of nonce + timestamp)"
    }
    ```
    Server verifies signature against `users.identity_pubkey`, then associates `(user_id, device_id)` with the socket.

### Message Routing (Server as Relay)

1.  **Sending**: Client encrypts payload, wraps in:
    ```json
    {
      "type": "message",
      "to": ["user_uuid", ...],  // or group_id
      "payload": <bytes>,
      "id": "client-generated-uuid"
    }
    ```
2.  **Routing**: Server looks up active sockets for recipient(s). If offline, stores in `messages` table.
3.  **Delivery**: Recipient decrypts locally. Sends ACK:
    ```json
    {"type": "receipt", "msg_id": "...", "status": "delivered"}
    ```
    Server forwards receipt to original sender (who updates UI).

### Presence & Typing

*   **Status**: Heartbeat every 30s. Server broadcasts `presence_update` to users with active 1:1 chats or shared groups.
*   **Typing Indicators**: Client sends `typing_start`/`typing_stop` to server, which fans out to relevant recipients. These are **not encrypted** (metadata leak acceptable for UX), but can be encrypted to group members only if privacy is paramount.

### Offline Sync

*   On reconnect, client requests `sync(since: last_message_timestamp)`.
*   Server returns message IDs and ciphertexts from `messages` where `recipient_id = user` and `created_at > since`.
*   Client decrypts, updates local state, then sends `delete(msg_ids)` to server (if ephemeral) or marks as retrieved.

---

## 6. Self-Hosting & Operations

### Deployment Stack (Docker Compose)

```yaml
version: '3.8'
services:
  app:
    build: .
    environment:
      - DATABASE_URL=postgres://secret:password@db:5432/society
      - REDIS_URL=redis://redis:6379  # For presence/pubsub (optional, can use Postgres LISTEN/NOTIFY)
      - STORAGE_PATH=/data/files
    volumes:
      - ./data:/data
      - ./certs:/certs:ro
    ports:
      - "127.0.0.1:8080:8080"  # Bound to localhost, nginx reverse proxies

  db:
    image: postgres:15-alpine
    volumes:
      - ./postgres-data:/var/lib/postgresql/data
      - ./backups:/backups
    environment:
      - POSTGRES_PASSWORD=password

  nginx:
    image: nginx:alpine
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro  # Certbot
```

### External Dependencies

1.  **DNS**: A record pointing to VPS IP.
2.  **TLS**: Let's Encrypt (Certbot) via Nginx. Auto-renewal via cron.
3.  **SMTP**: Optional. If provided, used for admin alerts (disk full). Not used for invites (preserves privacy).
4.  **Backup Storage**: Rsync.net or S3-compatible bucket for offsite encrypted backups.

### Backup Strategy

*   **Database**: Daily `pg_dump --clean | gzip > /backups/society_$(date +%F).sql.gz`. Retain 14 days locally, sync encrypted copy offsite.
*   **Files**: If using MinIO, `mc mirror` to offsite bucket.
*   **Configuration**: Git repository for `docker-compose.yml`, `.env` (excluding secrets), and Nginx configs.
*   **Key Material**: **Never backed up by admin.** Users responsible for recovery phrases. Admin only backs up public keys and invite chains.

### Monitoring & Alerting (Lightweight)

*   **Metrics**: Prometheus + Grafana (optional container). Track:
    *   `websocket_connections_active`
    *   `messages_per_minute` (count only, not content)
    *   `db_size`, `disk_free`
*   **Logs**: Centralized via Loki or simple `journald`/`syslog`. Log rotation (7 days).
*   **Health Check**: `GET /health` returns 200 if DB and WS hub responsive.
*   **Alerts**: Simple shell script via cron emailing admin if disk >80% or service down.

---

## 7. Threat Model

### Assumptions

*   The server operator is **honest but curious** (wants to read messages but follows protocol) or **compromised**.
*   Users trust their own devices are clean at time of key generation.
*   The invite chain represents a real-world trust relationship.

### What a Malicious Server Can Observe

*   **Metadata**: Social graph (who is in which group, when they talk), message timing, file sizes, IP addresses.
*   **Ciphertext Storage**: Can withhold or delete messages (availability attack), but cannot forge valid signatures or decrypt content.
*   **Active Attacks**:
    *   **Key Substitution**: Server could serve Alice a fake Bob public key (MITM). **Mitigation**: Clients display "Safety Numbers" (fingerprint of Identity Keys) for out-of-band verification.
    *   **Traffic Analysis**: Correlating upload/download times to infer communication patterns.

### Database Exfiltration Impact

*   **Content**: Attacker gains encrypted blobs. Without private keys (stored client-side), plaintext is unrecoverable.
*   **Metadata**: Full exposure of invite tree, usernames (if not hashed), group membership lists (IDs only).
*   **Historical Data**: If Forward Secrecy is maintained, old messages remain secure even if future keys are compromised.

### Device Compromise Blast Radius

*   **Single Device**: Attacker gains access to:
    *   All locally stored messages (since last secure deletion).
    *   Private keys: Can impersonate user and decrypt future messages until detection.
    *   **Containment**: Compromised device cannot decrypt messages sent to user's *other* devices if multi-device is implemented with per-device keys. Group chats must be re-keyed (Sender Key rotation) to exclude the compromised device.
*   **Notification**: Other users see "Safety Number Changed" warning if keys are regenerated.

### Invite System Defenses & Limitations

| Attack | Defense | Not Defended Against |
|--------|---------|---------------------|
| **Mass Generation** | Rate limiting (5 active/inviter) | Compromised trusted member inviting Sybils |
| **Replay** | Single-use hash redemption | |
| **Transfer** | Cryptographic binding to URL fragment | Social engineering (Bob gives URL to Eve) |
| **Server Pre-view** | Hash stored, secret in fragment | Server guesses URL (mitigated by 256-bit entropy) |
| **Chain Obfuscation** | Immutable `invited_by` column | Collusion (Alice invites Eve, claims it was Bob) |

**Limitation**: The system provides **no Sybil resistance** beyond the social trust of the invite tree. If an attacker compromises one member, they gain the ability to invite arbitrarily many malicious accounts. Detection relies on admins auditing the invite tree for anomalous branching.

### Availability Risks

*   **Server Seizure**: If the VPS is seized, service stops. Users retain their keys and message history locally but lose the relay.
*   **Admin Lockout**: If admin loses credentials, they cannot decrypt user data, but cannot manage invites. Recovery requires physical server access or backup restoration.

---

**Trade-offs Explicitly Made:**
1.  **Metadata vs. Complexity**: We accept that the server sees group membership IDs and presence status to avoid the complexity of anonymous routing (Tor) or metadata-private systems (MLS with bespoke infrastructure).
2.  **Key Backup vs. Convenience**: No server-side key escrow. Users must manage recovery phrases or risk data loss.
3.  **Invite Privacy**: The server learns the inviter-invitee relationship *after* redemption. We accept this for the auditability requirement; perfect privacy (blind signatures) would complicate the self-hosted deployment significantly.