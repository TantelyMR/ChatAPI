import { Server }   from 'socket.io';
import jwt          from 'jsonwebtoken';
import { redis }    from './config/redis.js';
import { cfg }      from './config/env.js';

export let io;                                // populated in initSocket()

const KEY_PREFIX = 'chat:sockets:';           // redis key prefix

export function initSocket (httpServer) {
  io = new Server(httpServer, { cors:{ origin:'*' } });

  io.on('connection', socket => {
    /* ---------- JWT auth ---------- */
    const { token } = socket.handshake.auth ?? {};
    if (!token) return socket.disconnect(true);

    let payload;
    try {
      payload = jwt.verify(token, cfg.jwtSecret);
    } catch {
      return socket.disconnect(true);         // invalid / expired token
    }
    const username = payload.username;
    if (!username) return socket.disconnect(true);

    /* ---------- presence ---------- */
    const key = KEY_PREFIX + username;
    redis.sadd(key, socket.id);
    redis.expire(key, 60 * 60 * 4);           // 4 h idle cleanup

    /* heartbeat keeps key alive */
    const keepAlive = setInterval(
      () => redis.expire(key, 60 * 60 * 4),
      30_000
    );

    socket.on('disconnect', () => {
      clearInterval(keepAlive);
      redis.srem(key, socket.id);
    });
  });
}

/* retrieve active socket ids for a user */
export async function getSocketsForUser (username) {
  return await redis.smembers(KEY_PREFIX + username) ?? [];
}
