# Secret Society: System Design Document

## 1. Architecture Overview

### Component Stack
```
┌─────────────────────────────────────────────────────────┐
│                    Client Application                    │
│  (Web/Desktop PWA with local encryption/decryption)     │
└─────────────┬───────────────────────────────┬───────────┘
              │                               │
              │ HTTPS/WSS                     │ WebSocket
              │ (REST APIs +                  │ (Real-time)
              │  Key/File upload)             │
┌─────────────▼───────────────────────────────▼───────────┐
│                    Main Server                           │
│  ┌─────────────────┐ ┌─────────────────┐               │
│  │  API Layer      │ │  WebSocket      │               │
│  │  • Authentication│ │  Layer          │               │
│  │  • Invite mgmt  │ │  • Message relay│               │
│  │  • Admin        │ │  • Presence     │               │
│  └─────────────────┘ └─────────────────┘               │
│              │                    │                     │
│              ▼                    ▼                     │
│  ┌─────────────────┐  ┌──────────────────────┐        │
│  │  Database       │  │  Blob Storage         │        │
│  │  (SQLite)       │  │  (Local filesystem)   │        │
│  └─────────────────┘  └──────────────────────┘        │
└─────────────────────────────────────────────────────────┘
```

### Technology Choices Justification

**Server Language: Go** 
- Single binary deployment with minimal dependencies
- Excellent concurrency for WebSocket handling
- Strong crypto libraries
- Cross-platform compilation for various VPS architectures

**Database: SQLite**
- Single-file, zero-configuration database perfect for self-hosted scenarios
- ACID-compliant, handles 1,000 concurrent users easily
- Can be backed up with simple file copy
- No separate database process to manage

**Client: Progressive Web App (PWA)**
- No app store dependencies for updates
- Runs on all platforms (desktop/mobile via browser)
- Can store keys locally using Web Crypto API
- Can work offline for key operations

**Transport: WebSocket + HTTPS**
- WebSocket for real-time bidirectional communication
- HTTPS for initial bootstrap and file transfers
- Single port (443) simplifies firewall configuration

## 2. End-to-End Encryption Design

### Cryptographic Scheme: Signal Protocol + MLS Extensions

**Identity Keys:**
- Each user generates a Curve25519 identity key pair at registration
- Public identity key signed by server upon invite validation
- Private identity key stored only on client devices, encrypted with passphrase-derived key

**Session Establishment (1:1):**
```
1. Alice fetches Bob's prekey bundle from server:
   - Identity public key (signed)
   - Signed prekey (medium-term, refreshed weekly)
   - One-time prekeys (consumed on use)

2. Alice performs X3DH:
   DH1 = DH(I_A, SPK_B)
   DH2 = DH(E_A, I_B)
   DH3 = DH(E_A, SPK_B)
   DH4 = DH(E_A, OPK_B) [if available]
   master_secret = KDF(DH1 || DH2 || DH3 || DH4)

3. Initializes Double Ratchet with master_secret
```

**Group Chats (up to 50 members):**
- Use MLS (Messaging Layer Security) inspired approach
- Each group has a ratchet tree for forward secrecy
- Add member: existing member sends group secret key encrypted under new member's identity
- Remove member: remaining members perform tree reinitialization

**Forward Secrecy:**
- Achieved via Double Ratchet (1:1) and tree-based ratcheting (groups)
- Each message uses new ephemeral keys
- Compromised long-term key: Past messages remain secure, future requires new signed prekey upload

**Message Storage on Server:**
```json
{
  "id": "msg_123",
  "sender": "user_a",
  "recipients": ["user_b", "user_c"],
  "ciphertext": "base64(encrypted_payload)",
  "metadata": {
    "type": "text|image|file",
    "size": 1024,
    "timestamp": 1234567890,
    "expires_at": 1234567990,  // for ephemeral messages
    "key_id": "ratchet_generation_5"
  }
}
```
Server stores only encrypted payloads and routing metadata.

**Key Recovery (New Device):**
1. User enters passphrase on existing device
2. Device generates encrypted backup: `encrypt(keys, passphrase_derived_key)`
3. Upload encrypted blob to server (requires re-auth)
4. New device downloads, prompts for passphrase, decrypts
5. New device uploads new signed prekey bundle

**Server's Capabilities:**
- **Can observe:** Who communicates with whom, when, message frequency/size
- **Cannot read:** Message content, group names, file contents
- **Stores encrypted:** Messages, files, user profile fields marked as private
- **Stores plaintext:** User IDs, invite chain, online status, group membership

## 3. Invite System

### Invite Lifecycle

**Generation:**
- Member requests invite from server via authenticated API
- Server generates: `invite_code = HMAC(server_secret, member_id + timestamp + random)`
- Code encoded as: `https://society.example/join/${base58(invite_code)}`
- Server stores: `(invite_code, creator_id, created_at, expires_in=7d, max_uses=1, used=false)`

**Validation Without Revealing Invitee:**
1. Prospective member visits invite URL
2. Client generates ephemeral key pair, sends public key to server with invite code
3. Server verifies code validity, doesn't store prospective user's info
4. Server returns encrypted token: `encrypt(registration_token, user_ephemeral_pubkey)`
5. Token contains: `(invite_code, expires_at, allowed_username_range)`

**Registration with Auditable Chain:**
1. User submits registration with token, chosen username, identity public key
2. Server decrypts token, verifies invite_code hasn't been used
3. Creates user record with `invited_by = creator_id`
4. Updates invite: `used = true, used_by = new_user_id, used_at = now()`

**Revocation and Chain Effects:**
- **Invite revocation:** Creator or admin marks invite as `revoked = true`
- **Member removal:** Admin deactivates account, severing further invites
- **Chain integrity:** Removed member remains in historical chain but marked inactive
- **Cascading effects:** None - existing members remain, only future propagation stops

**Abuse Prevention:**
- Rate limiting: 5 invites/week per member
- Invite codes single-use, expire in 7 days
- Replay prevention: Server tracks used codes
- No transfer: Codes bound to creator's signature
- Admin oversight: View all pending invites, revoke suspicious ones

## 4. Data Model

### Core Tables

**Users (plaintext for routing):**
```sql
CREATE TABLE users (
    id TEXT PRIMARY KEY,  -- UUID
    username TEXT UNIQUE,
    status TEXT CHECK(status IN ('active', 'inactive', 'suspended')),
    invited_by TEXT REFERENCES users(id),
    invite_chain_depth INTEGER,
    created_at TIMESTAMP,
    last_seen TIMESTAMP,
    public_key TEXT,  -- Identity public key
    signed_prekey TEXT,
    signed_prekey_signature TEXT,
    profile_updated_at TIMESTAMP
);
```

**User Profiles (client-side encrypted):**
```sql
CREATE TABLE user_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    encrypted_display_name TEXT,  -- Encrypted with user's key
    encrypted_avatar_url TEXT,    -- Encrypted avatar metadata
    encrypted_bio TEXT,
    encryption_version INTEGER
);
```

**Messages:**
```sql
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    sender_id TEXT REFERENCES users(id),
    conversation_id TEXT,  -- For 1:1: user1_user2 sorted, for groups: group_id
    encrypted_payload TEXT,  -- Client-side encrypted
    payload_hash TEXT,  -- For deduplication
    metadata_json TEXT,  -- Plaintext routing info
    created_at TIMESTAMP,
    expires_at TIMESTAMP,  -- NULL for persistent messages
    delivered BOOLEAN DEFAULT FALSE,
    read_by_recipients JSON  -- Array of user_ids who read it
);
```

**Groups:**
```sql
CREATE TABLE groups (
    id TEXT PRIMARY KEY,
    encrypted_name TEXT,  -- Client-side encrypted
    created_by TEXT REFERENCES users(id),
    created_at TIMESTAMP,
    member_count INTEGER,
    max_members INTEGER DEFAULT 50
);

CREATE TABLE group_members (
    group_id TEXT REFERENCES groups(id),
    user_id TEXT REFERENCES users(id),
    joined_at TIMESTAMP,
    role TEXT CHECK(role IN ('admin', 'member')),
    encrypted_group_key TEXT  -- Group key encrypted for this member
);
```

**Invites:**
```sql
CREATE TABLE invites (
    code TEXT PRIMARY KEY,
    creator_id TEXT REFERENCES users(id),
    created_at TIMESTAMP,
    expires_at TIMESTAMP,
    used BOOLEAN DEFAULT FALSE,
    used_by TEXT REFERENCES users(id),
    used_at TIMESTAMP,
    revoked BOOLEAN DEFAULT FALSE,
    revoked_by TEXT REFERENCES users(id),
    revoked_at TIMESTAMP
);
```

## 5. Real-Time Protocol

### Transport: WebSocket
- **Why WebSocket:** Full-duplex, low-latency, minimal overhead after handshake
- **Alternative considered:** SSE + HTTP/2, but WebSocket better for frequent bidirectional messages
- **Fallback:** Long-polling for networks blocking WebSocket (corporate firewalls)

### Message Routing Through Server:
```
Client A (sending to Client B):
1. A encrypts message for B using B's current ratchet key
2. A sends to server: {to: "B", ciphertext: "...", metadata: {...}}
3. Server validates A is authenticated, B exists
4. Server stores message in DB with delivered=false
5. If B is connected: forward via B's WebSocket
6. B receives, decrypts, sends delivery receipt
7. Server updates delivered=true
```

**Offline Message Retrieval:**
- Each client maintains `last_synced_at` timestamp
- On reconnect: `GET /messages/since?timestamp=...`
- Server returns all undelivered messages
- Client processes in order, updates ratchet state

**Presence Indicators:**
- WebSocket connection = online
- Grace period: 30 seconds after disconnect before marking offline
- Periodic heartbeats every 15 seconds
- `last_seen` updated on any activity

**Typing Indicators:**
- Ephemeral WebSocket messages, not stored in DB
- Format: `{type: "typing", conversation_id: "...", user_id: "...", active: true/false}`
- Rate-limited: 1 event per second per user per conversation
- No end-to-end encryption (not sensitive metadata)

**Read Receipts:**
- Client sends receipt after decrypting message
- Server updates `read_by_recipients` array
- Receipts encrypted per-conversation for privacy

## 6. Self-Hosting & Operations

### Deployment Stack:
```
docker-compose.yml:
  society-server:
    image: secretsociety/server:latest
    ports: ["443:443"]
    volumes:
      - ./data:/app/data
      - ./config:/app/config
    environment:
      - DOMAIN=society.example.com
      - ADMIN_EMAIL=admin@example.com
  
  # Optional: SMTP for email invites
  postfix:
    image: catatnight/postfix
    environment:
      - maildomain=society.example.com
```

**External Dependencies:**
1. **Domain name:** Required for TLS certificates
2. **TLS/SSL:** Automatic via Let's Encrypt built into server
3. **SMTP (optional):** For email invites. Without email: invite URLs printed in admin panel
4. **Storage:** Local filesystem for encrypted blobs (~100GB for 1,000 users)

**Backup Strategy:**
```
Backup includes:
1. SQLite database file (encrypted at rest with server key)
2. Config files (without secrets)
3. Encrypted blob storage directory

Backup frequency:
- Daily incremental (to separate disk)
- Weekly full (encrypted, uploaded to external storage)

Restore process:
1. Stop server
2. Replace data directory from backup
3. Start server
```

**Monitoring for Admin:**
- Web dashboard showing:
  - Active connections count
  - Message throughput (messages/minute)
  - Disk usage
  - Last backup status
  - Pending invites count
- Health endpoint: `GET /health` returns status and metrics
- Alert on: >80% disk usage, no backups for 48h, <10% free invites

## 7. Threat Model

### Malicious Server Operator Can:
- Observe social graph (who talks to whom)
- See message timestamps, sizes, frequencies
- See group memberships
- See online/offline status patterns
- Block or delay messages (DoS)
- Serve malicious JavaScript to clients (mitigated by subresource integrity)

### Malicious Server Operator Cannot:
- Read message contents
- Read file contents
- Read group names or user profile details
- Impersonate users in conversations (without client compromise)
- Decrypt historical messages if keys weren't logged

### Database Exfiltration Impact:
- Attacker gets encrypted messages (unreadable without client keys)
- Gets social graph and metadata (significant privacy breach)
- Gets public keys (not a security issue alone)
- **Mitigation:** Encrypt sensitive metadata fields, rate-limit key exchange

### Single Member Device Compromise:
- All conversations accessible to that device are exposed
- Future messages in existing conversations until participants rotate keys
- Attacker can impersonate user until device is revoked
- **Blast radius limited to:** That user's conversations + any groups they're in
- **Mitigation:** Device revocation via admin panel, key rotation notifications

### Invite System Defenses:
**Prevents:**
- Unauthorized joins without invite
- Invite code guessing (cryptographically random)
- Invite code replay (single-use tracking)
- Mass invite generation (rate limiting)

**Does Not Prevent:**
- Invite sharing with unintended recipients (social engineering)
- Inviter colluding with banned user
- Sybil attacks if multiple members collude

## Trade-offs and Design Decisions

1. **SQLite over PostgreSQL:** Simplicity over scalability. With 1,000 users, SQLite performs well and reduces deployment complexity.

2. **No multi-device sync initially:** Each user has one active device. Adding multi-device increases key synchronization complexity dramatically.

3. **Server sees metadata:** Full metadata hiding requires mixnets or sophisticated protocols, incompatible with self-hosting simplicity.

4. **File sharing deferred but designed:** Encryption scheme supports it, storage API designed, but implementation marked v2.

5. **Admin powers balanced:** Admins can remove members but not read messages. They control membership, not content.

6. **Ephemeral messages server-enforced:** Server deletes expired messages, trusting server for cleanup but not for reading.

7. **WebSocket over peer-to-peer:** Direct P2P would avoid server relay but requires NAT traversal and complicates offline delivery.

This design balances security, privacy, and operational simplicity for a community-operated secure messaging system.