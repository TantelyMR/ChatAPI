# 💬 Chat-API

A pluggable, real-time chat micro-service you can mount behind **any** front-end
(web, mobile, desktop).  
Runs on bare Node 20 LTS, MongoDB, Redis and Socket.IO – *no Docker required*.

[![CI](https://github.com/your-org/chat-api/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/chat-api/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## Features

| Core | Details |
| --- | --- |
| **Conversations** | group / DM, admin & member roles, hashing to avoid duplicates |
| **Messages** | text • image(s) • GIF stickers (GIPHY) • links |
| **Reactions** | any unicode emoji, toggle to remove |
| **Moderation** | delete own message, leave chat |
| **Search** | within a chat or all chats |
| **Notifications** | Socket.IO push to online members, offline batching ready |
| **Storage** | MongoDB collections, R2-compatible object storage helpers |
| **No Docker** | plain `node`, `npm`, `mongod`, `redis-server` |

---

## Quick Start

```bash
# 1 · clone
git clone https://github.com/your-org/chat-api.git
cd chat-api

# 2 · install dependencies
npm ci      # uses the lock-file shipped with the repo

# 3 · configure
cp .env.sample .env    # fill in Mongo/Redis URLs & a JWT secret

# 4 · start Mongo & Redis (examples)

## Linux (system packages)
sudo service mongod start
redis-server --daemonize yes

## Windows (Chocolatey)
choco install mongodb redis-64
net start MongoDB
redis-server --service-start

## macOS (Homebrew – *optional*)
brew services start mongodb-community@6.0
brew services start redis

# 5 · run dev server
npm run dev            # nodemon + ES-modules
# -> API   : http://localhost:4000
# -> Socket: ws://localhost:4000
```

## REST API

| Verb       | Endpoint                                                  | Body / Params                                                      | Description                           |
| ---------- | --------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------- |
| **POST**   | `/api/v1/chat/start/:username`                            | `{ name?, description?, members[], collaborators?[] }`             | Create conversation (DM if 2 members) |
| **PATCH**  | `/api/v1/chat/:username/:conversationId`                  | `multipart/form-data` (`data` JSON + optional `media[] / cover[]`) | Edit name / desc / theme / cover / bg |
| **DELETE** | `/api/v1/chat/:username/:conversationId`                  | —                                                                  | Leave (or delete if last member)      |
| **GET**    | `/api/v1/chat/:conversationId`                            | —                                                                  | Conversation by id                    |
| **GET**    | `/api/v1/chats/:username?limit=&page=`                    | —                                                                  | Paginated list for user               |
| **POST**   | `/api/v1/chat/messages/:username`                         | `{ conversationId, content, type, attachment?, mentions?[] }`      | Send text / sticker / link            |
| **DELETE** | `/api/v1/chat/messages/:username/:messageId`              | —                                                                  | Delete own message                    |
| **PATCH**  | `/api/v1/chat/react/:username`                            | `{ messageId, emoji }`                                             | Toggle reaction                       |
| **GET**    | `/api/v1/chat/messages/:conversationId?page=&limit=`      | —                                                                  | Paginated message history             |
| **GET**    | `/api/v1/chat/search/:username/:conversationId?keywords=` | —                                                                  | Search inside one chat                |
| **GET**    | `/api/v1/chat/search/:username?keywords=`                 | —                                                                  | Search across all user chats          |

All endpoints require a session middleware that sets req.user
({ id, username }) – adapt to JWT / session store of your choice.

| Direction           | Event               | Payload                                      |
| ------------------- | ------------------- | -------------------------------------------- |
| **Client → Server** | `authenticate`      | `{ token }` (set in `socket.handshake.auth`) |
| **Server → Client** | `shareChatMessage`  | full message object                          |
| ↳                   | `shareChatReaction` | `{ message_id, reaction, user, removed }`    |
| ↳                   | `chatEdit`          | `{ status, message }` (success / error)      |
| ↳                   | `notification`      | { custom payloads – DM request, etc. }       |

Sockets are mapped in Redis (chat:sockets:<username>) so you can scale to
multiple Node processes with a Socket.IO Redis adapter.

## Project Structure
```
ChatAPI/
├─ src/
│  ├─ server.js              # Express + Socket bootstrap
│  ├─ socket.js              # Socket.IO init & helpers
│  ├─ routes/
│  │   └─ chatRoutes.js
│  ├─ controllers/
│  │   └─ chatController.js  # (full logic, ~950 LOC)
│  ├─ models/                # Mongoose schemas
│  ├─ services/
│  │   └─ r2.js              # tiny “upload/delete” wrapper
│  ├─ utils/                 # hash, emoji, clamp, etc.
│  └─ config/
│      ├─ env.js             # loads .env
│      └─ redis.js
├─ .env.sample
├─ package.json
└─ README.md  ← you are here
```

## Environment Variables (.env)

| Key           | Required | Default                   | Notes                                    |
| ------------- | -------- | ------------------------- | ---------------------------------------- |
| `PORT`        | no       | `4000`                    | HTTP & WS listen port                    |
| `MONGODB_URI` | **yes**  | —                         | e.g. `mongodb://localhost:27017/chatapi` |
| `REDIS_URI`   | **yes**  | —                         | `redis://127.0.0.1:6379`                 |
| `JWT_SECRET`  | **yes**  | —                         | if you use JWT auth                      |
| `CDN`         | no       | `https://cdn.example.com` | base URL for R2 / S3 files               |

(Add any cloud-storage credentials you need for uploadLocalFolderToR2 or swap to S3 helpers.)

#### Push / Notifications stub

The repo ships with simple Web-Push (VAPID) utilities in src/push/.
Replace or extend with FCM/APNs as needed – just implement sendPush(userId, payload) promise and wire into controller hooks (notifyMention, notifyReactionBatch).

## Rate Limits

| Route group          | Window (s) | Max calls | Uses               |
| -------------------- | ---------- | --------- | ------------------ |
| POST `/chat/message` | 3          | 6         | fast typing bursts |
| POST `/chat/start`   | 10         | 3         | prevent spam       |
| PATCH `/chat/:id`    | 30         | 5         | edits / media      |

You can expand or limit these as you see fit or add more limits to the other endpoints.