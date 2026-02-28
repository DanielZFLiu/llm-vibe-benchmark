# Secret Society: System Design Document

## 1. Architecture Overview

### Core Components
```
┌─────────────────────────────────────────────────────────────┐
│                    Client App (Browser/Desktop)              │
│  • React/Electron or Tauri app                              │
│  • libsodium/wasm for crypto                                │
│  • IndexedDB for local cache                                │
└───────────────┬─────────────────────────────────────────────┘
                │ HTTPS/WSS
                ▼
┌─────────────────────────────────────────────────────────────┐
│                    Reverse Proxy (nginx/Caddy)               │
│  • TLS termination                                          │
│  • Static file serving for web client                       │
└───────────────┬─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────┐
│                    Application Server (Node.js/Go)           │
│  • WebSocket message router                                 │
│  • HTTP API for non-realtime ops                            │
│  • Authentication middleware                                │
└───────────────┬─────────────────────────────────────────────┘
                │
         ┌──────┴──────┐
         ▼             ▼
┌─────────────────┐ ┌─────────────────┐
│   PostgreSQL    │ │   Redis         │
│   • User metadata│ │   • Online presence│
│   • Group info  │ │   • Session cache│
│   • Invite tree │ │   • Rate limiting│
│   • Encrypted   │ │                 │
│     messages*   │ └─────────────────┘
└─────────────────┘
```

**Technology Justification:**

- **Node.js/Go**: Both are suitable for ~1k concurrent WebSocket connections on modest hardware. Node has better crypto library maturity; Go has better memory efficiency. I'd choose **Go** for its simpler deployment story and lower memory footprint.
- **PostgreSQL**: Proven, reliable, handles JSONB for flexible schema. Single-instance is fine for this scale.
- **Redis**: Ephemeral presence state demands low-latency reads/writes.
- **Browser-first client**: Low friction for users, portable across devices. Electron/TAURI for desktop apps.
- **libsodium**: Modern, high-level crypto library that reduces implementation errors.

**What runs where:**
- **Single VPS**: All server components (proxy, app server, databases) run on one machine via Docker Compose.
- **Client**: User devices only. No server-side rendering.

## 2. End-to-End Encryption Design

### Cryptographic Scheme: Double Ratchet with X3DH

**Identity Keys:**
- Each user generates at installation:
  - **Identity Key Pair** (Ed25519): Long-term signing key
  - **Signed Pre-Key** (X25519): Signed by Identity Key, rotated weekly
  - **One-Time Pre-Keys** (X25519): Bundle of 100 keys, replenished as used

**Key Exchange Protocol:**

1. **1:1 Chat Initiation (X3DH):**
   ```
   Alice fetches Bob's pre-key bundle from server (signed by server)
   Alice performs X3DH using:
     - Her Identity Key (IK_A) or Ephemeral Key (EK_A)
     - Bob's Identity Key (IK_B)
     - Bob's Signed Pre-Key (SPK_B)
     - One of Bob's One-Time Keys (OTK_B)
   Output: Initial shared secret → Double Ratchet session
   ```

2. **Group Chat (Sender Keys + MLS-like):**
   - **Group initialization**: Creator generates random **Group Session Key** (GSK)
   - For each member, encrypt GSK using their 1:1 session (asymmetric)
   - **Sender Keys**: Each member has own Chain Key for forward secrecy within group
   - **Key Rotation**: Any member can propose new GSK, encrypted to all current members

**Forward Secrecy:**
- **Double Ratchet** for 1:1: Each message generates new key for next message
- **Group**: Sender Keys provide forward secrecy (compromise doesn't decrypt future messages)
- **Compromise Recovery**: If Identity Key compromised, user generates new identity, server marks old key as revoked. Existing sessions remain vulnerable until re-initiated.

**Message Storage:**
```json
{
  "id": "msg_abc123",
  "room_id": "room_xyz",
  "sender": "user_123",
  "ciphertext": "base64...",  // Encrypted with session keys
  "metadata": {               // Server-visible
    "timestamp": "2024-01-01T00:00:00Z",
    "type": "text|image|file",
    "ephemeral_ttl": 3600,    // Seconds until deletion
    "is_edited": false
  }
}
```
*Server stores encrypted blobs, cannot decrypt content.*

**Multi-Device Recovery:**
1. New device authenticates via existing device QR code scan
2. Existing device encrypts key bundle (Identity + pre-keys + session keys) with one-time key from new device
3. Bundle transferred via local connection or server relay (encrypted)
4. New device decrypts, notifies all contacts of new device key

**Server Visibility:**
- **Can see**: Metadata (who talks to whom, when, message sizes, group membership)
- **Cannot see**: Message content, shared files, cryptographic keys
- **Can infer**: Social graph, activity patterns

## 3. Invite System

### Invite Lifecycle

**Invite Generation:**
```typescript
// Client-side generation
invite = {
  id: "inv_xyz123",          // Random UUID
  inviter: "user_123",       // Signed by inviter's Identity Key
  code: "ABC123-DEF456",     // Human-readable, 12 chars
  salt: "random_salt",
  hash: SHA256(code + salt), // Server stores only hash
  max_uses: 1,
  expires: "2024-01-07T00:00:00Z",
  signature: sign(inviter_priv_key, hash)
}
```

**Invite Validation (Privacy-Preserving):**
1. User submits `code` to `/api/invite/validate`
2. Server computes `hash = SHA256(code + stored_salt)`
3. Server checks hash exists, is unused, not expired
4. **Server never learns `code` before submission** - only stores hash
5. If valid, server returns inviter's public key for signature verification

**Invite Chain Audit:**
```sql
CREATE TABLE invite_chain (
  user_id UUID REFERENCES users(id),
  inviter_id UUID REFERENCES users(id),
  invite_hash BYTEA UNIQUE,  -- Hashed invite code
  redeemed_at TIMESTAMPTZ,
  generation INT DEFAULT 0    -- Distance from root admin
);

-- Recursive query for admin panel:
WITH RECURSIVE chain AS (
  SELECT user_id, inviter_id, generation 
  FROM invite_chain WHERE user_id = 'target'
  UNION
  SELECT ic.user_id, ic.inviter_id, ic.generation
  FROM invite_chain ic
  JOIN chain c ON ic.user_id = c.inviter_id
)
SELECT * FROM chain;
```

**Revocation & Removal:**
- **Invite revocation**: Admin marks invite hash as revoked
- **Member removal**: 
  - All their invites are revoked
  - Chain remains intact for audit
  - Removed user's messages remain encrypted (cannot decrypt future)
  - Groups can optionally re-key to exclude removed member

**Anti-Abuse Measures:**
1. **Rate limiting**: 5 invites/week per member, configurable by admin
2. **Non-transferable**: Each invite single-use, tied to inviter's identity
3. **Expiration**: Default 7 days
4. **Replay protection**: Server tracks redeemed hashes
5. **Admin oversight**: All invites logged, suspicious patterns flagged

## 4. Data Model

### Core Tables (PostgreSQL)

```sql
-- PLAINTEXT TABLES (Server-readable)
CREATE TABLE users (
  id UUID PRIMARY KEY,
  username VARCHAR(32) UNIQUE,
  display_name VARCHAR(64),
  avatar_url TEXT,  -- Pointer to encrypted blob
  identity_pub_key BYTEA,      -- Ed25519
  signed_pre_key_pub BYTEA,    -- X25519, signed
  signed_pre_key_sig BYTEA,
  pre_key_bundle JSONB,        -- Array of one-time keys
  created_at TIMESTAMPTZ,
  last_seen TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE rooms (
  id UUID PRIMARY KEY,
  type VARCHAR(10) CHECK (type IN ('direct', 'group')),
  name VARCHAR(100),           -- Encrypted for groups
  avatar_url TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ
);

CREATE TABLE room_members (
  room_id UUID REFERENCES rooms(id),
  user_id UUID REFERENCES users(id),
  joined_at TIMESTAMPTZ,
  role VARCHAR(10) DEFAULT 'member',
  PRIMARY KEY (room_id, user_id)
);

-- ENCRYPTED TABLES (Client-encrypted blobs)
CREATE TABLE messages (
  id UUID PRIMARY KEY,
  room_id UUID REFERENCES rooms(id),
  sender_id UUID REFERENCES users(id),
  ciphertext BYTEA,            -- Encrypted message content
  metadata JSONB,              -- Server-readable: type, timestamp, ttl, etc.
  edited BOOLEAN DEFAULT false,
  deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ,
  INDEX idx_room_created (room_id, created_at DESC)
);

CREATE TABLE user_settings (
  user_id UUID REFERENCES users(id),
  encrypted_data BYTEA,        -- Client-encrypted preferences
  PRIMARY KEY (user_id)
);

-- INVITE SYSTEM
CREATE TABLE invites (
  hash BYTEA PRIMARY KEY,      -- SHA256(invite_code + salt)
  inviter_id UUID REFERENCES users(id),
  salt BYTEA,
  max_uses INT DEFAULT 1,
  uses_left INT DEFAULT 1,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  revoked BOOLEAN DEFAULT false
);

CREATE TABLE invite_redemptions (
  hash BYTEA REFERENCES invites(hash),
  user_id UUID REFERENCES users(id),
  redeemed_at TIMESTAMPTZ,
  PRIMARY KEY (hash, user_id)
);
```

**Client-side encrypted fields:**
- `messages.ciphertext`: Message body, attachments, reactions
- `rooms.name` (for groups): Group name
- `user_settings.encrypted_data`: User preferences, contact list
- File contents (stored as encrypted blobs on disk)

## 5. Real-Time Protocol

### Transport Protocol: WebSocket + REST fallback

**Why WebSocket:**
- Full-duplex, low overhead for frequent small messages
- NAT traversal simpler than pure UDP (important for home servers)
- Works through most corporate firewalls
- Fallback to long-polling for problematic networks

### Message Flow

**Encrypted Message Routing:**
```
1. Sender encrypts message with Double Ratchet (1:1) or Sender Keys (group)
2. Client sends to server via WebSocket:
   {
     "type": "message",
     "room_id": "room_123",
     "ciphertext": "encrypted_payload",
     "metadata": {...}  // Server-readable
   }
3. Server validates sender is in room
4. Server stores encrypted message in DB
5. For each online recipient in room:
   - Server pushes via their WebSocket
   {
     "type": "message",
     "message_id": "msg_abc",
     "room_id": "room_123",
     "sender": "user_123",
     "ciphertext": "encrypted_payload",
     "metadata": {...}
   }
6. For offline recipients: stored messages fetched on next connect
```

**Presence & Typing Indicators:**
```json
// Typing indicator (ephemeral, not stored)
{
  "type": "typing",
  "room_id": "room_123",
  "user_id": "user_123",
  "action": "start|stop"
}

// Presence via Redis
User -> Server: WebSocket ping every 30s
Server -> Redis: SETEX "online:user_123" 60 "1"
Other clients query: GET "online:user_123"
```

**Offline Recovery:**
1. Client connects, authenticates via JWT
2. Client requests sync endpoint: `/api/sync?since=timestamp`
3. Server returns:
   - Messages since last seen (encrypted)
   - Key exchange messages
   - Group membership changes
4. Client processes in order, updating local ratchet state

**Read Receipts:**
```json
// Encrypted within room, but metadata visible to server
{
  "type": "receipt",
  "message_id": "msg_abc",
  "user_id": "user_123",
  "status": "delivered|read",
  "timestamp": "2024-01-01T00:00:00Z"
}
```
*Note: Server can infer read timestamps but not which message was read.*

## 6. Self-Hosting & Operations

### Deployment Stack: Docker Compose

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:15
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    environment:
      POSTGRES_PASSWORD: ${DB_PASSWORD}
  
  redis:
    image: redis:7-alpine
    volumes:
      - ./data/redis:/data
  
  app:
    build: .
    ports:
      - "127.0.0.1:3000:3000"
    depends_on:
      - postgres
      - redis
    environment:
      DATABASE_URL: postgresql://postgres:${DB_PASSWORD}@postgres/secretsociety
      REDIS_URL: redis://redis:6379
      JWT_SECRET: ${JWT_SECRET}
  
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - app
```

**External Dependencies:**
- **Domain/DNS**: User-provided, CNAME to VPS IP
- **TLS Certificates**: Let's Encrypt via Certbot (built into nginx)
- **SMTP**: For invite emails (optional, invites can be copy-paste codes)
- **Storage**: Local disk for encrypted files, 100GB sufficient for 1k users
- **Backups**: `pg_dump` + rsync to remote storage

### Backup Strategy
1. **Database**: Daily `pg_dump` to encrypted archive
2. **Encrypted files**: Rsync to backup server
3. **Key Material**: **NOT BACKED UP BY SERVER** - client responsibility
   - Provide QR code export/import
   - Encourage users to save recovery phrase

**Admin Monitoring:**
- **Health endpoint**: `/api/health` (DB, Redis, disk space)
- **Logs**: Structured JSON logs to file
- **Metrics**: 
  - Active WebSocket connections
  - Message throughput
  - Database connection pool
  - Memory usage
- **Alerting**: Simple script monitoring disk >90% or OOM

**Update Process:**
1. Pull new Docker images
2. `docker-compose down`
3. Backup database
4. `docker-compose up -d`
5. Run migrations if needed

## 7. Threat Model

### Malicious Server Operator Can:
- See social graph (who talks to whom, how often)
- See message metadata (timestamps, sizes, types)
- See group membership
- Identify active users and their online patterns
- Know when users read messages (via receipt timestamps)
- Block or delay messages (DoS)
- Attempt to inject malicious key material (mitigated by signing)

### Malicious Server Operator Cannot:
- Read message content or file contents
- Decrypt past messages even with future server compromise
- Impersonate users without stealing device
- Forge valid message signatures
- Add users to groups without member consent (requires group key re-encryption)

### Database Exfiltration Impact:
- Encrypted messages remain secure (ciphertext only)
- User identities and social graph exposed
- Invite hashes exposed (but requires brute-force to reverse)
- No cryptographic keys exposed (stored client-side)
- **Impact**: Privacy breach of metadata, but not content

### Compromised Member Device:
- All messages on that device readable by attacker
- Future messages decryptable until sessions re-established
- Attacker can impersonate user until identity key revoked
- **Mitigation**: Device list in user profile, allow session revocation
- **Blast radius**: Limited to that user's conversations

### Invite System Attacks Defended:
- **Invite selling**: Server sees inviter-invitee chain
- **Mass spam generation**: Rate limiting per user
- **Replay attacks**: Single-use hashes
- **Pre-join privacy**: Server doesn't know invitee until redemption

### Invite System NOT Defended Against:
- **Inviter collusion**: Nothing prevents inviter from inviting bad actor
- **Sybil attacks**: Determined adversary with multiple invitees
- **Social engineering**: Users tricked into inviting malicious actors

## Trade-offs & Rationale

1. **No perfect forward secrecy for groups**: Full MLS implementation too complex for self-hosted. Sender Keys provide good compromise.

2. **Server sees metadata**: True metadata-private systems (e.g., Signal's sealed sender) add complexity. Acceptable trade-off for deployability.

3. **WebSocket over pure P2P**: Centralized routing simplifies NAT traversal and offline messaging. Server becomes active participant.

4. **No multi-device sync by default**: Simpler crypto model. Users add devices via QR code pairing.

5. **Admin visibility into invite chain**: Necessary for auditability, though reveals social structure to admin.

6. **Ephemeral messages server-side**: Messages deleted by cron job, not immediately. Simpler implementation.

This design prioritizes **deployability** and **maintainability** by a single administrator while maintaining strong E2E encryption. It accepts some metadata exposure to achieve practical self-hosting on modest hardware.