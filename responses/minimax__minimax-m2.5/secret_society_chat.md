# System Design Document: "Secret Society"

**Version:** 1.0
**Target Audience:** Developer / System Administrator
**Deployment Scope:** Single VPS (1-4 vCPUs, 4-8GB RAM)

---

## 1. Architecture Overview

### High-Level Design
The system follows a "Blind Server" architecture. The server acts as a relay and storage bin for encrypted blobs, but it has no capability to decrypt messages.

### Component Diagram
```text
[Client App] <--HTTPS/WSS--> [Load Balancer (Caddy/Nginx)]
                                      |
                              [Chat Server (Go)]
                                      |
                 +--------------------+--------------------+
                 |                    |                    |
           [PostgreSQL]           [Redis]           [MinIO/S3]
           (Message Metadata)    (Presence/         (Encrypted
                               Cache)             Media Blobs)
```

### Technology Stack
*   **Server:** Go (Golang). Chosen for single-binary deployment, high concurrency handling (crucial for 1k websockets), and performance.
*   **Database:** PostgreSQL 15. Chosen for reliability, JSON support, andACID compliance.
*   **Cache/PubSub:** Redis. Used for online presence and broadcasting WebSocket messages.
*   **Deployment:** Docker Compose. Simplifies installation for a non-specialist.
*   **Crypto Library:** Libsodium (via `golang.org/x/crypto/nacl`) or a Double Ratchet implementation (e.g., `github.com/secure憋/signal` logic port).

---

## 2. End-to-End Encryption Design

### 2.1 Keys & Identity
Every user generates three keys upon registration (stored locally on their device):
1.  **Identity Key (IK):** A long-term Curve25519 key pair.
2.  **Signed Pre-Key (SPK):** A medium-term key pair, signed by the IK, rotated periodically.
3.  **One-Time Pre-Keys (OPK):** A stash of ephemeral key pairs for initial key exchange (X3DH).

*Note: For this design, to keep complexity manageable for a self-hosted app, we simplify the "Pre-Key" server requirements. We will implement a "Lazy" ratchet where keys are exchanged on first message, rather than pre-publishing to a server directory, to reduce database complexity.*

### 2.2 Key Exchange Protocols
*   **1:1 Chat (X3DH - Extended Triple Diffie-Hellman):**
    1.  Alice retrieves Bob's IK and SPK.
    2.  Alice performs DH calculations combining her IK + Bob's SPK + Bob's IK.
    3.  Result creates a shared secret `SK`.
*   **Double Ratchet:**
    *   Once `SK` is established, subsequent messages use the **Double Ratchet** algorithm. Every message carries a new Public Key. If a key is compromised, old messages remain secure (Forward Secrecy) because the chain shifts forward immediately. Future messages are secure if the *long-term* IK is compromised (Future Secrecy) because the ratchet is ephemeral.
*   **Group Chat (Sender Keys):**
    *   Instead of 1:1 ratchets, every member has a single `Sender Key` for that group.
    *   When Alice joins Group G, she generates a public key and sends it to all current members.
    *   Subsequent messages to the group are encrypted with Alice's `Sender Key`.
    *   *Trade-off:* If Alice is in the group, she can impersonate herself. We accept this limitation for group simplicity vs. the complexity of MLS (Messaging Layer Security).

### 2.3 Message Storage & Retrieval
*   **Client-Side:** The client encrypts the plaintext payload into a `Ciphertext Blob`.
*   **Server-Side:** The server receives the Blob + a `Message Nonce`. The server **never** sees the nonce used for crypto (or treats it as opaque data).
*   **Storage:**
    *   The server stores the `Ciphertext Blob` in the `messages` table.
    *   The server stores the `Encryption Key ID` (an integer) to help the client know which key to use to decrypt.

### 2.4 Key Restoration
*   **Primary:** Users are instructed to export their private keys to a JSON file and store it securely (e.g., VeraCrypt volume or paper wallet).
*   **Secondary (Server-Backed):**
    *   User sets a password locally.
    *   Client encrypts private keys with this password.
    *   Client uploads the encrypted blob to the server.
    *   On a new device, user enters the password, downloads blob, and decrypts locally.

---

## 3. Invite System

### 3.1 The Lifecycle
1.  **Generation:** Member A (Admin or User) clicks "Generate Invite".
2.  **Token Creation:** Client generates a random 256-bit UUID (`InviteToken`).
3.  **Signing:** Client signs the `InviteToken` using Member A's **Identity Key**.
4.  **Link:** A link is created: `https://chatsociety.com/invite/v1_UUID.Signature`.
5.  **Redemption:** New User B visits link.
    *   The server checks if `InviteToken` exists and is unused.
    *   If valid, Server records "Inviter = Member A" in the audit log.
    *   Server marks token as "claimed" or keeps it as a "valid group" token.

### 3.2 Privacy & Validation
*   **Server Blindness:** The server knows a join happened, but does not know *who* initiated the invite (who clicked the link) until the Inviter sends a Welcome Message to the new user.
*   **Auditability:** The database stores `invite_id`, `inviter_user_id`, `used_at`, `revoked`.

### 3.3 Revocation
*   Admins can delete a user.
*   If User A is deleted, the "Invite Tree" logic is:
    *   Recursively finding everyone invited by User A is complex in SQL.
    *   *Design Decision:* We do **not** auto-ban everyone downstream. That is too dangerous (denial of service). Instead, we rely on the community norms and manual pruning via the Admin Panel if abuse is detected.

---

## 4. Data Model

### Core Schema (PostgreSQL)

**`users`**
*   `id` (UUID, PK)
*   `display_name` (VARCHAR, encrypted client-side before storage? No, kept plain for directory, or optionally encrypted if directory is disabled. *Decision: Plaintext for Directory ease, users can use pseudonyms.*)
*   `public_key` (TEXT, IK)
*   `created_at` (TIMESTAMP)
*   `status` (ENUM: active, revoked)

**`invites`**
*   `id` (UUID)
*   `inviter_id` (FK -> users.id)
*   `token` (BYTEA, hashed)
*   `claimed_by` (FK -> users.id, nullable)
*   `claimed_at` (TIMESTAMP)

**`conversations` (1:1 or Group)**
*   `id` (UUID)
*   `type` (ENUM: direct, group)
*   `name` (Optional, ENCRYPTED client side)
*   `members` (JSONB array of User UUIDs)

**`messages`**
*   `id` (BIGINT, Auto-increment)
*   `conversation_id` (FK)
*   `sender_id` (FK)
*   `encrypted_payload` (BYTEA) -- The Ciphertext Blob
*   `nonce` (BYTEA)
*   `created_at` (TIMESTAMP)
*   `expires_at` (TIMESTAMP, nullable for ephemeral)

**`devices`** (To handle multiple devices per user)
*   `id` (UUID)
*   `user_id` (FK)
*   `device_key` (TEXT)

---

## 5. Real-Time Protocol

### Transport
*   **WebSockets (WSS):** Chosen over Server-Sent Events (SSE) for lower latency and bi-directional typing indicators.
*   **Fallback:** Long-polling if WSS fails (optional).

### Message Routing (Blind Relay)
1.  **User A** connects to WebSocket Server. Authenticates via JWT (carrying session token).
2.  **User A** sends `Message` object:
    *   `recipient_id`: UUID
    *   `ciphertext`: Encrypted Blob
    *   `nonce`: Random bytes
3.  **Server**:
    *   Validates JWT.
    *   Pushes `Message` to **Redis Channel** keyed by `recipient_id`.
    *   Stores `Message` in **PostgreSQL** (for offline history).
4.  **User B** (online):
    *   Redis triggers push to User B's WebSocket.
    *   User B decrypts and renders.
5.  **User B** (offline):
    *   On reconnect, Client asks Server "Give me messages since ID X".
    *   Server streams encrypted blobs.

### Presence & Typing
*   **Presence:** Server updates Redis `SET user_id:online` with TTL (30s). Client pings every 20s. Admin panel queries Redis to show "Online/Offline".
*   **Typing:** `type: typing_start` event is sent via WebSocket. It is a high-frequency, unreliable event. It is **not** persisted to DB. It is not encrypted (privacy trade-off) or encrypted with a "dummy" key. *Decision: Plaintext typing indicators to reduce complexity and CPU load; they reveal metadata anyway.*

---

## 6. Self-Hosting & Operations

### Deployment Story (Docker Compose)

The deployer clones the repo and edits `.env`.

```yaml
version: '3.8'
services:
  app:
    image: secretsociety/server:latest
    ports:
      - "443:443"
    volumes:
      - ./data:/data
      - ./media:/media
    environment:
      - DATABASE_URL=postgres://user:pass@db:5432/secretsociety
      - REDIS_URL=redis://cache
    depends_on:
      - db
      - cache

  db:
    image: postgres:15-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data

  cache:
    image: redis:alpine
    command: redis-server --appendonly yes
```

### External Dependencies
*   **SMTP:** Required for "Forgot Password" (if server-backed keys used) or invite links via email. Use a transactional provider (Mailgun/SendGrid) or a local `postfix` relay.
*   **DNS:** `A` record pointing to VPS IP.
*   **TLS:** Automated via Caddy or Let's Encrypt.

### Monitoring
*   **Metrics:** `/metrics` endpoint (Prometheus format).
*   **Key Metrics:**
    *   `active_connections` (WebSocket count)
    *   `messages_per_second`
    *   `db_connection_pool_usage`
*   **Logs:** JSON formatted stdout (Docker logs).

### Backups
*   **Database:** Daily `pg_dump` via cron, stored on NFS or off-server (S3).
*   **Key Material:** **Do not** back up the server's database if it contains encrypted key backups (password-protected). If the DB is stolen *and* the user password is weak, the attacker can crack the key backup.
*   *Strategy:* The server DB should be backed up, but operators must understand that encrypted blobs are opaque. If the server DB is lost, users just lose message history, not their keys.

---

## 7. Threat Model

### 7.1 The Malicious Server Operator
*   **What they CAN see:**
    *   IP addresses of users.
    *   Connection times and duration.
    *   Message frequency and size (metadata).
    *   The "Invite Tree" (who invited whom).
    *   The Public Keys.
*   **What they CANNOT see:**
    *   Message content.
    *   Group names.
    *   Usernames (if users chose to encrypt their profiles).

### 7.2 Database Exfiltration
*   If an attacker steals the `messages` table:
    *   They only have Ciphertext Blobs.
    *   Without the private keys (which exist *only* on the client devices), the data is cryptographically useless.
*   **Risk:** If the attacker also runs a "Phishing" client and tricks a user into entering their password (for Key Backup), they can decrypt history. **Mitigation:** Client-side warning prompts.

### 7.3 Compromised Member Device
*   If a user's phone is stolen and unlocked:
    *   Attacker can read all future messages.
    *   Attacker can impersonate the user in 1:1 chats (they have the ratchet state).
    *   Attacker can read group history *if* sender keys are cached locally.
    *   **Blast Radius:** Confined to that user's account.

### 7.4 Invite System Attacks
*   **Mass Generation:** Rate limit invites (e.g., 1 per day per user). Admins can override.
*   **Replay Attacks:** Invite tokens are single-use.
*   **Transferring Invites:** If an invite is given to a bad actor, the only recourse is to kick the user. (See Revocation section 3.3).

### 7.5 Forward Secrecy vs. Long-Term Key Compromise
*   The system uses Double Ratchet.
*   If **Long-Term Key (IK)** is stolen (device theft):
    *   Attacker can *impersonate* the user in the initial key exchange (X3DH).
    *   However, if the user communicates with someone *who has already established a session*, the attacker cannot decrypt past messages or decrypt new messages sent by the victim to other people (unless they intercept the specific X3DH handshake).
    *   *Conclusion:* High security is maintained against passive eavesdropping, but active impersonation requires users to verify keys ("Safety Numbers") after a device reset.