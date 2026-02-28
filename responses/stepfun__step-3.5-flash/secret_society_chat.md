# Secret Society: System Design Document

## 1. Architecture Overview

### High-Level Architecture
Secret Society follows a classic client-server architecture with **zero-knowledge server** principles. The server is a message router and encrypted blob store, incapable of decrypting content. All cryptographic operations happen client-side.

```
+----------------+       WebSocket / HTTPS       +-----------------+
|    Client      |<---------------------------->|   Secret Society |
| (Web/Mobile)   |                              |     Server      |
+----------------+                              +-----------------+
                                                      |
                                                      | SQLite
                                                      v
                                            +-----------------+
                                            |   Local Disk    |
                                            | (Encrypted Blobs)|
                                            +-----------------+
```

### Component Breakdown

**1. Client Application**
- **Platform**: Single-page web app (React/Vue) using Web Crypto API; optional React Native mobile apps.
- **Responsibilities**:
  - Key management (generate, store, backup)
  - End-to-end encryption/decryption
  - UI for chats, groups, invites
  - Local storage of messages & keys (IndexedDB)
- **Why browser-based?** Reduces deployment friction; users access via URL. No app store dependencies.

**2. Server**
- **Language**: Node.js (Express + ws for WebSockets)
- **Responsibilities**:
  - WebSocket connection multiplexing
  - Message routing & offline queueing
  - Invite token validation & chain tracking
  - User/group metadata management
  - Serves static client files
  - File blob storage (upload/download endpoints)
- **Why Node.js?** Non-blocking I/O fits real-time messaging; single-threaded but sufficient for 1k users; extensive library ecosystem.

**3. Database**
- **Engine**: SQLite (file-based, zero-config)
- **Why SQLite?** Perfect for single-VPS deployment; handles 1k users easily; atomic transactions; no separate process.
- **Trade-off**: Limited concurrency (but 1k users isn’t heavy); no built-in replication (we’ll handle backups manually).

**4. File Storage**
- Local filesystem under `/var/app/uploads/`
- Encrypted blobs named by UUID; no directory traversal risks.
- Trade-off: Disk space must be monitored; no CDN (but 1k users, small files).

**5. Deployment Stack**
```
Docker Compose (simplified):
  - app: Node.js server (port 3000)
  - nginx: reverse proxy (port 443, handles TLS)
  - volume: ./data:/var/app (SQLite DB + uploads)
```
- **Why Docker?** Single-command deployment; isolates dependencies.
- **Alternative**: Bare Node.js + PM2 (even simpler for non-devops users). Provide both options.

**What runs where?**
- All components on a single VPS (2GB RAM, 1 vCPU sufficient).
- nginx terminates TLS, proxies HTTP/WebSocket to Node.js.
- SQLite DB file at `/var/app/data/secretsociety.db`.
- Uploaded files at `/var/app/data/uploads/`.

---

## 2. End-to-End Encryption Design

### Cryptographic Primitives
- **Curve**: X25519 (ECDH) for key agreement, Ed25519 for signatures.
- **Symmetric**: AES-256-GCM for message encryption.
- **KDF**: HKDF-SHA256.
- **Ratcheting**: Double Ratchet Algorithm (as in Signal Protocol).

### Per-User Identity
- Each user generates on registration:
  - **Identity Key Pair** (long-term): `IK_priv`, `IK_pub` (Ed25519)
  - **Prekey Pair** (medium-term, rotated monthly): `SPK_priv`, `SPK_pub` (X25519), signed by `IK_priv`.
- **Public keys stored on server** (in `users` table):
  - `identity_key_pub` (Ed25519 public key)
  - `signed_prekey_pub` (X25519 public key)
  - `signed_prekey_sig` (signature over `signed_prekey_pub` by `IK_priv`)

### 1:1 Chat Session Setup (X3DH)
1. **Alice** wants to chat with **Bob**.
2. Alice fetches Bob’s prekey bundle from server: `{ identity_key_pub: IK_B, signed_prekey_pub: SPK_B, signed_prekey_sig }`.
3. Alice verifies `signed_prekey_sig` using `IK_B` → authenticates Bob’s prekey.
4. Alice generates **ephemeral key pair**: `EK_A_priv`, `EK_A_pub` (X25519).
5. Alice computes DH shared secrets:
   - `DH1 = ECDH(EK_A_priv, IK_B)`
   - `DH2 = ECDH(IK_A_priv, SPK_B)`
   - `DH3 = ECDH(EK_A_priv, SPK_B)`? Actually, standard X3DH uses:
     ```
     DH1: EK_A with IK_B
     DH2: IK_A with SPK_B
     DH3: EK_A with OPK_B (if one-time prekey used; we skip for simplicity)
     ```
   - We skip one-time prekeys to reduce complexity; accept that if `SPK_B` is compromised, all past initial sessions are compromised. For forward secrecy in the initial exchange, we’d need one-time prekeys, but given our scale and trusted community, we trade this for simplicity.
6. Alice concatenates DH outputs → `shared_secret = DH1 || DH2`.
7. Alice derives **root key** `RK` via HKDF from `shared_secret`.
8. Alice encrypts first message with a **chain key** derived from `RK` (using Double Ratchet).
9. Alice sends to Bob via server:
   ```json
   {
     "from": "alice_id",
     "to": "bob_id",
     "ephemeral_pub": base64(EK_A_pub),
     "ciphertext": base64(encrypted_message),
     "msg_counter": 0,
     "prev_counter": null
   }
   ```
10. **Bob** receives, uses his `SPK_B_priv` and `IK_B_priv` + Alice’s `IK_A_pub` (from server) and `EK_A_pub` to compute same `shared_secret`. Then derives `RK` and decrypts.

**Forward Secrecy**:
- Achieved via Double Ratchet: each message uses a new key derived from previous chain key and a new DH exchange after every message (or every few messages). If a long-term key (`IK_priv`) is compromised, past messages remain secure because chain keys are deleted after use.
- **Compromise response**: User rotates identity key (new `IK_pair`), which breaks all existing sessions. Contacts must re-establish sessions (fetched new `IK_pub` from server).

### Group Chats
- **Group Key**: Symmetric key `GK` (256-bit random) per group.
- **Distribution**:
  1. Group admin (creator) generates `GK`.
  2. For each member (including self), admin establishes a 1:1 session (as above) if not already.
  3. Admin encrypts `GK` with the 1:1 session’s **sending chain key** (from Double Ratchet).
  4. Admin sends encrypted `GK` to each member via 1:1 message.
  5. Member decrypts with their 1:1 receiving chain key and stores `GK` (encrypted at rest on device? No, stored in memory/IndexedDB encrypted with device key? Actually, we store it in the client’s memory, but we’ll encrypt with a local key derived from user’s identity? Not necessary; the Double Ratchet already protects it in transit. At rest, we can encrypt all chat keys with a master key derived from `IK_priv`? But if device is compromised, all keys are exposed anyway. So we store `GK` in IndexedDB without additional encryption? That’s okay because the device is trusted.
- **Sending group message**:
  - Sender encrypts message with `GK` (AES-256-GCM) + a random nonce.
  - Sends to server with `group_id`.
- **Receiving**: Member decrypts with stored `GK`.
- **Member leave/revoke**:
  - Admin generates new `GK'`.
  - Re-encrypts `GK'` for all remaining members via 1:1 sessions.
  - Sends new `GK'` in 1:1 messages.
  - Old `GK` is discarded; future messages use `GK'`.
- **Forward secrecy in groups**: Not provided. If a member’s device is compromised, all past group messages (encrypted with the same `GK`) are decrypted. Trade-off: rekeying only on membership change.

### Message Storage & Retrieval
- **Server stores**:
  - Encrypted message payload (AES-GCM ciphertext + auth tag + nonce)
  - Metadata: `sender_id`, `chat_id` (1:1 or group), `timestamp`, `msg_counter` (for ordering), `type` (text/file).
- **Client retrieves**:
  - On sync, client requests all messages since last sync (by timestamp or counter) for each chat.
  - Server returns encrypted blobs; client decrypts with appropriate key (1:1 chain key or `GK`).
- **Why store counter?** Double Ratchet requires counters to derive correct chain keys; server stores `msg_counter` per sender per chat to help client skip missing messages? Actually, client tracks counters. Server just stores for reference? We might not need to store counter; client includes counter in encrypted envelope? But then server can’t sort. We store `sender_counter` per message to order messages from same sender.

### Key Restoration on New Device
1. User installs client on new device.
2. User authenticates with identity key (signs server challenge).
3. User downloads **encrypted backup** from server (if they enabled backup):
   - Backup contains: `IK_priv`, `SPK_priv`, all 1:1 session states (root key, chain keys, counters), all group keys `GK`.
   - Backup encrypted with **user-chosen passphrase** (Argon2id-derived key).
4. User enters passphrase → decrypts backup → restores keys.
5. **Without backup?** User must re-establish all 1:1 sessions (contacts must resend `GK` for groups). Since server doesn’t store private keys, loss means loss of chat history and keys.

### Server’s View
Server stores and can observe:
- **Metadata**: Who sends to whom/which group, timestamps, message sizes, file sizes.
- **Encrypted blobs**: Ciphertexts (inaccessible).
- **Key material**: Only public keys (`IK_pub`, `SPK_pub`).
- **Invite chain**: Plaintext (who invited whom).
- **Cannot observe**: Message content, file content, group keys, private keys.

---

## 3. Invite System

### Invite Generation
- Existing member (inviter) clicks “Invite” in UI.
- Client generates **invite token**: `invite_id = random(32 bytes)` (URL-safe base64).
- Client sends to server: `{ invite_id, inviter_id, expires_at = now+30d, max_uses=1 }`.
- Server stores **hash** of `invite_id` (`invite_token_hash = SHA256(invite_id)`) to prevent token leakage from DB. Also stores `inviter_id`, `expires_at`, `max_uses`, `used_count=0`.
- Server returns plain `invite_id` to inviter (to share out-of-band).

### Invite Validation & Joining
1. Invitee receives `invite_id` (via email, Signal, in-person).
2. Invitee opens app, enters `invite_id`.
3. Client sends `{ invite_id, identity_key_pub, signed_prekey_pub, signed_prekey_sig }` to server.
4. Server:
   - Hashes `invite_id` → looks up `invite_token_hash`.
   - Checks `expires_at`, `used_count < max_uses`.
   - **Critical**: Validates `signed_prekey_sig` using `identity_key_pub` (ensures invitee controls private keys).
   - Creates user account with `identity_key_pub`, `signed_prekey_pub`.
   - Increments `used_count`.
   - Records `invited_by = inviter_id` in new user’s record.
5. Server returns success → invitee can log in.

**Privacy**: Server does not know invitee’s chosen display name/avatar until after they join. The invite token is anonymous until used.

### Invite Chain Auditing
- `users` table has `invited_by` (foreign key to `users.id`).
- Admin panel allows recursive query: “Show all descendents of user X”.
- Chain is immutable (even if inviter is removed, `invited_by` remains).
- Example: A invites B, B invites C. If A is removed, chain remains: C `invited_by`=B, B `invited_by`=A.

### Revocation & Removal
- **Revoke invite**: Admin deletes invite token (or sets `max_uses=0`). Prevents further use.
- **Remove member**:
  - Admin sets `user.active = false` (soft delete).
  - All groups where user is admin? Transfer admin? Or require other admin to re-add groups.
  - **Invite chain**: `invited_by` remains; removed user’s invites are invalidated (cannot be used).
  - **Group messages**: User is removed; if they were admin, a new admin must be designated. Group key is rekeyed (without removed user).

### Abuse Prevention
- **Rate limiting**: Max 5 invites per member per month (configurable).
- **Token bounds**: `max_uses=1`, `expires_at=30d`.
- **No transfer logging**: Server doesn’t track who token was shared with; only who ultimately used it.
- **Replay prevention**: Token hash is single-use; server rejects reuse.
- **No mass generation**: Per-user limit enforced server-side.
- **Sybil attack resistance**: Invite chain creates social graph; admin can audit suspicious patterns.

---

## 4. Data Model (SQLite Schema)

```sql
-- Users
CREATE TABLE users (
    id TEXT PRIMARY KEY,           -- UUID
    username TEXT UNIQUE NOT NULL, -- for login? Actually, we use identity key for auth? We need a username for display? Let's have:
    display_name TEXT NOT NULL,
    avatar_url TEXT,               -- path to uploaded avatar
    identity_key_pub TEXT NOT NULL, -- Ed25519 public key (base64)
    signed_prekey_pub TEXT NOT NULL, -- X25519 public key (base64)
    signed_prekey_sig TEXT NOT NULL, -- Ed25519 signature of prekey_pub
    invited_by TEXT,               -- NULL for first member (admin)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    active BOOLEAN DEFAULT 1,
    FOREIGN KEY (invited_by) REFERENCES users(id)
);

-- Prekeys (optional one-time prekeys; we skip for simplicity, using only signed_prekey)
-- If we add one-time prekeys later:
-- CREATE TABLE prekeys (
--     id INTEGER PRIMARY KEY,
--     user_id TEXT NOT NULL,
--     prekey_pub TEXT NOT NULL,
--     used BOOLEAN DEFAULT 0,
--     FOREIGN KEY (user_id) REFERENCES users(id)
-- );

-- Groups
CREATE TABLE groups (
    id TEXT PRIMARY KEY,          -- UUID
    name TEXT NOT NULL,
    avatar_url TEXT,
    created_by TEXT NOT NULL,     -- user.id
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Group Members
CREATE TABLE group_members (
    group_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    role TEXT DEFAULT 'member',   -- 'admin' or 'member'
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES groups(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 1:1 Chats (implicit from messaging? We don’t need a table; we can derive from messages. But for listing chats, we need a table):
CREATE TABLE one_to_one_chats (
    user_a_id TEXT NOT NULL,
    user_b_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_a_id, user_b_id),
    FOREIGN KEY (user_a_id) REFERENCES users(id),
    FOREIGN KEY (user_b_id) REFERENCES users(id)
);
-- Note: always store with user_a_id < user_b_id lexicographically to avoid duplicates.

-- Messages (encrypted payloads)
CREATE TABLE messages (
    id TEXT PRIMARY KEY,          -- UUID
    chat_id TEXT NOT NULL,        -- group.id or one_to_one_chats composite? Actually, we need to distinguish. Let's have:
    chat_type TEXT NOT NULL,      -- 'group' or 'one_to_one'
    sender_id TEXT NOT NULL,
    encrypted_body TEXT NOT NULL, -- base64(AES-GCM ciphertext + tag + nonce)
    sender_counter INTEGER NOT NULL, -- Monotonically increasing per sender per chat
    timestamp TIMESTAMP NOT NULL, -- Server time (for ordering)
    file_id TEXT,                 -- NULL for text; references files.id if file attached
    FOREIGN KEY (sender_id) REFERENCES users(id)
);

-- Read receipts (only for 1:1)
CREATE TABLE read_receipts (
    message_id TEXT NOT NULL,
    reader_id TEXT NOT NULL,
    read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (message_id, reader_id),
    FOREIGN KEY (message_id) REFERENCES messages(id),
    FOREIGN KEY (reader_id) REFERENCES users(id)
);

-- Files (encrypted blobs)
CREATE TABLE files (
    id TEXT PRIMARY KEY,          -- UUID
    chat_id TEXT NOT NULL,        -- group.id or one_to_one_chats composite? Same as messages.
    chat_type TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    encrypted_key TEXT NOT NULL,  -- GK-encrypted file key (base64)
    iv TEXT NOT NULL,             -- for file encryption
    filename_encrypted TEXT NOT NULL, -- AES-GCM encrypted filename (base64)
    mime_type_encrypted TEXT,    -- optional, encrypted
    size INTEGER NOT NULL,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
);
-- Actual file stored at /var/app/uploads/{id}

-- Invite tokens
CREATE TABLE invite_tokens (
    token_hash TEXT PRIMARY KEY,  -- SHA256(invite_id)
    invite_id TEXT NOT NULL,      -- plain token (only shown once to inviter)
    inviter_id TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    max_uses INTEGER DEFAULT 1,
    used_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (inviter_id) REFERENCES users(id)
);

-- Online presence (optional: we use last_seen in users)
ALTER TABLE users ADD COLUMN last_seen TIMESTAMP;

-- Indexes
CREATE INDEX idx_messages_chat ON messages(chat_id, chat_type, timestamp);
CREATE INDEX idx_read_receipts_reader ON read_receipts(reader_id);
```

**Encryption boundaries**:
- **Client-side encrypted fields** (before sending to server):
  - `encrypted_body` (message text)
  - `encrypted_key` in `files` (file key encrypted with GK)
  - `filename_encrypted`, `mime_type_encrypted`
- **Server sees plaintext**:
  - All other fields (metadata, IDs, timestamps, user/group info).

---

## 5. Real-Time Protocol

### Transport: WebSocket (over TLS)
- **Why WebSocket?** Full-duplex, low latency, efficient for small messages; supports binary (good for file metadata).
- **Fallback**: Long-polling via HTTP for initial sync if WebSocket unavailable? Not needed for web; mobile apps can use same.

**Connection flow**:
1. Client loads SPA from server (`/`).
2. Client performs **challenge-response auth**:
   - Server sends random `nonce` over WebSocket after connect.
   - Client signs `nonce` with `IK_priv` → sends `{ type: "auth", user_id, signature }`.
   - Server verifies with `identity_key_pub` from DB; if valid, marks WebSocket as authenticated for `user_id`.
3. Server tracks: `user_id → WebSocket connection`.

### Message Routing
- **1:1 message**:
  ```json
  // Client A → Server
  {
    "type": "message",
    "to": "user_b_id",
    "chat_type": "one_to_one",
    "ciphertext": "base64(...)", // AES-GCM ciphertext + tag + nonce
    "sender_counter": 42,        // from A’s counter for this chat
    "timestamp": 1234567890      // client time? or server assigns? Server assigns to prevent clock skew.
  }
  ```
  - Server:
    - Checks `user_b_id` is active and in `one_to_one_chats` with A? Actually, we don’t enforce chat existence; if A has never chatted with B, server creates `one_to_one_chats` row implicitly? Better: server allows sending to any user (since it’s E2E, server doesn’t care). But for listing chats, we need the table. So server creates row on first message.
    - Looks up B’s WebSocket. If online, forwards message. If offline, stores in `messages` (with `chat_id` determined by sorting user ids).
    - Also stores in `messages` for history.

- **Group message**:
  ```json
  {
    "type": "message",
    "to": "group_id",
    "chat_type": "group",
    "ciphertext": "...",
    "sender_counter": 15,
    "timestamp": ...
  }
  ```
  - Server:
    - Verifies sender is member of group (`group_members`).
    - For each online member (except sender), forwards message.
    - For offline members, stores in `messages` (with `chat_id = group_id`).

- **File upload**:
  1. Client encrypts file with random `file_key` (AES-GCM).
  2. Client uploads encrypted blob: `POST /upload` → body: `{ file_key_encrypted: base64(GK-encrypted file_key), iv: base64, filename_encrypted: base64, mime_type_encrypted }`? Actually, we need to store the encrypted file somewhere.
     - Better: Client does:
        - Encrypts file: `ciphertext = AES-GCM(file, file_key, iv)`.
        - Uploads `ciphertext` as binary to `/upload` → server returns `file_id`.
        - Then sends chat message with `file_id` and `file_key_encrypted` (encrypted with GK) in `encrypted_body`.
     - But then server stores `ciphertext` but doesn’t know it’s a file? It’s just a blob. The message references it.
     - So `files` table only stores metadata (encrypted key, iv, encrypted filename, size). The actual encrypted file is stored on disk as `/var/app/uploads/{file_id}`.
  3. Client sends message with `file_id` in `ciphertext` (inside the encrypted envelope).

### Presence & Typing
- **Last seen**: Updated on WebSocket disconnect (`last_seen` in `users`). No real-time push.
- **Typing indicator** (ephemeral, not stored):
  ```json
  // A → Server (typing in chat with B)
  {
    "type": "typing",
    "to": "user_b_id",
    "chat_type": "one_to_one",
    "typing": true
  }
  ```
  - Server checks if B is online (has WebSocket). If yes, forwards immediately. If no, discards.
  - B’s client shows “A is typing...” for 3 seconds after last indicator.
- **No group typing** (too noisy; optional extension).

### Offline Message Sync
- Client connects WebSocket → sends `{ type: "sync", last_sync_timestamp }`.
- Server returns all messages since `last_sync_timestamp` for all chats user is in (query `messages` where `chat_id` in user’s groups or 1:1 chats, and `timestamp` > last_sync).
- Client decrypts, stores locally, updates `last_sync_timestamp`.
- **Gap handling**: If client missed messages due to disconnect, server sends all since last sync. Counters help reorder.

---

## 6. Self-Hosting & Operations

### Deployment Story
1. **Prerequisites**: VPS (Ubuntu 22.04), Docker, `docker-compose`, domain name.
2. **Setup**:
   ```bash
   git clone https://github.com/secret-society/app.git
   cd app
   cp .env.example .env
   # Edit .env: set DOMAIN, EMAIL (for Let’s Encrypt), ADMIN_INVITES=5, etc.
   docker-compose up -d
   ```
   - `docker-compose.yml`:
     ```yaml
     version: '3'
     services:
       nginx:
         image: nginx:alpine
         ports:
           - "80:80"
           - "443:443"
         volumes:
           - ./nginx.conf:/etc/nginx/nginx.conf
           - ./certs:/etc/letsencrypt
           - ./data:/var/app/data
         depends_on:
           - app
       app:
         build: .
         environment:
           - DATABASE_PATH=/var/app/data/secretsociety.db
           - UPLOAD_DIR=/var/app/data/uploads
           - NODE_ENV=production
         volumes:
           - ./data:/var/app/data
     ```
3. **TLS**: nginx uses Let’s Encrypt (certbot) or user-provided certs.
4. **Initial admin**: First user to register becomes admin? Or we generate a bootstrap invite token on first run? Better: generate a single “founder” invite token stored in `.env` (or printed in logs) that can be used once to create the first admin.

### External Dependencies
- **DNS**: A/AAAA record pointing to VPS IP.
- **TLS**: Automated via Let’s Encrypt (certbot in nginx container) or manual cert upload.
- **Storage**: Local disk; monitor `/var/app/data` usage.
- **SMTP**: Not needed (invites are token-based, out-of-band).

### Backup & Restore
- **Database**: `sqlite3 /var/app/data/secretsociety.db ".backup /var/app/backup.db"` daily via cron.
- **Uploads**: `rsync` or `tar` the `/var/app/data/uploads` directory.
- **Key material**: Private keys **never** stored on server. Users must back up their own keys (via encrypted backup feature). Server only stores encrypted backups (if user opts-in).
- **Restore**:
  1. Stop app: `docker-compose down`.
  2. Replace `secretsociety.db` and `uploads/`.
  3. Start app: `docker-compose up -d`.
  4. Users restore keys from their personal backup.

### Monitoring
- **Health checks**:
  - `GET /health` → 200 if DB accessible and WebSocket server running.
  - WebSocket ping/pong every 60s.
- **Logs**: `docker-compose logs app` → watch for errors.
- **Metrics to track**:
  - Connected WebSocket clients.
  - Messages/sec.
  - Database size.
  - Upload directory size.
- **Alerts**: Email/Slack on:
  - Disk usage > 80%.
  - App down (health check fails).
  - High error rate (5xx responses).

---

## 7. Threat Model

### Malicious Server Operator
**Can observe**:
- All metadata: who messages whom, group membership, timestamps, message sizes, file sizes.
- Invite chain (who invited whom).
- Online/offline status (via WebSocket connections).
- Read receipts (who read which message).

**Cannot observe**:
- Message text/content.
- File content.
- Group keys.
- User private keys.

**Additional risks**:
- **Metadata correlation**: Server can build social graph.
- **Denial-of-service**: Drop messages, kick users, delete data.
- **Invite revocation abuse**: Remove members arbitrarily.
- **Mitigation**: Server is self-hosted by trusted admin; audit logs of admin actions.

### Server Database Exfiltration
**Attacker obtains**:
- All tables (including encrypted messages, files metadata, user public keys, invite chain).
- **Impact**:
  - Can see entire communication graph and timing.
  - Can attempt brute-force on encrypted messages if user devices are compromised (stealing private keys).
  - Can see invite chain to identify community structure.
- **Cannot**:
  - Decrypt messages/files without private keys.
  - Impersonate users (no private keys).
- **Mitigation**: Database encryption at rest (LUKS on VPS); regular backups stored offline.

### Single Member Device Compromise
**Attacker gets**:
- User’s private keys (`IK_priv`, `SPK_priv`).
- All stored messages (if client stores unencrypted? Actually, client stores encrypted messages with keys in memory? We should encrypt local storage with a key derived from `IK_priv`? That would be circular. Instead, we can encrypt local storage with a passphrase? But then key backup is needed. Simpler: assume device compromise means total compromise; all keys and stored messages are exposed.
- For 1:1 chats: can decrypt **all past and future** messages in those chats because Double Ratchet state is on device.
- For group chats: can decrypt **all past and future** group messages (since `GK` is stored on device).
- Can impersonate user in all chats.
- Can read their own invite chain (who they invited).

**Blast radius**:
- 1:1 chats: all conversations with that user compromised.
- Groups: all groups the user is member of compromised.
- **Not affected**: Users who never shared a 1:1 chat or group with compromised user.

**Mitigation**:
- User detects compromise → rotates identity key (new `IK_pair`). This breaks all existing sessions; contacts must re-establish (notify via server? We can have a “key rotation” event).
- Rekey all groups user was in (if user was admin, groups may be left without admin? Better: require multiple admins).
- Encourage users to set device passcode and use encrypted backups.

### Invite System Attacks
**Defends against**:
- **Replay**: Token hash single-use.
- **Mass generation**: Per-user invite limit.
- **Token leakage**: Token only shown once; stored hashed.
- **Invalid keys**: Server validates `signed_prekey_sig` on registration.

**Does not defend**:
- **Social engineering**: User can give token to anyone out-of-band; server can’t verify intended recipient.
- **Token sharing**: Token can be forwarded; server sees only who finally used it.
- **Invite chain manipulation**: Admin can view chain but not edit; removal doesn’t delete history.
- **Sybil attack**: Nothing prevents a user from creating multiple accounts if they have multiple invite tokens (from different inviters).

### Other Attacks
- **Server message injection**: Server can insert ciphertexts, but they’ll fail decryption (random bytes). Clients should handle decryption errors gracefully.
- **Reordering**: Server can reorder messages within same `sender_counter` sequence? But counters ensure order. Server cannot change counters without detection (message would fail decryption if counter wrong? Actually, Double Ratchet uses counters to derive keys; wrong counter → wrong key → decryption fails). So server cannot reorder without causing failures.
- **Man-in-the-middle during key exchange**: If users don’t verify safety numbers (which we don’t implement due to UX complexity), server can provide fake prekey bundles and read initial messages. **We accept this risk** for simplicity; in a trusted community, server operator is trusted. For higher security, require out-of-band safety number verification (QR scan) for first message in each 1:1 chat.

### Design Trade-offs
- **No one-time prekeys**: Simpler key management; weakens forward secrecy for initial 1:1 session.
- **Group keys without FS**: Rekey only on membership change; past group messages vulnerable if member device compromised.
- **No message editing/deleting**: Not required; would require tombstone messages and server coordination.
- **No message reactions**: Deferred.
- **No video/voice**: Deferred; would require SFU/MCU, breaking simplicity.

---

## Appendix: Key Backup Implementation (Optional)

To allow device migration:
1. User sets **backup passphrase**.
2. Client encrypts a JSON backup:
   ```json
   {
     "ik_priv": "...",
     "spk_priv": "...",
     "one_to_one_sessions": [
       { "partner_id": "...", "root_key": "...", "sending_chain_key": "...", "sending_counter": 42, ... }
     ],
     "group_keys": [
       { "group_id": "...", "gk": "...", "admin_id": "..." }
     ]
   }
   ```
   with key = Argon2id(passphrase).
3. Upload to server as `/backup/{user_id}` (protected by auth).
4. On new device: download backup, enter passphrase, decrypt, restore state.

**Server sees**: encrypted blob only.

---

*Prepared for Secret Society – v1.0*  
*Design decisions prioritize simplicity, deployability, and cryptographic safety within the threat model of a trusted, self-hosted community.*