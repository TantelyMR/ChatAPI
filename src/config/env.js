/* tiny wrapper around dotenv */

import dotenv from 'dotenv';
dotenv.config();

export const cfg = {
  port:        process.env.PORT          ?? 5000,
  mongoUri:    process.env.MONGO_URI,
  redisUrl:    process.env.REDIS_URL,
  jwtSecret:   process.env.JWT_SECRET,
  mediaTemp:   process.env.MEDIA_TEMP    ?? '/tmp/chat-api',
  cdnBase:     process.env.CDN_BASE_URL,
  maxFileMb:   Number(process.env.MAX_FILE_MB ?? 250)
};
