/* Express + Socket.IO bootstrap */

import http            from 'http';
import path            from 'node:path';
import { fileURLToPath } from 'node:url';

import express         from 'express';
import cors            from 'cors';
import morgan          from 'morgan';

import { cfg }         from './config/env.js';
import { connectDB }   from './config/db.js';
import { redis }       from './config/redis.js';
import { initSocket }  from './socket.js';
import { chatRouter }  from './routes/chatRoutes.js';   // will arrive in Part 4

/* ------------ database connections ------------ */
await connectDB();          // Mongo -> OK or throws
await redis.ping();         // Redis connectivity check

/* ------------ express ------------ */
const app = express();
const server = http.createServer(app);
initSocket(server);         // sets global `io`

app.use(cors());
app.use(express.json({ limit:'1mb' }));
app.use(express.urlencoded({ extended:false }));
app.use(morgan('dev'));

/* optional: serve local uploads for dev */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

/* routes */
app.use('/api/v1', chatRouter);          // REST endpoints

/* 404 fallback */
app.use('*', (_req, res) => res.status(404).json({ message:'Not found' }));

server.listen(cfg.port, () =>
  console.log(`🚀  Chat-API running on http://localhost:${cfg.port}`)
);
