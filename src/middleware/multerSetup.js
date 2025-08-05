import multer           from 'multer';
import path             from 'node:path';
import fs               from 'node:fs/promises';
import { randomBytes }  from 'node:crypto';
import { cfg }          from '../config/env.js';

const diskStorage = multer.diskStorage({
  async destination (req, _file, cb) {
    const tmp = path.join(
      cfg.mediaTemp,
      `tmp_${req.user.username}_${Date.now()}`
    );
    await fs.mkdir(tmp, { recursive:true });
    req.tempDir = tmp;                       // pass to downstream handlers
    cb(null, tmp);
  },
  filename (_req, file, cb) {
    const ext  = path.extname(file.originalname) || '';
    const rand = randomBytes(6).toString('hex');
    cb(null, `${rand}${ext}`);
  }
});

/* 250 MB default limit (configurable via .env) */
export const upload = multer({
  storage: diskStorage,
  limits:  { fileSize: cfg.maxFileMb * 1024 * 1024 }
});
