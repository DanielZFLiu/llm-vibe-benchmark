# System Design Document: Secret Society

## 1. Architecture Overview

### Philosophy
The architecture prioritizes **simplicity**, **auditability**, and **security** over scale. The system is designed as a modular monolith deployable via Docker Compose on a single VPS. This minimizes operational overhead while maintaining strict security boundaries.

### Components
1.  **Client Application (Web/Mobile):**
    *   Responsible for all cryptographic operations (key generation, encryption, decryption).
    *   Never sends plaintext message content to the server.
    *   Manages local key storage (secured by OS keychain or user passphrase).
2.  **API Gateway / App Server (Go):**
    *   Handles HTTP/HTTPS requests (REST/GraphQL) and WebSocket connections.
    *   Manages authentication, invite validation, and message routing.
    *   **Blind Relay:** Routes encrypted blobs without ability to decrypt.
3.  **Database (PostgreSQL):**
    *   Stores user metadata, public keys, invite chains, and encrypted message blobs.
    *   ACID compliance ensures invite chain integrity.
4.  **Cache & Presence (Redis):**
    *   Stores ephemeral state (online status, typing indicators).
    *   Pub/Sub mechanism for routing real-time events to connected WebSocket clients.
5.  **Object Storage (MinIO):**
    *   Self-hosted S3-compatible storage for encrypted media attachments.
    *   Files are encrypted client-side before upload; the server sees only random bytes.

### Component Diagram

```ascii
+----------------+      TLS      +---------------------------+
|   Client App   | <-----------> |   Nginx (Reverse Proxy)   |
| (E2EE Logic)   |               +-------------+-------------+
+----------------+                             |
                                               | Internal Network
                                               v
                                     +---------+---------+
                                     |   App Server (Go) |
                                     | - Auth & Invite   |
                                     | - WS Router       |
                                     | - Cleanup Jobs    |
                                     +---------+---------+
                                               |
             +------------------+--------------+---------------+------------------+
             |                  |                              |                  |
             v                  v                              v                  v
     +-------+------+   +-------+------+               +-------+------+   +-------+------+
     |  PostgreSQL  |   |    Redis     |               |    MinIO     |   |   Cron/    |
     | (Persistent) |   | (Ephemeral)  |               | (Media)      |   |   Worker   |
     +--------------+   +--------------+               +--------------+   +------------+
```

### Technology Justification
*   **Go:** Single binary deployment, strong concurrency model for WebSockets, robust standard crypto libraries.
*   **PostgreSQL:** Relational integrity is critical for the invite chain audit trail.
*   **Redis:** Efficient handling of high-churn presence data without polluting the main DB.
*   **Docker Compose:** Allows a competent generalist to deploy the entire stack with one command (`docker-compose up -d`).

---

## 2. End-to-End Encryption Design

We adopt a variant of the **Signal Protocol** (X3DH Key Agreement + Double Ratchet) for 1:1 chats, and **Sender Keys** for group chats. **We do not roll our own crypto primitives;** we use audited libraries (e.g., `libsignal-protocol` bindings or `noise-protocol` framework).

### Key Hierarchy
1.  **Identity Key Pair (Long-term):** Generated on device registration. Public key uploaded to server; Private key never leaves device. Used to sign other keys and verify identity.
2.  **Signed PreKey:** Signed by Identity Key. Uploaded to server. Used for initial handshake.
3.  **One-Time PreKeys:** Batch of 100 keys uploaded to server. Consumed on first message to establish a session.
4.  **Session Keys (Double Ratchet):** Derived per conversation. Evolves with every message (Forward Secrecy).

### Key Exchange (1:1)
1.  **Alice** requests **Bob's** PreKey bundle from the Server.
2.  **Alice** performs X3DH locally, generating a shared secret and an initial message.
3.  **Alice** sends the ciphertext + her One-Time PreKey ID to **Bob** via Server.
4.  **Bob** receives message, performs X3DH locally using his private PreKey, and derives the same shared secret.
5.  **Double Ratchet** begins for subsequent messages.

### Group Chat (Up to 50 Members)
Pairwise ratchets for 50 users are too heavy. We use **Sender Keys**:
1.  Group Creator generates a **Chain Key** and **Signing Key**.
2.  These are encrypted individually for each member using their 1:1 session and distributed.
3.  When sending, a member encrypts the message with the current Sender Key, then ratchets the Sender Key forward.
4.  **Security Note:** This provides less forward secrecy than pairwise ratchets if a sender key is compromised, but is the standard trade-off for group performance at this scale.

### Forward Secrecy & Compromise
*   **Message Forward Secrecy:** Achieved via the Double Ratchet. If a current session key is compromised, previous messages cannot be decrypted.
*   **Long-term Key Compromise:** If an Identity Key is stolen, the attacker can impersonate the user going forward. They cannot decrypt past messages (due to ratcheting), but they can inject themselves into future handshakes.
*   **Mitigation:** Users can verify "Safety Numbers" (fingerprint of Identity Keys) out-of-band.

### Key Backup & Restoration
*   **Problem:** If a user loses their device, they lose their Identity Key and cannot decrypt history.
*   **Solution:** **Encrypted Key Vault.**
    *   Client generates a random `MasterBackupKey`.
    *   All private keys are encrypted with `MasterBackupKey`.
    *   `MasterBackupKey` is encrypted with a **User Passphrase** (using Argon2id).
    *   The encrypted blob is stored on the Server.
    *   **Restoration:** User enters passphrase -> Client derives key -> Decrypts blob -> Restores Identity.
    *   **Server Role:** Stores the blob. Cannot decrypt it without the passphrase.

### Server Visibility
*   **Can See:** Sender, Receiver, Timestamp, Message Size, Attachment Metadata (filename, size), Public Keys.
*   **Cannot See:** Message content, Attachment content, Group membership (encrypted in profile), Identity Private Keys.

---

## 3. Invite System

The invite system is the gatekeeper. It must be auditable (Admin can see the tree) but secure (cannot be forged).

### Invite Lifecycle
1.  **Generation:**
    *   Member (Inviter) requests an invite code from the Client.
    *   Client signs a payload `{ inviter_id, expiry, max_uses, nonce }` with the Inviter's **Identity Private Key**.
    *   The resulting signature is encoded (e.g., Base64URL) as the Invite Token.
    *   *Note:* The server does not generate the token; the user does. This prevents admin abuse.
2.  **Validation:**
    *   Invitee submits Registration Request + Invite Token.
    *   Server fetches Inviter's **Identity Public Key** from DB.
    *   Server verifies the signature.
    *   Server checks `expiry` and `max_uses` (tracked in DB per token nonce).
    *   **Privacy:** The server knows the *Inviter* (via signature verification) but does not know the *Invitee* until the registration payload is submitted.
3.  **Recording:**
    *   Upon successful registration, a record is created in the `invites` table linking `inviter_id` to `new_user_id`.
    *   This creates the immutable audit chain.

### Revocation & Cascade
*   **Manual Revocation:** Admin revokes a specific invite token. It becomes invalid immediately.
*   **Member Ban:**
    *   **Soft Ban:** User cannot login. Invite chain remains intact.
    *   **Hard Ban (Cascade):** If a user is banned for security violations, the Admin can trigger a **Cascade Revocation**.
    *   **Logic:** All users directly invited by the banned user are suspended. Their invitees are suspended, recursively.
    *   **Rationale:** In a trusted society, trust is transitive. If Alice is malicious, Bob (who vouched for her) is complicit or negligent.

### Abuse Prevention
*   **Replay Attacks:** Each invite token contains a unique `nonce`. The server maintains a set of used nonces (or DB rows). Reusing a token fails.
*   **Mass Generation:** Rate limiting on the API endpoint that verifies tokens.
*   **Transferring Invites:** Tokens are not bound to a specific email, allowing the inviter to hand the code to anyone. This is a feature (offline invitation) but increases risk. Mitigation: Admins can view the IP address of registration to detect anomalies.

---

## 4. Data Model

PostgreSQL Schema (Simplified).

```sql
-- Users Table (Metadata only, no secrets)
CREATE TABLE users (
    id UUID PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT,
    avatar_hash TEXT, -- Hash of encrypted avatar
    identity_public_key TEXT NOT NULL, -- X25519 Public Key
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    banned_at TIMESTAMPTZ
);

-- Devices (For multi-device support)
CREATE TABLE devices (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id),
    pre_keys_json JSONB, -- Encrypted PreKey bundles
    last_seen TIMESTAMPTZ
);

-- Invite Chain (Auditable)
CREATE TABLE invites (
    id UUID PRIMARY KEY,
    inviter_id UUID REFERENCES users(id),
    invitee_id UUID REFERENCES users(id), -- NULL until registration
    token_nonce TEXT UNIQUE NOT NULL, -- The unique part of the signed token
    max_uses INT DEFAULT 1,
    current_uses INT DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Messages (Blind Storage)
CREATE TABLE messages (
    id UUID PRIMARY KEY,
    sender_id UUID REFERENCES users(id),
    conversation_id UUID NOT NULL, -- Opaque ID (Group ID or Peer Pair Hash)
    ciphertext TEXT NOT NULL, -- Encrypted content
    attachment_id UUID, -- Reference to MinIO object
    ttl_seconds INT, -- For ephemeral messages (0 = permanent)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ
);

-- Conversations (Metadata)
CREATE TABLE conversations (
    id UUID PRIMARY KEY,
    type TEXT CHECK (type IN ('direct', 'group')),
    group_name_encrypted TEXT, -- Encrypted with group key
    group_avatar_encrypted TEXT,
    created_by UUID REFERENCES users(id)
);

-- Conversation Members
CREATE TABLE conversation_members (
    conversation_id UUID REFERENCES conversations(id),
    user_id UUID REFERENCES users(id),
    role TEXT DEFAULT 'member', -- 'admin' for groups
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (conversation_id, user_id)
);
```

**Encryption Note:** Fields ending in `_encrypted` or `ciphertext` are opaque to the DB. The `identity_public_key` is plaintext to allow key discovery.

---

## 5. Real-Time Protocol

### Transport: WebSockets (WSS)
*   **Why:** Full-duplex communication is required for chat, typing indicators, and receipt synchronization. HTTP long-polling is too latency-heavy; SSE is server-to-client only.
*   **Security:** WSS (WebSocket Secure) over TLS 1.3.

### Message Routing
1.  **Sender** encrypts message -> Sends to Server via WS.
2.  **Server** validates session/auth -> Stores message in DB -> Looks up Recipient's active WS connection.
3.  **Server** pushes ciphertext to Recipient's WS connection.
4.  **Server** does **not** inspect the payload.

### Presence & Typing
*   **Presence:** Client sends `heartbeat` every 30s. Server updates Redis `user:{id}:status`. If heartbeat stops, Redis TTL expires, status sets to `offline`.
*   **Typing:** Ephemeral event. Client sends `typing_start` / `typing_stop`. Server broadcasts to conversation participants via Redis Pub/Sub. No persistence in DB.

### Offline Delivery
1.  Recipient is offline. Server stores message in `messages` table with `delivered_at = NULL`.
2.  Recipient reconnects. Client sends a `sync_request` with the last message ID it received.
3.  Server queries DB for all messages where `created_at > last_received_id` and pushes them down the WS pipe.
4.  Client acknowledges receipt; Server updates `delivered_at`.

---

## 6. Self-Hosting & Operations

### Deployment Stack
*   **OS:** Ubuntu LTS or Debian Stable.
*   **Orchestration:** Docker Compose v2.
*   **Reverse Proxy:** Nginx (handles TLS termination via Let's Encrypt).
*   **Configuration:** Environment variables (`.env` file) for secrets (DB passwords, JWT secrets).

### Docker Compose Structure
```yaml
services:
  app:
    build: ./app
    depends_on: [db, redis]
    env_file: .env
  db:
    image: postgres:15-alpine
    volumes: [pg_data:/var/lib/postgresql/data]
  redis:
    image: redis:7-alpine
  minio:
    image: minio/minio
    volumes: [minio_data:/data]
  nginx:
    image: nginx:alpine
    ports: ["80:80", "443:443"]
    volumes: [./nginx.conf:/etc/nginx/nginx.conf, ./certs:/etc/letsencrypt]
```

### Backup & Restore
*   **Database:** Daily cron job running `pg_dump` -> compressed -> uploaded to external cold storage (e.g., Backblaze B2 or encrypted S3 bucket).
*   **Media:** MinIO bucket replication or rsync to cold storage.
*   **Keys:** **CRITICAL.** The server cannot backup user keys (it doesn't have them). Users are responsible for their `MasterBackupKey` passphrase. The Admin should print a "System Recovery Key" (for the admin account) and store it physically offline.

### Monitoring
*   **Health Check:** Endpoint `/health` checking DB and Redis connectivity.
*   **Logs:** Structured JSON logs shipped to a local file (ELK stack is overkill). `grep` for "ERROR" or "PANIC".
*   **Metrics:** Prometheus exporter in the Go app. Monitor:
    *   Active WebSocket connections.
    *   Message queue depth.
    *   DB connection pool usage.
    *   Disk space (critical for MinIO).

---

## 7. Threat Model

### 1. Malicious Server Operator
*   **Can Observe:** Traffic patterns (who talks to whom, when, and how much data). IP addresses. Invite chain structure.
*   **Cannot Observe:** Message content, media content, group topics, user locations (beyond IP).
*   **Mitigation:** Traffic analysis is inherent to centralized chat. Users should use Tor/VPN if metadata privacy is required.

### 2. Database Exfiltration
*   **Scenario:** Attacker gains read access to PostgreSQL dump.
*   **Impact:**
    *   **Identities:** Public keys exposed (by design).
    *   **Messages:** Ciphertext only. Without user session keys (on client devices), data is mathematically unrecoverable (assuming AES-256-GCM holds).
    *   **Invites:** Chain is visible, but tokens are nonces/signatures.
*   **Blast Radius:** Loss of availability if DB is deleted. No confidentiality breach.

### 3. Client Device Compromise
*   **Scenario:** Attacker gains root/admin access to a user's phone/laptop.
*   **Impact:** Total compromise of that user's account. Attacker can read all messages, decrypt history, and impersonate the user.
*   **Blast Radius:** Limited to that user and any groups they are in.
*   **Mitigation:** Remote Wipe (Admin revokes device keys), Safety Number verification by peers to detect impersonation.

### 4. Invite System Attacks
*   **Defended Against:**
    *   **Forgery:** Cryptographic signatures prevent creating valid invites without a private key.
    *   **Replay:** Nonces prevent reusing old invites.
    *   **Escalation:** Regular members cannot grant admin rights via invites.
*   **Not Defended Against:**
    *   **Social Engineering:** A trusted member is tricked into inviting an attacker.
    *   **Key Theft:** If a member's Identity Key is stolen, the attacker can generate valid invites as that member.

### Trade-off Statement
**Usability vs. Security:** We store an encrypted key backup on the server. This allows password-based recovery. The trade-off is that if the user's passphrase is weak, a brute-force attack on the stolen backup blob is possible. We mitigate this by enforcing strong passphrase requirements client-side and using Argon2id with high memory cost for derivation. True "zero-knowledge" would mean no recovery, which was deemed unacceptable for the target community's usability needs.