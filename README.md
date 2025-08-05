# 💬 Chat-API

Modern, self-hosted chat micro-service – bring your own front-end and plug in real-time messaging with file-sharing, MongoDB persistence, Redis queues, and socket.io.

---

## Features

| Capability                              | Details                                                                      |
|-----------------------------------------|------------------------------------------------------------------------------|
| **1-to-1 & group conversations**        | any size (variable limit = 333 members)                                           |
| **Message types**                       | text · image(s) · video · GIF sticker · link preview (URL field)             |
| **Media pipeline**                      | multipart `/media` upload → sharp / ffmpeg conversion → WebP / MP4            |
| **Inline reactions**                    | unlimited emoji per message                                                  |
| **Mentions**                            | `@username` detection with push or socket notification                       |
| **Rate-limit**                          | configurable per-route *express-rate-limit*                                  |
| **Sockets**                             | socket.io v4 for live chat / typing / reactions                              |
| **Push abstraction**                    | example Web-Push code stub (add FCM/APNs later)                              |
| **MongoDB schemata included**           | Conversation · Member · ChatMessage · User · Notification · Read marker      |
| **Redis**                               | BullMQ for image/video jobs + in-memory presence list                        |
| **Node 20+**                            | ESM + top-level `await`, no transpiler                                       |

> – run directly on bare Node 20+.  
> You need **MongoDB >= 5** and **Redis >= 6** reachable via network.

---

## Quick Start

```bash
git clone https://github.com/<your-org>/chat-api.git
cd chat-api
cp .env.sample .env                 # edit Mongo / Redis URIs & JWT secret
npm ci
npm run dev                          # nodemon (--watch src)
```

| Service          | Default URL                                                  |
| ---------------- | ------------------------------------------------------------ |
| REST API         | [http://localhost:5000/api/v1](http://localhost:5000/api/v1) |
| Socket namespace | `/chat` (connect to same origin)                             |
--------------------------------------

| Verb     | Endpoint                   | Body / params                              | Description                          |
| -------- | -------------------------- | ------------------------------------------ | ------------------------------------ |
| `POST`   | `/auth/login`              | `{ username, password }`                   | JWT login (demo only)                |
| `POST`   | `/chat/start`              | `{ members[], name?, description? }`       | Create group or DM                   |
| `GET`    | `/chat/:id`                | —                                          | Get single conversation (metadata)   |
| `GET`    | `/chat?user=:username`     | `page,limit` query                         | Paginated list for a user            |
| `PATCH`  | `/chat/:id`                | multipart (cover/background) + JSON        | Edit name / desc / media             |
| `DELETE` | `/chat/:id`                | —                                          | Leave ⟶ auto-delete if last member   |
| `POST`   | `/chat/:id/message`        | `{ type, content?, url?, tags[] }` + media | Send message                         |
| `GET`    | `/chat/:id/message`        | `page,limit` query                         | Fetch messages (newest→oldest)       |
| `DELETE` | `/chat/:id/message/:msgId` | —                                          | Delete own message                   |
| `POST`   | `/chat/:id/react`          | `{ messageId, emoji }`                     | Toggle reaction                      |
| `PATCH`  | `/chat/:id/read/:msgId`    | —                                          | Mark up-to msgId as read             |
| `GET`    | `/search`                  | `q, conversationId?`                       | Full-text search in one / all convos |

### All endpoints require Authorization: Bearer <JWT> except /auth/*.

## Socket.io Events (/chat namespace)

| Client → Server | Payload                        | Server → all in room | Payload                  |
| --------------- | ------------------------------ | -------------------- | ------------------------ |
| `chat:typing`   | `{ convId, typing: true }`     | `chat:typing`        | same                     |
| `chat:message`  | same as REST `/message` body   | `chat:message`       | full saved message       |
| `chat:reaction` | `{ convId, messageId, emoji }` | `chat:reaction`      | same + `removed` flag    |
| ―               | —                              | `chat:member:update` | joined/left/admin change |

### Handshake must include JWT query param: ?token=<JWT>.


## MongoDB Schemas (Mongoose)
User
``` js
{
  id: String,           // nanoid 10
  username: String,
  passwordHash: String, // bcrypt
  profile: {
    avatarURL: { '360p': String, '180p': String }
  },
  mentions: { type: String, enum: ['everyone','approval','nobody'], default:'everyone' },
  blocked: [String]     // array of user ids
}
```
Conversation 
``` js
{
  id: String,                    // nanoid 12
  name: String,
  description: String,
  creator: String,               // user id
  collaborators: [String],       // admin ids
  members_hash: String,          // SHA-256 sorted member ids
  members_count: Number,
  dm: Boolean,
  cover: Map,                    // { '720p': url, ... }
  background: Map,               // same
  last_message: String,
  last_message_user: String,
  last_message_id: String,
  last_message_update: Date,
  time_created: Date,
  last_time_modified: Date
}
```

ConversationMember
``` js
{
  conversation_id: String,
  member: String,        // user id
  inviter: String,
  queue: Boolean,        // true = pending approval
  invited_on: Date,
  joined_on: Date
}
```
ChatMessage

``` js
{
  id: String,                   // nanoid 14
  conversation_id: String,
  user: String,                 // user id or 'system'
  type: { type:String, enum:['text','media','sticker','link'] },
  content: String,              // text
  attachment: {
    type: String,               // image | video | gif | link
    url: Map,                   // { '360p': string | string[] }
    sensitivity: { type:String, enum:['neutral','sensitive','unsafe'] }
  },
  mentions: [String],           // usernames
  reply_to: { messageId:String, username:String, snippet:String },
  reactions: [
    { reaction:String, users:[String] }
  ],
  last_reaction_time: Date,
  time_posted: Date,
  time_modified: Date
}
```

ChatView (read markers)
``` js
{
  user: String,                 // user id
  conversation_id: String,
  last_message_read: String,    // msg id
  last_time_read: Date,
  read: Boolean
}
```

Notification (sample)

``` js
{
  id: String,
  user: String,
  type: { type:String, enum:['messageMention','messageApproval','reaction'] },
  conversation_id: String,
  asset_id: String,        // message id
  notifier: String,
  notifier_avatar: String,
  message: String,
  preview: String,
  read: Boolean,
  time_posted: Date
}
```
## Redis Usage
| Key / Channel          | Purpose                      |
| ---------------------- | ---------------------------- |
| `bull:*`               | BullMQ job queue for media   |
| `presence:<username>`  | set of active socket IDs     |
| `chat:typing:<convId>` | pub/sub for typing indicator |


### Project Structure

```
chat-api/
├─ src/
│  ├─ config/
│  │   ├─ env.js           # loads .env, exports config
│  │   └─ rateLimit.js
│  ├─ models/              # mongoose schemas above
│  ├─ routes/
│  │   ├─ authRoutes.js
│  │   └─ chatRoutes.js
│  ├─ controllers/         # chatController.js, authController.js
│  ├─ middleware/
│  │   ├─ authenticate.js  # JWT verify
│  │   ├─ multerMedia.js   # image/video parser (sharp/ffmpeg helpers)
│  │   └─ socketUtils.js   # connectedUsers map helpers
│  ├─ jobs/                # BullMQ processors (imageWorker.js)
│  ├─ sockets/             # socket.io event handlers
│  └─ server.js            # express app & http / socket server
├─ .env.sample
└─ package.json
```

## Environment Variables
| Variable       | Example                       | Description                    |
| -------------- | ----------------------------- | ------------------------------ |
| `PORT`         | `5000`                        | HTTP listen port               |
| `MONGO_URI`    | `mongodb://localhost/chatapi` | MongoDB connection string      |
| `REDIS_URL`    | `redis://127.0.0.1:6379/0`    | Redis connection               |
| `JWT_SECRET`   | `superSecret123`              | HS256 signing key              |
| `MEDIA_TEMP`   | `/tmp/chat-api`               | temp folder for uploads        |
| `CDN_BASE_URL` | `https://cdn.example.com`     | public bucket/prefix for media |
| `MAX_FILE_MB`  | `250`                         | per-file upload limit          |

(Add any cloud-storage credentials you need for uploadLocalFolderToR2 or swap to S3 helpers.)
## Local Development (no Docker)

### 1 · Start MongoDB & Redis

| OS / method               | Command(s)                                                                    |
|---------------------------|-------------------------------------------------------------------------------|
| **Docker (any OS)**       | `docker run -d --name mongo -p 27017:27017 mongo:6`<br>`docker run -d --name redis -p 6379:6379 redis:7` |
| **Ubuntu / Debian**       | `sudo apt update && sudo apt install -y mongodb-org redis-server`<br>`sudo systemctl enable --now mongod redis-server` |
| **macOS (Homebrew)**      | `brew services start mongodb-community`<br>`brew services start redis` |
| **Windows (Chocolatey)**  | `choco install mongodb redis-64`<br>then start the “MongoDB” and “Redis” services from *Services.msc* |

All commands expose Mongo on **`mongodb://localhost:27017`** and Redis on **`redis://localhost:6379`**.

### 2 · Install dependencies

```bash
git clone https://github.com/<your-org>/chat-api.git
cd chat-api
cp .env.sample .env     # update MONGO_URI and REDIS_URL if you changed ports
npm ci

npm run dev             # nodemon watches src/
```
Open the REST playground at http://localhost:5000/api-docs.