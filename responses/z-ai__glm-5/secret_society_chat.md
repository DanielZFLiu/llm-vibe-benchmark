# System Design: "Secret Society"

## 1. Architecture Overview

The system follows a **Fat Client / Dumb Server** architecture. Given the requirement for End-to-End Encryption (E2EE) and a constrained deployment environment, the server acts primarily as a coordination and relay layer, remaining strictly ignorant of message content.

### 1.1 Component Diagram

```ascii
      +-------------------+        +-------------------+
      |   Client (Mobile  |        |   Client (Web     |
      |   /Desktop/Web)   |        |   Wrapper)        |
      +--------+----------+        +--------+----------+
               |  E2EE Payloads (WS/HTTPS)   |
               |                             |
      +--------v----------+        +--------v----------+
      |   Load Balancer   | <----> |   TLS Terminator  |
      |   (Nginx/Caddy)   |        |   (Let's Encrypt) |
      +--------+----------+        +-------------------+
               |
      +--------v----------+
      |  App Server (Go)  | <--- Stateless API / WebSocket Hub
      |  - Invite Logic   |
      |  - Message Relay  |
      |  - Presence Mgr   |
      +--------+----------+
               |
      +--------v----------+        +-------------------+
      |    PostgreSQL     |        |  Object Storage   |
      |    (Metadata &    |        |  (Encrypted Blobs)|
      |    Encrypted Msgs)|        +-------------------+
      +-------------------+
```

### 1.2 Technology Choices

*   **App Server (Go):** Chosen for its concurrency model (goroutines handle 1,000 WebSockets trivially) and single-binary output, which drastically simplifies deployment compared to Node.js or Python environments.
*   **Database (PostgreSQL):** At 1,000 users, a relational database is the right choice. It enforces the invite tree integrity via foreign keys, handles relational queries (groups/members) efficiently, and requires no special ops knowledge (unlike Cassandra/Scylla).
*   **Protocol (WebSocket over TLS):** Persistent connections allow for instant delivery of messages and presence updates (typing indicators) without the overhead of HTTP headers for every event.

---

## 2. End-to-End Encryption Design

The protocol is based on the **Signal Protocol** (Double Ratchet Algorithm) with adaptations for group messaging.

### 2.1 Key Generation & Identity
Every user generates an Identity Key Pair (Ed25519) upon installation.
*   **Identity Key (IK):** Long-term key used for signing.
*   **Signed Pre-Key (SPK):** Rotated periodically; signed by IK.
*   **One-Time Pre-Keys (OPK):** A pool of keys uploaded to the server to facilitate asynchronous session establishment.

### 2.2 Key Exchange (X3DH)
To start a 1:1 chat, Alice requests Bob's "key bundle" from the server. The server provides Bob's IK, SPK, and one OPK. Alice performs the X3DH calculation locally to derive a shared secret. She then initiates the Double Ratchet. The server cannot perform this calculation as it lacks Alice's private keys and Bob's OPK private key.

### 2.3 Forward Secrecy & Compromise
*   **Mechanism:** The Double Ratchet algorithm generates a new unique message key for every message sent/received.
*   **Forward Secrecy:** Past messages cannot be decrypted because the keys used to encrypt them have been deleted from the device memory.
*   **Post-Compromise Security:** If a device is compromised, the attacker can decrypt messages from that point forward. However, the "Diffie-Hellman ratchet" creates a new shared secret every time the other party replies, healing the session security assuming the attacker does not maintain persistent access.

### 2.4 Group Chats (Sender Keys)
To avoid encrypting a message 50 times for a group of 50:
1.  A group member generates a symmetric "Sender Key" for that group.
2.  They encrypt this Sender Key individually for each other member using their established 1:1 channels.
3.  All subsequent group messages are encrypted with this single Sender Key.
4.  **Re-keying:** If a member leaves or is removed, the admin instructs the group to generate new Sender Keys, excluding the removed party.

### 2.5 Key Restoration (Multi-Device)
**Hard Requirement Trade-off:** The server does not store private keys.
*   **Scenario A (Existing Device):** A user scans a QR code on the new device with the old device. The old device acts as a secure channel to transfer the Identity Key and current session states.
*   **Scenario B (No Existing Device):** Users must back up their Identity Key manually (e.g., writing down a seed phrase).
    *   *Note:* Message history is not restored unless the user exported an encrypted backup file locally. This minimizes server complexity and attack surface.

### 2.6 Server Storage Visibility
The server stores encrypted blobs (ciphertext). It stores:
*   The sender's ID.
*   The recipient's ID (or Group ID).
*   A timestamp.
*   The encrypted payload.
It cannot read message content, media filenames, or reaction metadata.

---

## 3. Invite System

The system relies on a chain of trust.

### 3.1 Lifecycle
1.  **Generation:** Alice (Member) requests an invite. The server checks her "invite quota" (e.g., max 3 active invites). If valid, it generates a random `invite_token` (UUID).
2.  **Storage:** The server stores `invite_token_hash` and `creator_id`.
3.  **Distribution:** Alice sends the token to Bob externally.
4.  **Validation:** Bob enters the token during registration. The server verifies the hash.
5.  **Linkage:** Upon successful registration, the server creates a link `new_user_id` -> `creator_id`. The invite is marked `redeemed`.

### 3.2 Privacy & Anonymity
To prevent the server from profiling potential members before they join, the server only sees the `invite_token` when it is generated and when it is used. It does not store metadata about *who* the invite is intended for until that person actually registers.

### 3.3 Revocation & Abuse Prevention
*   **Revocation:** The creator or an Admin can invalidate an unused invite code, deleting the hash from the DB.
*   **Member Removal:** If a member is banned, the Admin can view the "Invite Tree" in the Admin Panel. The UI allows selective pruning: "Ban User and all invites created by them."
*   **Quotas:** Limits prevent mass inviting.
*   **Replay Attacks:** Once an invite is `redeemed`, the token is invalidated.

---

## 4. Data Model

All "Content" fields are encrypted blobs. "Metadata" fields are plaintext for routing/indexing.

### Table: `users`
| Field | Type | Notes |
| :--- | :--- | :--- |
| `id` | UUID | PK |
| `identity_pub_key` | TEXT | Plaintext (Verification) |
| `display_name` | BYTEA | **Encrypted Blob** (Client decrypts) |
| `avatar_id` | UUID | FK to `files` (Encrypted image) |
| `status` | ENUM | 'active', 'banned' |
| `invited_by` | UUID | FK to `users` (The Trust Chain) |

### Table: `invites`
| Field | Type | Notes |
| :--- | :--- | :--- |
| `id` | UUID | PK |
| `token_hash` | TEXT | Indexed for lookup |
| `creator_id` | UUID | FK to `users` |
| `redeemed_by` | UUID | FK to `users` (Nullable) |

### Table: `messages`
| Field | Type | Notes |
| :--- | :--- | :--- |
| `id` | UUID | PK |
| `sender_id` | UUID | FK to `users` |
| `recipient_id` | UUID | User ID or Group ID |
| `payload` | BYTEA | **Encrypted Message Envelope** |
| `created_at` | TIMESTAMP | Server time |
| `expires_at` | TIMESTAMP | For ephemeral messages |

---

## 5. Real-Time Protocol

### 5.1 Transport
**Secure WebSockets (WSS)**.
*   Clients maintain a persistent connection to the server.
*   **Heartbeat:** Pings every 30s to keep NAT mappings open and check presence.

### 5.2 Message Routing
1.  **Send:** Client A encrypts message for Client B. Sends JSON: `{ "to": "B", "payload": "0x..." }`.
2.  **Relay:** Server checks if Client B has an active WebSocket connection.
    *   **Online:** Server pushes payload immediately.
    *   **Offline:** Server inserts payload into `messages` table.
3.  **Sync:** When Client B connects, it requests: `GET /messages?since=<last_msg_id>`. The server streams all stored blobs.

### 5.3 Presence & Typing Indicators
To prevent traffic analysis (who is talking to whom), presence signals are treated as messages.
*   **Typing:** Client A sends an encrypted control packet to Client B via the server. The server sees a packet but cannot distinguish it from a text message or an image.
*   **Visibility:** The server tracks "Last Seen" timestamps based on WebSocket connection events, but not conversation partners.

### 5.4 Offline Delivery
Messages are stored in the database until delivery. The client implements an ACK protocol.
1.  Server sends message to Client.
2.  Client decrypts, stores locally, sends ACK.
3.  Server deletes message from DB (or marks for deletion).
*   *Ephemeral Messages:* The server enforces a TTL (Time To Live) cleanup job. Even if the client never fetches it, the message is scrubbed from the DB after `expires_at`.

---

## 6. Self-Hosting & Operations

### 6.1 Deployment Stack
The entire application is distributed as a `docker-compose.yml` file to ensure reproducibility.

**Services:**
1.  **App:** The Go binary.
2.  **DB:** PostgreSQL.
3.  **Proxy:** Caddy. It handles automatic TLS (Let's Encrypt) and reverse proxying to the App.

**Admin Workflow:**
1.  Provision a generic VPS (e.g., DigitalOcean Droplet, Linode).
2.  Install Docker & Docker Compose.
3.  Clone repo and run `docker-compose up -d`.
4.  Caddy automatically provisions HTTPS for the configured domain.

### 6.2 External Dependencies
*   **DNS:** Admin points an A-record to the VPS IP.
*   **SMTP:** Optional. If the admin wants invite emails, they configure an SMTP relay (e.g., Mailgun, or a local Postfix container).

### 6.3 Backups
*   **Database:** A sidecar container runs `pg_dump` nightly and uploads the encrypted SQL dump to an S3 bucket (or local storage).
    *   *Crucial:* This backup contains the encrypted messages. If the database is exfiltrated, the attacker gets ciphertext, not plaintext.
*   **User Keys:** Not backed up by the server. Users are responsible for their own key backups (Seed Phrase).

---

## 7. Threat Model

### 7.1 The Malicious Server Operator
*   **Can Observe:**
    *   Social Graph: Who knows whom (via the invite tree).
    *   Traffic Metadata: Who is online, when messages are sent, and approximate sizes.
    *   IP addresses of users.
*   **Cannot Observe:**
    *   Message content.
    *   Image/File content.
    *   Typing indicators (treated as encrypted messages).
    *   Read Receipts (treated as encrypted messages).

### 7.2 Database Exfiltration
*   **Scenario:** The server DB is stolen.
*   **Impact:** Attacker gains `identity_public_keys` (safe) and `message_payloads` (ciphertext). Without the user's private keys, the messages are computationally infeasible to decrypt. The attacker sees the *Invite Tree* structure.

### 7.3 Compromised Member Device
*   **Blast Radius:**
    *   Access to all conversations the member is part of.
    *   Ability to invite new members (limited by quota).
*   **Containment:** The user can be "Key Rotated" (revoked). New keys are generated on a new device. The old session keys are useless for future messages. Group keys are rotated immediately upon user removal.

### 7.4 Invite System Attacks
*   **Brute Force:** Invite tokens are long UUIDs (128-bit). Infeasible to guess.
*   **Transferability:** Invite links are bearer tokens. If a member leaks their invite link publicly, unauthorized users could join.
    *   *Mitigation:* Admins can see who used the invite and ban the unauthorized user + the leaker. Trust is transitive; leaking an invite is a violation of the# System Design: "Secret Society"

## 1. Architecture Overview

The system follows a **Fat Client / Dumb Server** architecture. Given the requirement for End-to-End Encryption (E2EE) and a constrained deployment environment, the server acts primarily as a coordination and relay layer, remaining strictly ignorant of message content.

### 1.1 Component Diagram

```ascii
      +-------------------+        +-------------------+
      |   Client (Mobile  |        |   Client (Web     |
      |   /Desktop/Web)   |        |   Wrapper)        |
      +--------+----------+        +--------+----------+
               |  E2EE Payloads (WS/HTTPS)   |
               |                             |
      +--------v----------+        +--------v----------+
      |   Load Balancer   | <----> |   TLS Terminator  |
      |   (Nginx/Caddy)   |        |   (Let's Encrypt) |
      +--------+----------+        +-------------------+
               |
      +--------v----------+
      |  App Server (Go)  | <--- Stateless API / WebSocket Hub
      |  - Invite Logic   |
      |  - Message Relay  |
      |  - Presence Mgr   |
      +--------+----------+
               |
      +--------v----------+        +-------------------+
      |    PostgreSQL     |        |  Object Storage   |
      |    (Metadata &    |        |  (Encrypted Blobs)|
      |    Encrypted Msgs)|        +-------------------+
      +-------------------+
```

### 1.2 Technology Choices

*   **App Server (Go):** Chosen for its concurrency model (goroutines handle 1,000 WebSockets trivially) and single-binary output, which drastically simplifies deployment compared to Node.js or Python environments.
*   **Database (PostgreSQL):** At 1,000 users, a relational database is the right choice. It enforces the invite tree integrity via foreign keys, handles relational queries (groups/members) efficiently, and requires no special ops knowledge (unlike Cassandra/Scylla).
*   **Protocol (WebSocket over TLS):** Persistent connections allow for instant delivery of messages and presence updates (typing indicators) without the overhead of HTTP headers for every event.

---

## 2. End-to-End Encryption Design

The protocol is based on the **Signal Protocol** (Double Ratchet Algorithm) with adaptations for group messaging.

### 2.1 Key Generation & Identity
Every user generates an Identity Key Pair (Ed25519) upon installation.
*   **Identity Key (IK):** Long-term key used for signing.
*   **Signed Pre-Key (SPK):** Rotated periodically; signed by IK.
*   **One-Time Pre-Keys (OPK):** A pool of keys uploaded to the server to facilitate asynchronous session establishment.

### 2.2 Key Exchange (X3DH)
To start a 1:1 chat, Alice requests Bob's "key bundle" from the server. The server provides Bob's IK, SPK, and one OPK. Alice performs the X3DH calculation locally to derive a shared secret. She then initiates the Double Ratchet. The server cannot perform this calculation as it lacks Alice's private keys and Bob's OPK private key.

### 2.3 Forward Secrecy & Compromise
*   **Mechanism:** The Double Ratchet algorithm generates a new unique message key for every message sent/received.
*   **Forward Secrecy:** Past messages cannot be decrypted because the keys used to encrypt them have been deleted from the device memory.
*   **Post-Compromise Security:** If a device is compromised, the attacker can decrypt messages from that point forward. However, the "Diffie-Hellman ratchet" creates a new shared secret every time the other party replies, healing the session security assuming the attacker does not maintain persistent access.

### 2.4 Group Chats (Sender Keys)
To avoid encrypting a message 50 times for a group of 50:
1.  A group member generates a symmetric "Sender Key" for that group.
2.  They encrypt this Sender Key individually for each other member using their established 1:1 channels.
3.  All subsequent group messages are encrypted with this single Sender Key.
4.  **Re-keying:** If a member leaves or is removed, the admin instructs the group to generate new Sender Keys, excluding the removed party.

### 2.5 Key Restoration (Multi-Device)
**Hard Requirement Trade-off:** The server does not store private keys.
*   **Scenario A (Existing Device):** A user scans a QR code on the new device with the old device. The old device acts as a secure channel to transfer the Identity Key and current session states.
*   **Scenario B (No Existing Device):** Users must back up their Identity Key manually (e.g., writing down a seed phrase).
    *   *Note:* Message history is not restored unless the user exported an encrypted backup file locally. This minimizes server complexity and attack surface.

### 2.6 Server Storage Visibility
The server stores encrypted blobs (ciphertext). It stores:
*   The sender's ID.
*   The recipient's ID (or Group ID).
*   A timestamp.
*   The encrypted payload.
It cannot read message content, media filenames, or reaction metadata.

---

## 3. Invite System

The system relies on a chain of trust.

### 3.1 Lifecycle
1.  **Generation:** Alice (Member) requests an invite. The server checks her "invite quota" (e.g., max 3 active invites). If valid, it generates a random `invite_token` (UUID).
2.  **Storage:** The server stores `invite_token_hash` and `creator_id`.
3.  **Distribution:** Alice sends the token to Bob externally.
4.  **Validation:** Bob enters the token during registration. The server verifies the hash.
5.  **Linkage:** Upon successful registration, the server creates a link `new_user_id` -> `creator_id`. The invite is marked `redeemed`.

### 3.2 Privacy & Anonymity
To prevent the server from profiling potential members before they join, the server only sees the `invite_token` when it is generated and when it is used. It does not store metadata about *who* the invite is intended for until that person actually registers.

### 3.3 Revocation & Abuse Prevention
*   **Revocation:** The creator or an Admin can invalidate an unused invite code, deleting the hash from the DB.
*   **Member Removal:** If a member is banned, the Admin can view the "Invite Tree" in the Admin Panel. The UI allows selective pruning: "Ban User and all invites created by them."
*   **Quotas:** Limits prevent mass inviting.
*   **Replay Attacks:** Once an invite is `redeemed`, the token is invalidated.

---

## 4. Data Model

All "Content" fields are encrypted blobs. "Metadata" fields are plaintext for routing/indexing.

### Table: `users`
| Field | Type | Notes |
| :--- | :--- | :--- |
| `id` | UUID | PK |
| `identity_pub_key` | TEXT | Plaintext (Verification) |
| `display_name` | BYTEA | **Encrypted Blob** (Client decrypts) |
| `avatar_id` | UUID | FK to `files` (Encrypted image) |
| `status` | ENUM | 'active', 'banned' |
| `invited_by` | UUID | FK to `users` (The Trust Chain) |

### Table: `invites`
| Field | Type | Notes |
| :--- | :--- | :--- |
| `id` | UUID | PK |
| `token_hash` | TEXT | Indexed for lookup |
| `creator_id` | UUID | FK to `users` |
| `redeemed_by` | UUID | FK to `users` (Nullable) |

### Table: `messages`
| Field | Type | Notes |
| :--- | :--- | :--- |
| `id` | UUID | PK |
| `sender_id` | UUID | FK to `users` |
| `recipient_id` | UUID | User ID or Group ID |
| `payload` | BYTEA | **Encrypted Message Envelope** |
| `created_at` | TIMESTAMP | Server time |
| `expires_at` | TIMESTAMP | For ephemeral messages |

---

## 5. Real-Time Protocol

### 5.1 Transport
**Secure WebSockets (WSS)**.
*   Clients maintain a persistent connection to the server.
*   **Heartbeat:** Pings every 30s to keep NAT mappings open and check presence.

### 5.2 Message Routing
1.  **Send:** Client A encrypts message for Client B. Sends JSON: `{ "to": "B", "payload": "0x..." }`.
2.  **Relay:** Server checks if Client B has an active WebSocket connection.
    *   **Online:** Server pushes payload immediately.
    *   **Offline:** Server inserts payload into `messages` table.
3.  **Sync:** When Client B connects, it requests: `GET /messages?since=<last_msg_id>`. The server streams all stored blobs.

### 5.3 Presence & Typing Indicators
To prevent traffic analysis (who is talking to whom), presence signals are treated as messages.
*   **Typing:** Client A sends an encrypted control packet to Client B via the server. The server sees a packet but cannot distinguish it from a text message or an image.
*   **Visibility:** The server tracks "Last Seen" timestamps based on WebSocket connection events, but not conversation partners.

### 5.4 Offline Delivery
Messages are stored in the database until delivery. The client implements an ACK protocol.
1.  Server sends message to Client.
2.  Client decrypts, stores locally, sends ACK.
3.  Server deletes message from DB (or marks for deletion).
*   *Ephemeral Messages:* The server enforces a TTL (Time To Live) cleanup job. Even if the client never fetches it, the message is scrubbed from the DB after `expires_at`.

---

## 6. Self-Hosting & Operations

### 6.1 Deployment Stack
The entire application is distributed as a `docker-compose.yml` file to ensure reproducibility.

**Services:**
1.  **App:** The Go binary.
2.  **DB:** PostgreSQL.
3.  **Proxy:** Caddy. It handles automatic TLS (Let's Encrypt) and reverse proxying to the App.

**Admin Workflow:**
1.  Provision a generic VPS (e.g., DigitalOcean Droplet, Linode).
2.  Install Docker & Docker Compose.
3.  Clone repo and run `docker-compose up -d`.
4.  Caddy automatically provisions HTTPS for the configured domain.

### 6.2 External Dependencies
*   **DNS:** Admin points an A-record to the VPS IP.
*   **SMTP:** Optional. If the admin wants invite emails, they configure an SMTP relay (e.g., Mailgun, or a local Postfix container).

### 6.3 Backups
*   **Database:** A sidecar container runs `pg_dump` nightly and uploads the encrypted SQL dump to an S3 bucket (or local storage).
    *   *Crucial:* This backup contains the encrypted messages. If the database is exfiltrated, the attacker gets ciphertext, not plaintext.
*   **User Keys:** Not backed up by the server. Users are responsible for their own key backups (Seed Phrase).

---

## 7. Threat Model

### 7.1 The Malicious Server Operator
*   **Can Observe:**
    *   Social Graph: Who knows whom (via the invite tree).
    *   Traffic Metadata: Who is online, when messages are sent, and approximate sizes.
    *   IP addresses of users.
*   **Cannot Observe:**
    *   Message content.
    *   Image/File content.
    *   Typing indicators (treated as encrypted messages).
    *   Read Receipts (treated as encrypted messages).

### 7.2 Database Exfiltration
*   **Scenario:** The server DB is stolen.
*   **Impact:** Attacker gains `identity_public_keys` (safe) and `message_payloads` (ciphertext). Without the user's private keys, the messages are computationally infeasible to decrypt. The attacker sees the *Invite Tree* structure.

### 7.3 Compromised Member Device
*   **Blast Radius:**
    *   Access to all conversations the member is part of.
    *   Ability to invite new members (limited by quota).
*   **Containment:** The user can be "Key Rotated" (revoked). New keys are generated on a new device. The old session keys are useless for future messages. Group keys are rotated immediately upon user removal.

### 7.4 Invite System Attacks
*   **Brute Force:** Invite tokens are long UUIDs (128-bit). Infeasible to guess.
*   **Transferability:** Invite links are bearer tokens. If a member leaks their invite link publicly, unauthorized users could join.
    *   *Mitigation:* Admins can see who used the invite and ban the unauthorized user + the leaker. Trust is transitive; leaking an invite is a violation of the social contract.