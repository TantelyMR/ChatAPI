import { Router } from 'express';

import { authenticate } from '../middleware/authenticate.js';
import {
  chatMessageLimiter,
  chatSearchLimiter,
  editConversationLimiter,
  startConversationLimiter
} from '../middleware/apiLimiter.js';

import { mediaHandler } from '../middleware/mediaHandler.js';

/* ---------- controller functions (direct imports) ---------- */
import { startConversation } from '../controllers/chatController.js';
import { editConversation } from '../controllers/chatController.js';
import { getConversation } from '../controllers/chatController.js';
import { getDirectMessage } from '../controllers/chatController.js';
import { getConversationsByUser } from '../controllers/chatController.js';
import { approveMessage } from '../controllers/chatController.js';
import { denyMessage } from '../controllers/chatController.js';
import { addConversMember } from '../controllers/chatController.js';
import { removeConversMember } from '../controllers/chatController.js';
import { addConversAdmin } from '../controllers/chatController.js';
import { removeConversAdmin } from '../controllers/chatController.js';
import { readConversation } from '../controllers/chatController.js';
import { markChatStatus } from '../controllers/chatController.js';
import { leaveConversation } from '../controllers/chatController.js';
import { getMessagesByConversation } from '../controllers/chatController.js';
import { deleteMessage } from '../controllers/chatController.js';
import { searchConversation } from '../controllers/chatController.js';
import { searchAllConversations } from '../controllers/chatController.js';

import { createNewMessage } from '../controllers/chatController.js';
import { sendMediaMessage } from '../controllers/chatController.js';
import { reactToMessage } from '../controllers/chatController.js';

export const chatRouter = Router();

/* ────────────────────────────────────────────────────────── */
/* Conversation look-ups                                      */
chatRouter.get('/chat', authenticate, getConversation);
chatRouter.get('/chat/:conversation', authenticate, getConversation);

chatRouter.get('/chat/dm/:username', authenticate, getDirectMessage);
chatRouter.get('/chats/:username', authenticate, getConversationsByUser);

/* Messages pagination */
chatRouter.get('/chat/messages/:conversationId',
  authenticate,
  getMessagesByConversation);

/* ────────────────────────────────────────────────────────── */
/* Sending messages                                           */

/* 1) Plain text / GIF / sticker  → createNewMessage
 *    no file uploads, so no mediaHandler                       */
chatRouter.post('/chat/messages/:username',
  authenticate,
  chatMessageLimiter,
  createNewMessage);

/* 2) Images or video uploads     → sendMediaMessage
 *    uses mediaHandler (multer)                                */
chatRouter.post('/chat/media/:username',
  authenticate,
  chatMessageLimiter,
  mediaHandler,
  sendMediaMessage);

/* 3) React (emoji) to a message  → reactToMessage */
chatRouter.patch('/chat/reaction/:username',
  authenticate,
  chatMessageLimiter,
  reactToMessage);

/* Delete own message */
chatRouter.delete('/chat/messages/:username/:messageId',
  authenticate,
  chatMessageLimiter,
  deleteMessage);

/* ────────────────────────────────────────────────────────── */
/* Start / edit / leave conversations                         */
chatRouter.post('/chat/start/:username',
  authenticate,
  startConversationLimiter,
  startConversation);

chatRouter.route('/chat/:username/:conversationId')
  .patch(authenticate,
    editConversationLimiter,
    mediaHandler,       // for optional cover/background
    editConversation)
  .delete(authenticate, leaveConversation);

/* Member mgmt */
chatRouter.route('/chat/m/:username/:conversationId/:member')
  .post(authenticate, addConversMember)
  .delete(authenticate, removeConversMember);

chatRouter.route('/chat/a/:username/:conversationId/:member')
  .post(authenticate, addConversAdmin)
  .delete(authenticate, removeConversAdmin);

/* Reads / status */
chatRouter.post('/chat/view/:username/:conversationId/:messageId',
  authenticate, readConversation);

chatRouter.patch('/chat/view/:username/:conversationId',
  authenticate, markChatStatus);

/* Message-approval flows */
chatRouter.route('/chat/review/:username/:notifier')
  .post(authenticate, approveMessage)
  .delete(authenticate, denyMessage);

/* Search */
chatRouter.get('/chat/search/:username/:conversationId',
  authenticate,
  chatSearchLimiter,
  searchConversation);

chatRouter.get('/chat/search/:username',
  authenticate,
  chatSearchLimiter,
  searchAllConversations);
