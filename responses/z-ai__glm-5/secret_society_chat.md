# System Design: Secret Society

## 1. Architecture Overview

**Philosophy:** Optimize for operational simplicity and a small resource footprint. A monolithic backend architecture is chosen over microservices to reduce deployment complexity and operational overhead. The entire backend runs as a single binary communicating with a database and a cache.

### Technology Stack

| Component | Technology | Justification |
| :--- | :--- | :--- |
| **Client** | React Native (Desktop/Mobile) | Single codebase for all platforms; strong crypto library support (Libsodium/Signal Protocol bindings). |
| **Server** | Go (Golang) | High concurrency for WebSockets, single binary distribution (no runtime dependencies), excellent crypto library support. |
| **Database** | PostgreSQL | Relational data fits the invite tree and audit logs perfectly. Proven reliability, easy backup, JSONB support for flexible metadata. |
| **Cache/PubSub** | Redis | Used solely for transient presence (who is online), typing indicators, and mapping WebSocket connections to users. |
| **Storage** | MinIO (S3-Compatible) | Self-hosted object storage for encrypted file blobs. Runs in the same Docker network. |
| **Reverse Proxy** | Caddy | Automatic HTTPS (Let's Encrypt), simple configuration file. |

### Component Diagram

```text
+----------------+       +------------------------+
|   Client App   |<----->|   Caddy (TLS/HTTPS)    |
| (React Native) |  WS   +-----------+------------+
+----------------+                  |
                                    v
                      +-----------------------------+
                      |      Secret Society API     |
                      | (Go Monolithic Binary)      |
                      | - WebSocket Handler         |
                      | - REST API (Auth/Admin)     |
                      | - Crypto primitives (Verify)|
                      +------+-------+-------+------+
                             |       |       |
              +--------------+       |       +--------------+
              |                      |                      |
      +-------v-------+      +-------v-------+      +-------v-------+
      |   PostgreSQL  |      |     Redis     |      |    MinIO      |
      | (Persistent)  |      | (Transient)   |      | (File Blobs)  |
      +---------------+      +---------------+      +---------------+
```

**What runs where:**
*   **Client:** Handles all key generation, encryption, decryption, and signing. It stores the user's private keys in the local OS Keychain/Keystore.
*   **Server:** Acts as a "dumb pipe" for encrypted messages and a "sheriff" for invite logic. It validates signatures but cannot read message content.

---

## 2. End-to-End Encryption Design

We utilize a protocol heavily inspired by the **Signal Protocol**, adapted for a smaller trusted graph.

### Key Generation & Identity
*   **Identity Key Pair:** Generated upon first install. A Curve25519 public key serves as the user's permanent identity within the society.
*   **Signed Pre-Key:** A medium-term key signed by the Identity Key, rotated periodically (e.g., weekly).
*   **One-Time Pre-Keys:** A pool of ephemeral keys uploaded to the server. Used to ensure uniqueness in session initiation.

### Key Exchange (The X3DH Handshake)
1.  **Initiator (Alice)** fetches Bob's Identity Key, Signed Pre-Key, and a One-Time Pre-Key from the server.
2.  Alice performs the X3DH calculation locally to derive a shared root key.
3.  Alice sends an initial "setup" message to Bob containing her Identity Key and an ephemeral public key.
4.  **Bob**, receiving this, performs the corresponding calculation using his stored private keys to derive the same root key.
5.  **Result:** A shared secret known only to Alice and Bob, authenticated by their long-term identity keys.

### Forward Secrecy (Double Ratchet)
*   Every message sent causes the encryption keys to "ratchet" forward.
*   If a key is compromised, the attacker can only decrypt the current message; they cannot decrypt previous messages because the keys used to derive them have been discarded.
*   If a long-term Identity Key is compromised, an attacker can impersonate the user but cannot decrypt past messages (due to the ephemeral session keys).

### Group Chats
To avoid $O(N)$ encryption cost for large groups (the "Sender Keys" approach):
*   The group creator generates a symmetric **Group Master Key**.
*   This key is encrypted individually for each group member using the 1:1 handshake described above and distributed.
*   Messages are encrypted once with the Group Master Key (AES-256-GCM).
*   When a member leaves or is removed, the Group Master Key is rotated and redistributed by an admin/creator.

### Storage & Retrieval
*   **Storage:** The server stores the `ciphertext`, `nonce`, and `sender_id`. The payload is opaque binary data.
*   **Retrieval:** Clients fetch the blob, decrypt using current ratchet keys.

### Multi-Device / Key Restoration
**Trade-off:** True E2EE makes multi-device support hard without a third-party backup or a "social backup."
*   **Design:** We use an optional **Encrypted Backup** mechanism.
*   Users can export their Identity Key + Ratchet State, encrypted by a user-chosen passphrase (Argon2id derivation).
*   This encrypted blob can be stored on the server or locally.
*   To join a new device, the user imports this backup. *Note: This transfers the full key state; the old device becomes insecure if the backup is compromised.*

---

## 3. Invite System

The goal is to audit the chain while preventing the server from profiling invitees before they join.

### Lifecycle
1.  **Generation:**
    *   Member (Alice) requests an invite code.
    *   Client generates a random `invite_token` (32 bytes).
    *   Client sends `HMAC(alice_private_key, invite_token)` to the server.
    *   **Server Action:** Creates a record `invite_hash = SHA256(invite_token)`, linked to `Alice`'s ID. Marks status `PENDING`.
    *   **Result:** Alice gets a link: `https://society.app/join#<invite_token>`.

2.  **Validation (Privacy):**
    *   The invite link is passed out-of-band (Signal, email, etc.).
    *   Recipient (Bob) clicks the link. The client sends `invite_token` to the server.
    *   Server hashes the received token and checks for a matching `PENDING` record.
    *   *Crucial:* The server does not know *who* Bob is yet. It only knows a valid token was presented.

3.  **Joining & Auditing:**
    *   Bob generates his Identity Key Pair locally.
    *   Bob registers his account, sending his public key and the `invite_token`.
    *   Server validates the token one last time.
    *   Server creates `User` record for Bob.
    *   Server updates the Invite record: `used_by = Bob_ID`, `status = CONSUMED`.
    *   Server records the `inviter_id` (Alice) from the original invite record.

### Revocation & Abuse Prevention
*   **Revocation:** Alice can delete a `PENDING` invite via the Admin API.
*   **Replay Attacks:** The invite token is single-use. Once `status` is `CONSUMED`, the hash is burnt.
*   **Abuse Prevention:**
    *   **Quotas:** Hard limit on active `PENDING` invites per user (e.g., 3).
    *   **Chain Severance:** If a member is banned (Admin revokes membership), the Admin can view the invite tree. If the banned user invited 5 malicious users, the Admin can perform a "Cascading Ban," removing the branch from the tree.

---

## 4. Data Model

*Italicized fields denote client-side encrypted data (opaque to server).*

### `users`
| Field | Type | Notes |
| :--- | :--- | :--- |
| id | UUID | Primary Key. |
| public_key | BYTEA | Curve25519 Public Key. |
| display_name | VARCHAR(255) | Plaintext (or encrypted, depends on privacy model; assuming plaintext for directory usability). |
| avatar_url | VARCHAR | URL to encrypted avatar in MinIO. |
| status | ENUM | `ACTIVE`, `BANNED`. |
| created_at | TIMESTAMP | |

### `invites`
| Field | Type | Notes |
| :--- | :--- | :--- |
| id | UUID | |
| inviter_id | UUID | FK -> users.id. |
| token_hash | BYTEA | SHA256 of the raw invite token. |
| status | ENUM | `PENDING`, `CONSUMED`, `REVOKED`. |
| used_by_id | UUID | FK -> users.id (who joined). |

### `conversations`
| Field | Type | Notes |
| :--- | :--- | :--- |
| id | UUID | |
| type | ENUM | `DIRECT`, `GROUP`. |
| *group_name* | VARCHAR | Encrypted by Group Key (null for direct). |
| created_at | TIMESTAMP | |

### `conversation_members`
| Field | Type | Notes |
| :--- | :--- | :--- |
| conversation_id | UUID | |
| user_id | UUID | |
| role | ENUM | `MEMBER`, `ADMIN`. |

### `messages`
| Field | Type | Notes |
| :--- | :--- | :--- |
| id | UUID | |
| conversation_id | UUID | Indexed for retrieval. |
| sender_id | UUID | |
| *content* | BYTEA | Encrypted blob. |
| nonce | BYTEA | Encryption nonce. |
| expires_at | TIMESTAMP | If set, background worker deletes row at this time. |
| created_at | TIMESTAMP | Used for ordering. |

---

## 5. Real-Time Protocol

### Transport: WebSocket over TLS (WSS)
**Why?** For a chat app, WebSockets provide the lowest latency for bidirectional events (typing, messages) compared to SSE or Long-Polling, with manageable overhead for 1,000 users.

### Message Routing (The "Blind" Router)
1.  **Sender:** Encrypts message for recipient(s). Connects to WebSocket.
2.  **Sender -> Server:** Sends JSON: `{ "type": "msg", "to_conversation": "uuid", "payload": "base64_ciphertext", "nonce": "..." }`.
3.  **Server:**
    *   Verifies sender is a member of `to_conversation`.
    *   *Does not decrypt payload.*
    *   Looks up connection status of other members in Redis.
    *   If online: Pushes payload to their WebSocket.
    *   If offline: Writes payload to `messages` table.
4.  **Recipient:** Receives payload, decrypts locally.

### Presence & Typing Indicators
*   **Presence:** On WebSocket connect, the server sets `user:ID:status = online` in Redis with a TTL. The client must ping every 30s to keep it alive. On disconnect, Redis key expires or is deleted.
*   **Typing:** Sent via WebSocket. Server broadcasts to conversation members. Not persisted to DB (ephemeral).

### Offline Synchronization
*   When a client connects, it sends a `SYNC` command with `last_received_message_id`.
*   The server queries the `messages` table for all rows `WHERE id > last_id AND conversation_id IN (user's conversations)`.
*   The server streams the missed encrypted blobs.

---

## 6. Self-Hosting & Operations

### Deployment Stack (Docker Compose)
The entire application is distributed as a `docker-compose.yml` file.

```yaml
services:
  app:
    image: secret-society:latest
    ports: ["443:443"]
    volumes: ["./data:/data"]
    depends_on: [db, redis, storage]

  db:
    image: postgres:15-alpine
    volumes: ["./pg_data:/var/lib/postgresql/data"]

  redis:
    image: redis:alpine

  storage:
    image: minio/minio
    command: server /data --console-address ":9001"
    volumes: ["./minio_data:/data"]
```

### External Dependencies
1.  **DNS:** An A record pointing to the server IP.
2.  **SMTP:** Not strictly required if invite links are shared manually, but recommended for email notifications. The system can be configured with any generic SMTP provider (Mailgun, SES, or local Postfix).
3.  **TLS:** Handled automatically by the reverse proxy (Caddy).

### Backup Strategy
*   **Database:** A daily `pg_dump` cron job running inside the container, writing to a volume mapped to the host.
*   **Media:** The `minio_data` directory is backed up via `rclone` or simple tarballing.
*   **User Keys:** *Critical:* Users must be instructed that keys are local. If they wipe their device without exporting a backup, they lose their message history and identity (requiring re-verification by the community).

### Monitoring
For the admin, "health" is binary: "Is it running?"
*   A simple `/healthz` endpoint returns 200 OK if DB/Redis are connectable.
*   Docker logs provide visibility for debugging.

---

## 7. Threat Model

### What the Server Can Observe (Metadata Leakage)
The server operator (or attacker with root access) can see:
*   **Social Graph:** Who talks to whom, and when.
*   **Message Frequency:** The volume and timing of traffic.
*   **Group Membership:** Who is in which group.
*   **Invite Chain:** The full history of who invited whom.

### What the Server Cannot Observe
*   **Message Content:** The server stores ciphertext and nonces. Without the private keys (stored only on user devices), content is inaccessible.
*   **File Content:** Files are encrypted client-side before upload.
*   **Group Names:** Group names are encrypted with the group key.

### Blast Radius Analysis
1.  **Server Database Exfiltration:**
    *   *Result:* Attacker gets user public keys, encrypted messages, and social metadata.
    *   *Mitigation:* They cannot decrypt past or future messages. They can attempt a Sybil attack (impersonating users) only if they can also compromise the invite system or spoof signatures.
2.  **Single Member Device Compromised:**
    *   *Result:* Attacker reads that user's messages.
    *   *Forward Secrecy:* Attacker cannot read messages sent/received *before* the compromise (unless the user disabled local encryption/cache).
    *   *Groups:* Attacker obtains the Group Key, decrypting all group messages for that group.
    *   *Containment:* The user should revoke their own key (if a secondary device exists) or an Admin must ban the user. Re-issuing keys requires re-inviting.

### Invite System Attacks
*   **Defended Against:**
    *   **Replay Attacks:** Tokens are single-use hashes.
    *   **Mass Generation:** Quotas prevent a single user from generating thousands of invites.
    *   **Transferability:** An invite link is a bearer token. If intercepted, anyone can use it. *Mitigation:* Invite links should be shared over a secure side-channel (e.g., Signal/WhatsApp).
*   **Not Defended Against:**
    *   **Social Engineering:** If a trusted member turns malicious, they can invite malicious actors. The system relies on the "Trusted Member" assumption. The Admin audit log allows retrospective cleanup.

### Summary of Trade-offs
1.  **Group Encryption:** We chose **Group Keys (Sender Keys)** over pairwise encryption for groups. This reduces CPU load and message size significantly but means if one member is compromised, the entire group history is compromised (unless key rotation happens frequently).
2.  **Key Backup:** We chose **Client-Side Encrypted Exports**. This puts the burden of key management on the user. We do not use a "Key Escrow" service, as that would violate the "Server cannot read" requirement for data recovery.