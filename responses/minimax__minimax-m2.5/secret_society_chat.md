# System Design Document: "Secret Society"

## 1. Architecture Overview

The system is designed as a classic client-server architecture with a "dumb server, smart client" philosophy to ensure End-to-End Encryption (E2EE). The server acts primarily as a relay, metadata store, and mailbox; it never possesses the keys required to decrypt content.

### Component Diagram

```ascii
+---------------------+       +----------------------+
|   Client App        |       |   Server (VPS)       |
| (Mobile/Desktop)    |       |                      |
|                     | <---> |  +----------------+  |
| +---------------+   |  TLS  |  |  Auth Service  |  |
| | Crypto Engine |   |  WS   |  +----------------+  |
| | (Double       |   |       |  |  Message       |  |
| |  Ratchet)     |   |       |  |  Relay         |  |
| +---------------+   |       |  +----------------+  |
| | Local Storage |   |       |  |  Presence      |  |
| | (Encrypted)   |   |       |  |  Manager       |  |
+---------------------+       |  +----------------+  |
                              |                      |
                              |  +----------------+  |
                              |  |  Database      |  |
                              |  |  (PostgreSQL)  |  |
                              |  +----------------+  |
                              |  +----------------+  |
                              |  |  Blob Storage  |  |
                              |  |  (Media/Files) |  |
                              |  +----------------+  |
                              +----------------------+
```

### Technology Stack & Justification

*   **Client App:** React Native or Flutter (Cross-platform mobile/desktop). Chosen for ability to build UI quickly while accessing secure storage (Keychain/Keystore) for private keys.
*   **Server Language:** Go (Golang).
    *   *Why:* Single binary deployment simplifies self-hosting. Excellent concurrency handling for managing 1,000+ WebSocket connections. Robust standard library.
*   **Database:** PostgreSQL.
    *   *Why:* Relational data fits the structured nature of Users, Groups, and Invite Trees perfectly. ACID compliance ensures invite redemption is atomic.
*   **Real-Time Transport:** WebSockets (via Gorilla or similar library).
    *   *Why:* Low latency, bi-directional communication essential for presence and typing indicators. Falls back to Long-Polling if necessary, but WS is standard.
*   **Deployment:** Docker Compose.
    *   *Why:* Wraps all dependencies (DB, Cache, App) into a single reproducible unit. Requires only Docker and Docker Compose to run.

---

## 2. End-to-End Encryption Design

We adopt a variant of the **Signal Protocol** (Double Ratchet) to ensure Forward Secrecy (FS) and Post-Compromise Security (PCS).

### 2.1 Key Generation & Identity
Every user device generates a set of keys upon registration:
1.  **Identity Key (IK):** A long-term Curve25519 key pair. Public key is uploaded to the server. Private key *never* leaves the device.
2.  **Signed Pre-Key (SPK):** A medium-term key pair, signed by the Identity Key, rotated monthly.
3.  **One-Time Pre-Keys (OPK):** A batch of X25519 key pairs (e.g., 100) used for initial key exchange, replenished as used.

### 2.2 Key Exchange Protocol (1:1)
1.  **Fetch:** Alice fetches Bob’s public keys from the server.
2.  **X3DH (Extended Triple Diffie-Hellman):** Alice performs a Diffie-Hellman with Bob’s IK, SPK, and (optionally) an OPK to derive a shared secret `MasterSecret`.
3.  **Ratchet:** Alice and Bob initialize a **Double Ratchet** session using `MasterSecret`. This creates a root key and a chain key for sending/receiving.
4.  **State:** Both clients store the session state locally. The server stores nothing.

### 2.3 Key Exchange Protocol (Group)
To support groups of up to 50 efficiently (avoiding $O(N)$ encryptions):
1.  **Sender Keys:** When a user joins a group, they generate a random **Sender Key** (SK) (a chain key and a message key).
2.  **Distribution:** The client encrypts the SK using pairwise E2EE (via the 1:1 protocol) to every other member of the group.
3.  **Sending:** To send a message, the sender derives a Message Key from their current SK chain and encrypts the message (Sender Key encryption is similar to AES-GCM in a chain).
4.  **Ratcheting:** The SK is ratcheted forward after every message.
5.  **New Member:** When a new member joins, *every existing member* must perform a new pairwise encrypted SK distribution to the new member.

### 2.4 Forward Secrecy & Compromises
*   **Forward Secrecy:** Achieved via the Double Ratchet. Even if a long-term Identity Key is stolen, old messages cannot be decrypted because the ratchet chain keys are ephemeral and deleted after use.
*   **Key Compromise:** If a device is stolen, the attacker gains the *current* ratchet state. They can read future messages but cannot decrypt *past* messages stored on the server (unless they also compromise the server).
*   **New Device / Restoration:** The user must export their Identity Key (encrypted with a passphrase) or use a "Social Key Recovery" (trusted friends) or QR code scan from the old device. The server does *not* store private keys.

### 2.5 Server Capabilities & Storage
*   **Server stores:**
    *   **Identity Blobs:** The public Identity Key, Signed Pre-Key, and encrypted One-Time Pre-Keys.
    *   **Message Blobs:** Encrypted payloads (Ciphertext).
    *   **Group Metadata:** List of members, but NOT the Sender Keys (those are exchanged client-to-client via the server as a relay).
*   **Server observes:**
    *   **Metadata:** Who is talking to whom, at what time, and how frequently.
    *   **Message Size:** Approximate message length (to detect spam/patterns).
    *   **Public Keys:** Who owns which public key (pseudonymity).

---

## 3. Invite System

The system balances audibility with privacy. The server tracks the graph of invitations, but invites themselves are high-entropy tokens to prevent guessing.

### 3.1 Invite Lifecycle
1.  **Generation:** An authorized user clicks "Invite". The server generates a high-entropy UUID (e.g., 256-bit random string) and stores it in the `invites` table with `inviter_id` and `status = pending`.
2.  **Link:** The client generates a link: `https://secretsociety.com/join?token=UUID`.
3.  **Redemption:**
    *   User clicks the link. The Client requests the token validation.
    *   The server checks if the token exists, is unused, and not expired.
    *   On successful registration, the server marks the token as `used`, records the `invitee_id`, and updates the inviter's "Invite Tree" metadata.
4.  **Auditing:** The admin panel traverses the `invites` table to show the tree structure (A invited B, B invited C).

### 3.2 Privacy & Security
*   **Privacy:** While the server knows the inviter/invitee relationship (for the audit log), it does not know the *content* of the communication prior to joining.
*   **Abuse Prevention:**
    *   **Rate Limiting:** Admins can set a global or per-user cap on invites (e.g., 5 per month).
    *   **Revocation:** If a user is removed, their future invite tokens become invalid.
    *   **Replay Prevention:** Tokens are single-use database entries.
*   **Chain Integrity:** If User A invites User B, and User B is later deleted (revoked), User B's status is marked `revoked`. If User B used their invite to bring in User C, User C remains valid, but the link to B is severed.

---

## 4. Data Model

We use PostgreSQL. The `messages` table stores ciphertext.

```sql
-- Core tables

CREATE TABLE users (
    id              UUID PRIMARY KEY,
    display_name    VARCHAR(50) NOT NULL, -- Plaintext for directory
    avatar_url      TEXT,                 -- Points to blob storage
    created_at      TIMESTAMP DEFAULT NOW(),
    status          VARCHAR(20) DEFAULT 'active' -- active, suspended
);

-- Public Key Infrastructure
CREATE TABLE identity_keys (
    user_id         UUID PRIMARY KEY REFERENCES users(id),
    public_identity_key      BYTEA NOT NULL,
    public_signed_pre_key    BYTEA NOT NULL,
    signed_pre_key_signature BYTEA NOT NULL,
    -- OPKs are stored as a separate table or JSONB blob
    one_time_pre_keys        BYTEA NOT NULL -- Encrypted batch, updated incrementally
);

-- Invites
CREATE TABLE invites (
    token           UUID PRIMARY KEY,
    inviter_id      UUID REFERENCES users(id),
    invitee_id      UUID REFERENCES users(id), -- Filled on use
    created_at      TIMESTAMP DEFAULT NOW(),
    used_at         TIMESTAMP,
    status          VARCHAR(20) DEFAULT 'pending' -- pending, used, revoked
);

-- Groups
CREATE TABLE groups (
    id              UUID PRIMARY KEY,
    name            VARCHAR(100),
    created_at      TIMESTAMP DEFAULT NOW(),
    created_by      UUID REFERENCES users(id)
);

CREATE TABLE group_members (
    group_id        UUID REFERENCES groups(id),
    user_id         UUID REFERENCES users(id),
    joined_at       TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (group_id, user_id)
);

-- Messages (The "Mailbox")
CREATE TABLE messages (
    id              UUID PRIMARY KEY,
    sender_id       UUID REFERENCES users(id),
    recipient_id    UUID REFERENCES users(id), -- NULL if group message
    group_id        UUID REFERENCES groups(id), -- NULL if DM
    
    -- ENCRYPTED CONTENT STORED HERE
    ciphertext      BYTEA NOT NULL, 
    
    -- Ephemeral settings
    ephemeral_seconds   INT DEFAULT 0, -- 0 = keep forever
    
    -- Status
    delivered_at    TIMESTAMP,
    read_at         TIMESTAMP,
    
    created_at      TIMESTAMP DEFAULT NOW()
);

-- Index for fetching history
CREATE INDEX idx_messages_recipient ON messages(recipient_id, created_at);
CREATE INDEX idx_messages_group ON messages(group_id, created_at);
```

*Note: All `ciphertext` fields are opaque blobs to the database. `display_name` and metadata are plaintext.*

---

## 5. Real-Time Protocol

### 5.1 Transport
We use **WebSockets** over TLS 1.3.
1.  **Auth:** Client connects via WSS and performs an HTTP Upgrade handshake. The handshake includes an `Authorization: Bearer <token>` header.
2.  **Token:** The token is a short-lived JWT (access token) derived from the user's long-term credentials.

### 5.2 Message Routing (Sender -> Recipient)
1.  **Client A** encrypts the message using the established session keys. It sends a JSON payload: `{ type: "message", recipient: "UserB_ID", ciphertext: "0xdeadbeef...", ephemeral: 60 }`.
2.  **Server** receives the payload. It does *not* decrypt it. It looks up User B's active WebSocket connection.
3.  **Relay:**
    *   If User B is online: Server pushes the ciphertext blob immediately to User B's socket.
    *   If User B is offline: Server inserts the blob into the `messages` table in the DB (the "Mailbox" strategy).

### 5.3 Presence & Typing
*   **Presence:** Clients send a "Heartbeat" (ping) every 30 seconds. If the server doesn't receive a ping for 60 seconds, the user status is set to `offline`. Last Seen is updated to `now()`.
*   **Typing:** A distinct message type `{ type: "typing", to: "UserB_ID" }`. This is ephemeral, not stored in DB, and relayed immediately if online, or dropped if offline.

### 5.4 Offline Retrieval
When User B reconnects:
1.  Client B sends `{ type: "sync", last_read_message_id: "uuid" }`.
2.  Server queries `SELECT * FROM messages WHERE (recipient_id = B OR group_id IN (B's groups)) AND id > last_read_message_id`.
3.  Server streams these messages to Client B.
4.  Client B decrypts, displays, and deletes ephemeral messages from the UI. The server will auto-delete ephemeral messages based on the `ephemeral_seconds` column after the calculated time (Note: Server can only guarantee deletion from its DB; client-side deletion cannot be enforced).

---

## 6. Self-Hosting & Operations

### 6.1 Deployment Stack
**Docker Compose** is the recommended deployment method.

```yaml
version: '3'
services:
  app:
    image: secretsociety/server:latest
    ports:
      - "443:443"
    volumes:
      - ./data:/app/data
      - ./media:/app/media
    environment:
      - DATABASE_URL=postgres://user:pass@db:5432/secret
      - SECRET_KEY=changeme
    depends_on:
      - db

  db:
    image: postgres:15-alpine
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:alpine # Used for Presence and Socket.io adapters
```

*External Dependencies:*
*   **SMTP:** Requires an external SMTP relay (e.g., Mailgun, or a local Postfix) to email invites if links aren't shared manually.
*   **TLS:** Caddy or Nginx-Proxy-Manager (automatic LetsEncrypt).
*   **Storage:** Local filesystem (mounted volume) or S3 compatible object storage (MinIO) for encrypted media.

### 6.2 Backup Strategy
*   **Database:** Standard `pg_dump` daily. Since the DB only contains encrypted blobs and metadata, leaking a DB backup is equivalent to the "Malicious Server" threat model (server can't read it anyway). However, backup is needed for continuity (user accounts, invite chains).
*   **Media:** Restic or Duplicati to back up the `/media` volume.
*   **Key Material:** **User Responsibility.** The client app must prompt the user to export their private key bundle encrypted with a passphrase. The server has no way to recover a lost private key.

### 6.3 Monitoring
*   **Metrics to monitor:**
    *   `Active Connections` (WebSockets).
    *   `Message Throughput` (msgs/sec).
    *   `Database Connections` (pool exhaustion).
    *   `Latency` (end-to-end encryption/decryption time on client side is opaque to server, but server processing time is visible).
*   **Tools:** Prometheus + Grafana (easily self-hosted).

---

## 7. Threat Model

### 7.1 Malicious Server Operator
*   **Capabilities:**
    *   Read metadata (Who invited whom, who talks to whom, when).
    *   Block messages or users.
    *   Read public key Identity.
    *   Corrupt message delivery.
*   **Limitations:**
    *   **Cannot** read message content (Ciphertext is opaque).
    *   **Cannot** impersonate a user (Cannot forge crypto signatures).
    *   **Cannot** recover a user's identity if they lose their device (Server does not hold keys).

### 7.2 Database Exfiltration
*   **Impact:** Low to Moderate.
*   **Analysis:** An attacker with a copy of the DB sees `users`, `invites`, and `messages`. The `messages` table contains `ciphertext`. Without the decryption keys (which exist only on client devices), the data is cryptographically secure noise.
*   **Risk:** Traffic analysis (who talks to whom frequently) becomes possible.

### 7.3 Single Device Compromise
*   **Scenario:** Attacker steals User A's unlocked phone.
*   **Blast Radius:**
    *   **Past:** Attacker can read *archived* messages stored in the local client database (if not wiped).
    *   **Future:** Attacker can decrypt *future* incoming messages and send new messages until User A revokes the compromised device via another trusted device (if multi-device support exists) or rotates their Identity Key.
    *   **Global:** The attack is isolated to User A's direct contacts. They cannot automatically decrypt messages sent to Group C unless they also steal User A's *Sender Keys* for that group, which are also stored locally.

### 7.4 Invite System Attacks
*   **Mass Generation:** Mitigated by rate limiting (admin configurable).
*   **Phishing/Social Engineering:** Not technically preventable; relies on the trust of the "trusted members."
*   **Replay Attacks:** Tokens are single-use database entries; replaying a URL results in "Token Already Used" error.
*   **Link Sharing:** If a link is leaked publicly, anyone can join. The system cannot distinguish between the intended recipient and a leaked link beyond the rate limit/audit trail. **Mitigation:** Use short-lived tokens (24h) or require a secondary password for the community.