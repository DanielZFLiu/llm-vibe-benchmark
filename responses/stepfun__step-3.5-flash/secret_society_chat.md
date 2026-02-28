# Secret Society System Design Document

## 1. Architecture Overview

### 1.1 Components

The system consists of the following components deployed on a single VPS:

- **Client**: A cross‑platform application (web, mobile, desktop) that handles user interaction, cryptographic operations, and real‑time communication via WebSocket. It never stores plaintext messages on the server; all encryption/decryption happens locally.
- **Application Server**: A Go‑based backend exposing:
  - HTTPS endpoints for registration, invite management, admin actions, and static files.
  - A WebSocket endpoint for real‑time messaging, presence, and typing indicators.
  - Business logic for routing messages, validating invites, and managing group membership.
- **Database**: PostgreSQL storing user accounts, public keys, conversation metadata, and encrypted message payloads.
- **File Storage**: Local filesystem (or optional S3‑compatible) for encrypted files. Files are encrypted client‑side before upload.
- **Reverse Proxy**: Nginx (or Caddy) handling TLS termination, static assets, and proxying WebSocket traffic to the application server.

All components are orchestrated with Docker Compose for easy deployment.

### 1.2 Deployment Diagram

```text
+----------------+        HTTPS/WebSocket        +----------------+      +-----------------+
|     Client     | <---------------------------> |   Nginx        | ---> |   PostgreSQL    |
| (Web/Mobile)   |                               | (Reverse Proxy)|      |   Database      |
+----------------+                               +----------------+      +-----------------+
                                                          |
                                                          v
                                               +-----------------+
                                               |   Application   |
                                               |     Server      |
                                               |   (Go binary)   |
                                               +-----------------+
                                                          |
                                                          v
                                               +-----------------+
                                               |  File Storage   |
                                               |  (local disk)   |
                                               +-----------------+
```

### 1.3 Technology Choices & Justification

- **Go**: Compiled binary, minimal runtime, excellent concurrency (goroutines) for handling thousands of WebSocket connections. Simple to deploy and monitor.
- **PostgreSQL**: ACID‑compliant, robust, and sufficient for <1k users. Supports JSON/BLOBs for encrypted payloads and complex queries (e.g., invite tree).
- **Nginx**: Mature, easy TLS management (Let’s Encrypt), efficient static file serving, and WebSocket proxying.
- **Docker Compose**: Encapsulates dependencies, ensures reproducible deployments for non‑specialists.
- **WebSocket**: Full‑duplex, low‑latency, ideal for push‑based messaging and presence. Works over TLS.
- **Client‑side Encryption**: All cryptographic operations occur in the client; the server never handles plaintext keys.

### 1.4 Component Responsibilities

| Component       | Responsibilities                                                                 |
|-----------------|---------------------------------------------------------------------------------|
| Client          | UI, key generation, encrypt/decrypt messages, maintain ratchet state, backup/restore keys, handle ephemeral timers. |
| Application     | Authenticate users, store/retrieve encrypted blobs, route messages via WebSocket, manage invites, serve admin UI, track presence. |
| Database        | Persist user profiles, public keys, conversations, encrypted payloads, per‑recipient keys, delivery status, invites. |
| File Storage    | Store encrypted files; associate with metadata row in DB.                     |
| Nginx           | TLS termination, HTTP → WebSocket upgrade, static assets, rate limiting (optional). |

---

## 2. End‑to‑End Encryption Design

### 2.1 Cryptographic Primitives

- **Curve25519** (X25519) for Diffie‑Hellman key agreement.
- **Ed25519** for digital signatures (key verification).
- **HKDF** (HMAC‑based Extract‑and‑Expand Key Derivation Function) for deriving symmetric keys.
- **AES‑256‑GCM** for authenticated encryption of payloads and per‑recipient keys.
- **Random IVs**: 12‑byte nonces for AES‑GCM.

All keys are 32 bytes; nonces 12 bytes; authentication tags 16 bytes.

### 2.2 User Identity & Key Material

Each user (account) has a persistent **identity key pair**:
- **Encryption key**: X25519 public/private (`identity_enc_pub`, `identity_enc_priv`).
- **Signature key**: Ed25519 public/private (`identity_sig_pub`, `identity_sig_priv`).

The **private** keys are generated and stored only on the user’s devices, protected by the device’s secure storage (or a user‑provided passphrase). The **public** keys are registered with the server during account creation (or device addition) and stored in the `users` table.

For asynchronous 1:1 key exchange, each user also publishes **pre‑keys** to the server:
- **Signed pre‑key**: X25519 public key, signed with `identity_sig_priv`. One per user at a time.
- **One‑time pre‑keys**: A batch (e.g., 100) of X25519 public keys, signed with `identity_sig_priv`. Each can be used once.

Pre‑keys are stored in the `prekeys` table with fields `user_id`, `type` (`signed`/`one_time`), `public_key`, `signature`, `used_at` (for one‑time keys). The server never sees private pre‑key material.

### 2.3 1:1 Session Establishment (X3DH + Double Ratchet)

We adopt the **Signal Protocol** (v2) for 1:1 conversations.

#### X3DH Handshake (first message)

When Alice wants to start a chat with Bob (Bob may be offline):
1. Alice fetches Bob’s identity key, signed pre‑key, and an unused one‑time pre‑key from the server.
2. Alice generates an ephemeral X25519 key pair `(A_ephemeral_priv, A_ephemeral_pub)`.
3. Alice computes three Diffie‑Hellman shared secrets:
   - `DH1 = X25519(A_ephemeral_priv, Bob.identity_enc_pub)`
   - `DH2 = X25519(Alice.identity_enc_priv, Bob.signed_prekey_pub)`
   - `DH3 = X25519(A_ephemeral_priv, Bob.one_time_prekey_pub)`
4. The **shared secret** `K = HKDF(DH1 || DH2 || DH3)`.
5. Alice derives a **root key** and initial **chain keys** from `K` and runs the double ratchet to encrypt the first message. She also stores the root key and sending chain state for the session.
6. The first encrypted message includes the following plaintext (not encrypted) for Bob to compute the same shared secret:
   - Alice’s identity public key
   - Alice’s ephemeral public key
   - IDs of Bob’s signed pre‑key and one‑time pre‑key used
   - (Optionally) a signature over the above with Alice’s `identity_sig_priv` for authentication.

Bob, upon receiving the first message:
- Verifies Alice’s signature (if present) using Alice’s identity public key from the user directory.
- Retrieves his private copies of the signed pre‑key and the one‑time pre‑key that match the advertised IDs.
- Performs the same DH computations to obtain the same `K`.
- Derives the identical root key and chain keys, thus establishing a synchronized double‑ratchet session.

**Forward Secrecy**: The double ratchet updates chain keys after each message, deleting old ones. If a long‑term key is compromised, past messages remain secure because the root key depends on ephemeral DH contributions that are not stored.

### 2.4 Group Messaging (Hybrid Sender Keys)

To balance efficiency and forward secrecy, we use a hybrid approach reminiscent of Signal’s sealed sender.

1. **Group Creation**: The creator generates a random 32‑byte **group seed**. For each member (including self), they establish a 1:1 session (via X3DH if not already existing). They then encrypt the group seed with the member’s 1:1 session key (using the ratchet’s current message key) and send it as a **group‑invite system message**. The group seed is stored only in memory on each member’s device; it is never stored on the server.

2. **Sending a Group Message**:
   - The sender generates a fresh random **message key** `K_msg` (32 bytes).
   - Encrypts the plaintext using AES‑256‑GCM with `K_msg`, producing `encrypted_payload` (nonce + ciphertext + tag).
   - For each recipient `R` (all group members):
     - Uses the established 1:1 session with `R` to derive a one‑time message key (via the double ratchet’s symmetric‑key ratchet).
     - Encrypts `K_msg` with that derived key using AES‑256‑GCM, yielding an **encrypted key blob** specific to `R`.
   - The client sends the following to the server:
     ```json
     {
       "conversation_id": "...",
       "sender_id": "...",
       "ttl_seconds": 0,
       "encrypted_payload": "<base64>",
       "recipients": [
         {"user_id": "R1", "encrypted_key": "<base64>"},
         {"user_id": "R2", "encrypted_key": "<base64>"},
         ...
       ]
     }
     ```

3. **Server Storage**:
   - One row in `messages` (see §4) storing `encrypted_payload` and metadata.
   - One row per recipient in `message_recipients` storing the corresponding `encrypted_key` and delivery status.

4. **Delivery**:
   When a recipient connects, the server retrieves all `message_recipients` rows for that user where `delivered_at` is NULL. For each, it sends:
   ```json
     {
       "message_id": "...",
       "encrypted_payload": "...",
       "encrypted_key": "...",
       "sender_id": "...",
       "sent_at": "...",
       "ttl_seconds": ...
     }
     ```
   The client uses its 1:1 session to decrypt `encrypted_key` → `K_msg`, then decrypts `encrypted_payload` → plaintext.

**Forward Secrecy in Groups**: Because each group message uses a fresh `K_msg` and that key is protected by the 1:1 ratchet state, compromise of a device reveals only the sessions that were active on that device. Past group messages remain secure if the ratchet state has already advanced, *unless* the `K_msg` itself was stored on the compromised device (which it is, temporarily while pending delivery). A device compromise exposes all current and future ratchet states, so the blast radius is the entire group. This is a known trade‑off; we accept it given our scale.

### 2.5 What the Server Stores

- **Plaintext** (unencrypted): user profiles (display name, avatar URL), public keys, conversation membership, timestamps, delivery/read receipts, invite metadata, server‑side indexes.
- **Ciphertext** (opaque to the server): `encrypted_payload` (AES‑GCM ciphertext), `encrypted_key` (AES‑GCM ciphertext of `K_msg`). The server cannot compute the underlying keys because they are encrypted with user‑specific 1:1 session keys that only the endpoints possess.

The server *does* know:
- Which users belong to which conversations.
- When a message was sent, its size, and to whom it was delivered.
- Presence information (online/offline, last seen).

### 2.6 Key Restoration on a New Device

A user’s identity private key is the root of trust. The client must back it up securely:
- **Export**: The client can export an encrypted backup file containing:
  - Identity private keys (encryption & signing).
  - All current 1:1 session states (root keys, chain keys, pending messages).
  The backup is encrypted with a strong passphrase using AES‑256‑GCM.
- **Import**: On a new device, the user imports the backup and provides the passphrase. The client decrypts and restores the identity keys and all session states, regaining access to past messages immediately.

Without a backup, the user can only re‑establish sessions from scratch:
- They register the same identity public key (by importing the identity private key).
- For each existing conversation, they initiate a new X3DH handshake (by fetching the contact’s pre‑keys and sending a fresh first message). This creates a **new** session; past messages stored on the server remain encrypted under old session keys and become inaccessible. This is a deliberate trade‑off to preserve forward secrecy.

---

## 3. Invite System

### 3.1 Invite Generation

An authenticated member invokes “Generate Invite” in the UI. The server creates a record:

```sql
INSERT INTO invites (id, inviter_id, token, expires_at)
VALUES (..., ..., <random 32‑byte URL‑safe string>, NOW() + INTERVAL '30 days');
```

The token is a cryptographically random string (e.g., `crypto/rand` 32 bytes, base64url). The server stores the `inviter_id` (the user who created the invite). No other information about the invitee is recorded at this stage.

### 3.2 Invite Redemption

The prospective member receives the token (out‑of‑band). In the client they paste it into the “Join” screen, which sends to the server:

```json
{
  "token": "...",
  "username": "...",
  "password": "...",
  "identity_enc_pub": "...",
  "identity_sig_pub": "..."
}
```

The server:
1. Validates the token exists, is not expired, not revoked, and `used_at` is NULL.
2. Checks that the username is available.
3. Creates a new user with the supplied credentials and public keys, setting `invited_by = inviter_id`.
4. Marks the invite as used (`used_at = NOW(), used_by = new_user_id`).
5. Returns a success response; the client now logs in normally.

### 3.3 Invite Chain (Audit Trail)

The `users` table contains `invited_by` referencing the inviter. To obtain the full invite tree, an admin can run a recursive query (CTE) starting from root users (`invited_by IS NULL`) or from any leaf. This shows exactly who invited whom.

### 3.4 Revocation

- **Unused invites** can be revoked by the inviter or any admin (`UPDATE invites SET revoked = true`).
- **Active members** can be revoked (deactivated) by an admin (`UPDATE users SET is_active = false`). When a user is deactivated:
  - All their unused invites are revoked.
  - Their active WebSocket connections are closed.
  - They are removed from all conversations (rows deleted from `conversation_participants`). Past messages remain stored but the user can no longer decrypt new ones because they won’t receive new session keys.

Revoking a member does not remove messages they already sent; the invite chain remains for historical audit.

### 3.5 Abuse Prevention

- **Rate limiting**: Server limits the number of invites a member can create per day (configurable, e.g., 5/day). Applied at the API layer.
- **Expiration**: Invites expire after 30 days (configurable).
- **Single‑use**: Each token can be redeemed only once; the `used_at` field blocks reuse.
- **Token entropy**: 256‑bit random tokens make brute‑force infeasible.

### 3.6 Privacy & Transfer

- The server does **not** learn the invitee’s identity until redemption. The token itself contains no identity information.
- Tokens can be forwarded; whoever holds the token can use it. The invite chain will point to the person who ultimately registered, not necessarily the intended recipient. This is a known property; if tighter control is needed, the inviter could send the token via a private channel.

---

## 4. Data Model

### 4.1 Core Tables

All tables have `created_at TIMESTAMP DEFAULT NOW()` unless noted.

#### `users`

| Column           | Type         | Description                                                               |
|------------------|--------------|---------------------------------------------------------------------------|
| id               | UUID PK      | Unique user identifier.                                                   |
| username         | VARCHAR(64)  | Unique, not null.                                                         |
| password_hash    | VARCHAR(255) | Bcrypt hash.                                                              |
| display_name     | VARCHAR(128) | Optional public display name.                                             |
| avatar_url       | VARCHAR(512) | URL or path to avatar image.                                              |
| identity_enc_pub | BYTEA        | X25519 public key (32 bytes).                                             |
| identity_sig_pub | BYTEA        | Ed25519 public key (32 bytes).                                            |
| invited_by       | UUID FK      | References `users.id`; NULL for root admin.                              |
| is_active        | BOOLEAN      | Default true; false for deactivated accounts.                            |
| is_admin         | BOOLEAN      | Default false; grants admin panel access.                                 |
| last_seen        | TIMESTAMP    | Updated on WebSocket disconnect.                                         |

#### `prekeys`

| Column       | Type          | Description                                                                 |
|--------------|---------------|-----------------------------------------------------------------------------|
| id           | UUID PK       |                                                                             |
| user_id      | UUID FK       | References `users.id`.                                                      |
| key_type     | ENUM          | 'signed' or 'one_time'.                                                    |
| key_id       | INTEGER       | Unique per user for that type; used to reference the key in X3DH.          |
| public_key   | BYTEA         | X25519 public key (32 bytes).                                              |
| signature    | BYTEA         | Ed25519 signature over `public_key` by `identity_sig_priv`.               |
| used_at      | TIMESTAMP NULL| Set when a one‑time pre‑key is used; NULL for unused.                      |
| created_at   | TIMESTAMP     |                                                                             |

Indexes: `(user_id, key_type, key_id)` unique; `(user_id, key_type, used_at)` for fetching unused one‑time keys.

#### `invites`

| Column      | Type         | Description                                                            |
|-------------|--------------|------------------------------------------------------------------------|
| id          | UUID PK      |                                                                        |
| inviter_id  | UUID FK      | References `users.id`.                                                 |
| token       | VARCHAR(64)  | Unique random string.                                                  |
| created_at  | TIMESTAMP    | Default now.                                                           |
| expires_at  | TIMESTAMP    |                                                                        |
| revoked     | BOOLEAN      | Default false.                                                         |
| used_at     | TIMESTAMP NULL| Set when token is redeemed.                                            |
| used_by     | UUID FK NULL | References `users.id` of the user who used the token.                 |

Indexes: `token` unique.

#### `conversations`

| Column               | Type         | Description                                                              |
|----------------------|--------------|--------------------------------------------------------------------------|
| id                   | UUID PK      |                                                                          |
| type                 | ENUM         | 'direct' or 'group'.                                                     |
| name                 | VARCHAR(128) NULL | For groups; NULL for direct chats.                                   |
| avatar_url           | VARCHAR(512) NULL | Group avatar.                                                          |
| creator_id           | UUID FK      | References `users.id`; the user who created the conversation.           |
| created_at           | TIMESTAMP    | Default now.                                                             |
| ephemeral_default    | INTEGER NULL | Default TTL (seconds) for new messages in this conversation.             |

#### `conversation_participants`

| Column            | Type         | Description                                                              |
|-------------------|--------------|--------------------------------------------------------------------------|
| conversation_id   | UUID FK      | References `conversations(id)`.                                          |
| user_id           | UUID FK      | References `users(id)`.                                                  |
| joined_at         | TIMESTAMP    | Default now.                                                             |
| role              | ENUM         | 'admin' or 'member'; relevant for groups only.                          |
| PRIMARY KEY       | (conversation_id, user_id)                                              |

Indexes: `(user_id, conversation_id)` for lookup of a user’s conversations.

#### `messages`

| Column               | Type         | Description                                                              |
|----------------------|--------------|--------------------------------------------------------------------------|
| id                   | UUID PK      |                                                                          |
| conversation_id      | UUID FK      | References `conversations(id)`.                                          |
| sender_id            | UUID FK      | References `users(id)`.                                                  |
| sent_at              | TIMESTAMP    | Server‑assigned time; default now.                                       |
| ttl_seconds          | INTEGER NULL | If set, message is ephemeral after this many seconds **from delivery**. |
| encrypted_payload    | BYTEA        | AES‑256‑GCM ciphertext: nonce(12) + ciphertext + tag(16).               |

#### `message_recipients`

| Column               | Type         | Description                                                              |
|----------------------|--------------|--------------------------------------------------------------------------|
| id                   | BIGSERIAL PK|                                                                          |
| message_id           | UUID FK      | References `messages(id)`.                                               |
| user_id              | UUID FK      | References `users(id)`.                                                  |
| encrypted_key        | BYTEA        | AES‑256‑GCM ciphertext of the per‑message key `K_msg` for this user; format: nonce + ciphertext + tag. |
| delivered_at         | TIMESTAMP NULL| Set when the server has successfully pushed the message to the client.  |
| read_at              | TIMESTAMP NULL| Set when the client acknowledges read.                                   |
| expires_at           | TIMESTAMP NULL| If `ttl_seconds` set, set to `delivered_at + ttl_seconds`.               |
| created_at           | TIMESTAMP    | Default now.                                                             |

Indexes: `(user_id, delivered_at, expires_at)` for pulling undelivered/active messages.

### 4.2 Encryption Markings

- `encrypted_payload` and `encrypted_key` are client‑generated ciphertext; the server treats them as opaque blobs.
- All other fields (including timestamps, user IDs, conversation IDs) are plaintext and used for routing and UI.

### 4.3 Optional File Storage

Files are handled analogously to group messages:

1. Client encrypts the file with a random 32‑byte key, uploads the ciphertext to the server (stored under a filesystem path/UUID).
2. Server creates a `files` row:
   - `id`, `uploader_id`, `filename`, `content_type`, `size`, `path`.
3. For each recipient, the client sends an encrypted version of the file‑key (using the 1:1 session) in a `file_shares` table:
   - `file_id`, `user_id`, `encrypted_key` (same format as `message_recipients.encrypted_key`).
4. A normal text message can reference the file by its `id` so recipients can download and decrypt.

---

## 5. Real‑Time Protocol

### 5.1 Transport

- **WebSocket over TLS** (wss://). Chosen for full‑duplex, low latency, and wide support.
- The initial HTTP handshake authenticates the user via a session cookie (HttpOnly, Secure) or a bearer token in the `Sec-WebSocket-Protocol` header.

### 5.2 Message Flow

#### Sending a Message (client → server)

Client sends a JSON WebSocket frame:

```json
{
  "type": "message",
  "conversation_id": "uuid",
  "ttl_seconds": 0,
  "encrypted_payload": "<base64>",
  "recipients": [
    {"user_id": "uuid", "encrypted_key": "<base64>"}
  ]
}
```

The server:
1. Verifies the sender is a participant of the conversation.
2. Inserts a row into `messages` (`encrypted_payload`, `sender_id`, `conversation_id`, `ttl_seconds`).
3. For each entry in `recipients`, inserts a row into `message_recipients` (`message_id`, `user_id`, `encrypted_key`). For the sender themselves, the client includes a recipient entry (so the message appears in their own view).
4. For each online recipient (tracked via WebSocket connections), immediately pushes:
   ```json
     {
       "type": "message",
       "message_id": "...",
       "encrypted_payload": "...",
       "encrypted_key": "...",
       "sender_id": "...",
       "sent_at": "...",
       "ttl_seconds": ...
     }
     ```
   and updates `message_recipients.delivered_at` to `NOW()`.
5. For offline recipients, the `delivered_at` remains NULL; the row stays in the table.

#### Receiving a Message (server → client)

Client receives the frame, verifies the `message_id` is not already processed (deduplication via cache), decrypts `encrypted_key` with its 1:1 session state to obtain `K_msg`, then decrypts `encrypted_payload` to plaintext. The client may then:
- Send an **ACK** to mark delivery (if server hasn’t already):
  ```json
    {"type": "ack", "message_id": "..."}
  ```
- Optionally send a **read receipt** after the user views the message:
  ```json
    {"type": "read", "message_id": "..."}
  ```

The server on ACK sets `message_recipients.delivered_at` (if not already). On read, sets `read_at`.

#### Delivery & Read Receipts

- **Delivery**: Either the server marks `delivered_at` immediately after pushing, or upon receiving the client’s ACK. We choose explicit ACK to handle socket failures: if push fails, the row stays undelivered and will be retried on next reconnect.
- **Read**: The `read_at` timestamp is set by the server only after the client’s explicit read event.

#### Typing Indicators

Ephemeral, non‑persistent events:

- Client sends: `{"type": "typing_start", "conversation_id": "..."}` or `typing_stop`.
- Server broadcasts to all other participants in that conversation (excluding the sender) via a WebSocket frame:
  ```json
    {"type": "typing", "user_id": "...", "conversation_id": "...", "typing": true}
  ```
- No storage; rate‑limited to a few per second per user.

#### Presence

- When a WebSocket connection opens, the server increments the user’s connection count; if it goes from 0→1, it broadcasts a `"online"` event to all users who share at least one conversation.
- On close, it decrements; when count reaches 0, it broadcasts `"offline"` and updates `users.last_seen`.
- The view of presence is coarse‑grained (online/offline) to reduce chatter.

#### Offline Message Retrieval

When a user connects, the server queries:

```sql
SELECT mr.id, m.encrypted_payload, mr.encrypted_key, m.sender_id, m.sent_at, m.ttl_seconds
FROM message_recipients mr
JOIN messages m ON mr.message_id = m.id
WHERE mr.user_id = $1
  AND mr.delivered_at IS NULL
ORDER BY m.sent_at ASC;
```

It then streams the messages (possibly in batches) to the client, marking `delivered_at` after each successful push (or after ACK).

#### Ordering

Messages are ordered by `sent_at` (server timestamp with microsecond precision). If two messages have the same `sent_at` (unlikely), the `messages.id` UUID provides a total order (lexicographically). Clients sort incoming messages by these fields before displaying.

---

## 6. Self‑Hosting & Operations

### 6.1 Recommended Deployment (Docker Compose)

```yaml
version: '3.8'
services:
  db:
    image: postgres:15
    restart: always
    environment:
      POSTGRES_USER: secretsociety
      POSTGRES_PASSWORD: <secure‑password>
      POSTGRES_DB: secretsociety
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "secretsociety"]
      interval: 10s
      timeout: 5s
      retries: 5

  app:
    build: .
    restart: always
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://secretsociety:<secure‑password>@db:5432/secretsociety?sslmode=disable
      JWT_SECRET: <long‑random‑string>
      SMTP_HOST: <optional>
      SMTP_PORT: 587
      SMTP_USER: ...
      SMTP_PASS: ...
      ADMIN_EMAIL: ...
    volumes:
      - ./data/files:/app/data/files
      - ./backups:/app/backups
    expose:
      - "8080"
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  nginx:
    image: nginx:alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
      - ./static:/usr/share/nginx/html:ro   # built client
    depends_on:
      - app
```

The `app` Dockerfile builds a single Go binary. A typical `nginx.conf` does TLS termination (Let’s Encrypt) and proxies `/api` and `/ws` to `app:8080`.

### 6.2 External Dependencies

- **Domain name** pointing to the server.
- **TLS certificates**: Use Let’s Encrypt (certbot) or self‑signed for internal use.
- **SMTP** (optional): For sending invite emails automatically. Configurable; can be disabled.
- **Disk storage**: Sufficient capacity for messages and files (small for text, larger if file sharing enabled).

### 6.3 Backup & Restore

- **Database**: Nightly `pg_dump` to a secure off‑site location. Keep rotations (e.g., 7 daily, 4 weekly). The dump is plaintext (including encrypted blobs), so protect it like the server.
- **File Storage**: Rsync or similar to a backup server. Include the `data/files` directory.
- **App Config**: Keep environment variables and `docker-compose.yml` under version control (sans secrets) or store secrets in a vault.
- **Restore Procedure**:
  1. Deploy fresh system (or from backup of config).
  2. Restore PostgreSQL from dump (`psql`).
  3. Copy file storage back.
  4. Re‑create Docker volumes if needed.
  5. Start services.

**Key Material Backup**: Users are responsible for exporting their identity private keys and session backups (client feature). The server does **not** store any private keys, so there is no server‑side key backup.

### 6.4 Monitoring & Maintenance

- **Health endpoint**: `GET /health` returns 200 if DB reachable.
- **Logs**: Collect `app` container logs (structured JSON) to a file or stdout, aggregate with `docker logs` or a lightweight agent.
- **Metrics** (optional): Expose `/metrics` in Prometheus format; monitor active WebSocket connections, DB pool usage, disk space.
- **Alerts**: Set up a cron‑based script that checks:
  - Container status (`docker ps`).
  - Disk usage (`df -h`).
  - DB backups existence.
  - Recent errors in logs.
- **Upgrades**: Build new Docker image, run `docker-compose pull && docker-compose up -d`. Database migrations are applied automatically on startup (using a tool like `golang-migrate`).

### 6.5 Admin Panel

Admins access `/admin` (HTTPS) after login with `is_admin` flag. Features:
- **User Management**: List users, toggle `is_active`, view `invited_by` chain.
- **Invite Management**: List generated invites, revoke unused ones.
- **Conversation/Group Management**: Create groups, add/remove members, rename, change avatar.
- **Audit Logs**: (Optional) View system events like message deletions, key rotations.

---

## 7. Threat Model

### 7.1 Adversaries

1. **Malicious Server Operator** (the host of the VPS).
2. **External Attacker** who exfiltrates the server database or intercepts network traffic.
3. **Compromised Client Device** (theft, malware).

### 7.2 Server Operator Capabilities

- **Full Metadata Visibility**:
  - All user profiles (display names, avatars).
  - Social graph: `invited_by` relationships, conversation participants, group memberships.
  - Timing and size of every message, delivery/read status.
  - Presence (online/offline) and typing indicators.
- **Message Content**: **Cannot** decrypt `encrypted_payload` or `encrypted_key` because the server lacks the 1:1 session keys and the random `K_msg` per message. Even with access to the database, ciphertexts are computationally infeasible to break (AES‑256‑GCM).
- **Active Attacks**:
  - **Drop or delay messages**: by not forwarding WebSocket frames, but clients may notice lack of delivery/read receipts.
  - **Reorder messages**: by delivering out of order; clients sort by `sent_at`.
  - **Inject fake messages**: impossible without forging a valid `encrypted_key` for some recipient, which requires that recipient’s 1:1 session key (the server does not have them).
  - **Tamper with payloads**: detected because AES‑GCM authentication tags would fail.
  - **Impersonate a user**: would require the user’s password (to log in) or their identity private key (not stored on server). With the password hash, an offline brute‑force attack could recover weak passwords.
  - **Steal files**: stored encrypted; server cannot decrypt without the file‑key which is sent via `file_shares.encrypted_key`.

**Mitigations**:
- Use TLS everywhere to prevent network eavesdropping.
- Enforce strong passwords (client‑side hashing before transmission? Better: server bcrypt, encourage long passwords).
- Encourage users to back up their identity keys securely.
- Server operator is a **trusted** party in this self‑hosted model; the design assumes the operator does not maliciously disrupt service. However, the cryptographic design ensures confidentiality even against a malicious operator.

### 7.3 Database Exfiltration

If an attacker obtains the PostgreSQL dump:
- They gain all **plaintext metadata** (user info, contacts, conversations, timestamps, invite tree).
- They gain **ciphertext** (`encrypted_payload`, `encrypted_key`). Without the corresponding 1:1 session keys (stored only on devices), they cannot decrypt message contents.
- They could attempt to crack weak user passwords (bcrypt hashes) and then log in as the user. Once logged in, they can:
  - View the user’s **future** traffic (by receiving new encrypted payloads) because they now have the active 1:1 sessions (the server will generate new encrypted keys using the compromised session state? Actually, the server does not store session state; it relies on the client’s ratchet state. When the attacker logs in with the user’s password, they must also present the user’s identity public key? The login flow does not involve private keys. After login, the server creates a new WebSocket connection for that session. The client (attacker) will have the user’s identity private key only if they also extracted it from a compromised device (unlikely from DB alone). If they only have the password, they cannot decrypt past messages because they lack the identity private key and past session keys. They can only send/receive new messages, and for those, the server will use the current session state that the client (attacker) maintains. This effectively gives the attacker the ability to impersonate the user going forward, but not to read historical encrypted blobs.
- **Conclusion**: Historical message confidentiality remains intact as long as user devices are not compromised. The biggest risk is the social graph and activity patterns being exposed.

### 7.4 Single Device Compromise

If an attacker gains physical or remote access to a user’s device, they obtain:
- The user’s **identity private keys** (encryption & signing).
- All current **double‑ratchet session states** for every conversation (root keys, chain keys).
- Any **backup file** containing the above (if present).

Consequences:
- The attacker can decrypt **all past and future messages** in every conversation that the user participates in, because they have the necessary keys.
- They can **impersonate** the user: send messages, read receipts, typing indicators, etc.
- They can download any files shared with the user (by using the stored file keys).
- The compromise does **not** affect other users’ private keys, but it compromises the confidentiality of all conversations that include the victim.

**Mitigation**:
- Encourage device encryption and strong screen locks.
- Provide a “log out all devices” feature that deletes the user’s pre‑keys on the server, forcing re‑keying with remaining devices. However, this does not remove the compromised device’s ability to decrypt already stored messages if it still has local storage.
- Allow users to create a new identity key pair (rotate keys), which would require all contacts to re‑establish sessions, cutting off the attacker. This is a manual recovery process.

### 7.5 Invite System Attacks

- **Token Brute‑Force**: The token is 256‑bit random; guessing is infeasible. Rate‑limiting on the verification endpoint is enforced.
- **Replay**: Each token is single‑use; subsequent attempts fail.
- **Token Theft**: If a token is intercepted, the attacker can create an account. The server only sees which inviter produced the token; it cannot distinguish the intended invitee. The blast radius is limited to one account.
- **Invite Flood**: Rate‑limiting per member prevents mass generation.
- **Social Engineering**: The system cannot stop a malicious member from inviting an attacker; this is a policy issue, not a cryptographic one.

### 7.6 Limitations

- **No deniability**: Messages are authenticated with the sender’s identity key (via the ratchet). A third party (including server) can verify that a message originated from the holder of the private key, but recipients can also prove to others that a message came from the sender (non‑repudiation). If deniability is required, we could switch to a scheme using symmetric‑key ratchets without signatures, but that’s out of scope.
- **Server Availability**: DoS attacks can disrupt service. Since it’s self‑hosted, the operator is responsible for network security and rate‑limiting.
- **Recovery Complexity**: Users must manually back up their identity keys and optionally session state; otherwise they lose history.

---

## 8. Trade‑offs Summary

| Decision                                   | Trade‑off                                                                 |
|---------------------------------------------|---------------------------------------------------------------------------|
| **Signal‑style double ratchet for 1:1**     | Strong security, forward secrecy, but requires more state and CPU.       |
| **Hybrid group messaging**                 | Efficient storage vs. perfect forward secrecy; group key exposure on device compromise. |
| **Single identity key per user**            | Simplicity; multi‑device support requires manual key sharing/backup.     |
| **Server‑side delivery receipts via ACK**  | Slightly more round‑trips; more robust against socket failures.          |
| **Ephemeral TTL based on delivery**        | Prevents server from deleting undelivered messages; server retains until delivered then TTL expires. |
| **No automatic key rotation**              | Simpler implementation; forward secrecy is still provided by ratchet.     |
| **Invite tokens without bound identity**   | Privacy‑preserving, but allows token sharing and limits traceability.    |

This design meets the requirements of a small, self‑hosted, end‑to‑end‑encrypted community chat while keeping operational complexity manageable for a technically competent individual.