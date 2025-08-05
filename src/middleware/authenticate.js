import jwt from 'jsonwebtoken';
import { cfg } from '../config/env.js';
import { User } from '../models/index.js';       // to fetch user id

export async function authenticate(req, res, next) {
  try {
    const bearer = req.headers.authorization?.split(' ')[1]
      || req.cookies?.token
      || req.query?.token;              // fallback for websockets

    if (!bearer) return res.status(401).json({ message: 'Missing token' });

    let payload;
    try {
      payload = jwt.verify(bearer, cfg.jwtSecret);
    } catch (err) {
      return res.status(401).json({ message: 'Invalid / expired token' });
    }

    const user = await User.findOne({ username: payload.username }).lean();
    if (!user) return res.status(401).json({ message: 'User not found' });

    req.user = { id: user.id, username: user.username };
    next();
  } catch (err) {
    console.error('auth middleware error', err);
    res.status(500).json({ message: 'Auth server error' });
  }
}
