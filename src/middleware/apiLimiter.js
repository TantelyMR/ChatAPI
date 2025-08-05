import rateLimit from 'express-rate-limit';

/* defaults */
const common = {
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { message:'Too many requests, slow down.' }
};

/* per-user (IP+username) key generator */
function keyGen (req) {
  const user = req.user?.username ?? 'anon';
  return `${user}-${req.ip}`;
}

/* ---------- chat message spam: 60 / minute ---------- */
export const chatMessageLimiter = rateLimit({
  ...common,
  keyGenerator: keyGen,
  windowMs: 60_000,
  max: 60
});

/* ---------- conversation searches: 30 / minute ------ */
export const chatSearchLimiter = rateLimit({
  ...common,
  keyGenerator: keyGen,
  windowMs: 60_000,
  max: 30
});

/* ---------- edits: 20 / 5 min ----------------------- */
export const editConversationLimiter = rateLimit({
  ...common,
  keyGenerator: keyGen,
  windowMs: 300_000,
  max: 20
});

/* ---------- create/start conversation: 10 / hour ---- */
export const startConversationLimiter = rateLimit({
  ...common,
  keyGenerator: keyGen,
  windowMs: 3_600_000,
  max: 10
});
