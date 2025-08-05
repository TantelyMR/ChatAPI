import IORedis  from 'ioredis';
import { cfg }  from './env.js';

export const redis = new IORedis(cfg.redisUrl);

redis.on('connect', () => console.log('🔌 Redis connected'));
redis.on('error',   err => console.error('Redis error', err));
