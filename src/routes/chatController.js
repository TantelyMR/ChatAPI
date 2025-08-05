import fs from 'node:fs/promises';
import path from 'node:path';
import { nanoid } from 'nanoid';

import { cfg } from '../config/env.js';
import { io, getSocketsForUser } from '../socket.js';
import {
  User, Conversation, ConversationMember,
  ChatMessage, ChatView
} from '../models/index.js';

import { uploadToR2 } from '../services/r2.js';
import { generateHash } from '../utils/generateHash.js';
import { isValidEmoji } from '../utils/emoji.js';

async function userMapByIds(ids) {
  const users = await User.find(
    { id: { $in: ids } },
    'id username profile.avatarURL'
  ).lean();

  return new Map(
    users.map(u => [
      u.id,
      {
        id: u.id,
        username: u.username,
        avatar: u.profile?.avatarURL?.['360p'] ?? ''
      }
    ])
  );
}

async function activeSockets(username) {
  const ids = await getSocketsForUser(username);
  return ids.filter(id => {
    const s = io.sockets.sockets.get(id);
    return s && s.connected;
  });
}

async function fanoutToSockets(usernames, event, payload) {
  await Promise.all(
    usernames.map(async u => {
      (await activeSockets(u))
        .forEach(id => io.to(id).emit(event, payload));
    })
  );
}

export async function startConversation(req, res) {
  const { username } = req.params;
  const {
    name = '', description = '',
    members = [], collaborators = []
  } = req.body;

  if (!req.user || req.user.username !== username) return res.status(403).json({ message: 'Forbidden' });

  if (!Array.isArray(members) || !members.length) return res.status(400).json({ message: 'Members array cannot be empty' });
  if (!Array.isArray(collaborators)) return res.status(400).json({ message: 'Collaborators must be array' });

  try {
    const creator = await User.findOne({ username }).lean();
    if (!creator) return res.status(404).json({ message: 'User not found' });

    const uniqMembers = [...new Set([...members, username])].slice(0, 333);
    const memberDocs = await User.find({ username: { $in: uniqMembers } }).lean();
    const memberIds = memberDocs.map(u => u.id);

    const collabDocs = memberDocs.filter(u => collaborators.includes(u.username));
    const collabIds = collabDocs.map(u => u.id);

    const dm = memberIds.length === 2;
    const hash = generateHash([...memberIds].sort());

    if (await Conversation.exists({ members_hash: hash })) return res.status(400).json({ message: 'Conversation already exists' });

    const convId = nanoid(12);
    await Conversation.create({
      id: convId,
      name, description,
      creator: creator.id,
      members_hash: hash,
      members_count: memberIds.length,
      collaborators: dm ? memberIds : collabIds,
      dm,
      last_message: '^.^',
      last_message_user: creator.id,
      last_message_update: new Date(),
      time_created: new Date(),
      last_time_modified: new Date()
    });

    await ConversationMember.insertMany(
      memberIds.map(id => ({
        conversation_id: convId,
        member: id,
        inviter: creator.id,
        queue: false,
        invited_on: new Date(),
        joined_on: new Date()
      }))
    );

    res.status(201).json({ success: true, conversationId: convId });
  } catch (err) {
    console.error('startConversation', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function getConversation(req, res) {
  const convId = req.params.conversation || req.query.conversation_id;

  try {
    const conv = await Conversation.findOne({ id: convId }).lean();
    if (!conv) return res.status(404).json({ message: 'Conversation not found' });

    const members = await ConversationMember.find({ conversation_id: convId }).lean();
    const activeIds = members.filter(m => !m.queue).map(m => m.member);
    const pendingIds = members.filter(m => m.queue).map(m => m.member);

    if (!activeIds.includes(req.user.id)) return res.status(403).json({ message: 'Not a member' });

    const uMap = await userMapByIds([
      ...activeIds, ...pendingIds,
      ...conv.collaborators,
      conv.creator,
      conv.last_message_user
    ]);

    const view = await ChatView.findOne(
      { user: req.user.id, conversation_id: convId }
    ).lean();
    const unread = view?.last_time_read
      ? await ChatMessage.countDocuments({
        conversation_id: convId,
        user: { $ne: req.user.id },
        time_posted: { $gt: view.last_time_read }
      })
      : 0;

    res.setHeader('Cache-Control', 'no-cache');
    res.json({
      ...conv,
      creator: uMap.get(conv.creator),
      last_message_user: uMap.get(conv.last_message_user) ?? null,
      activeMembers: activeIds.map(id => uMap.get(id)),
      pendingMembers: pendingIds.map(id => uMap.get(id)),
      collaborators: conv.collaborators.map(id => uMap.get(id)),
      unread_count: unread,
      read: unread === 0
    });
  } catch (err) {
    console.error('getConversation', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function getDirectMessage(req, res) {
  const { username } = req.params;
  const targetUsername = req.query.target;

  if (req.user.username !== username) return res.status(403).json({ message: 'Forbidden' });

  try {
    const [me, target] = await Promise.all([
      User.findOne({ username }, 'id').lean(),
      User.findOne({ username: targetUsername }, 'id').lean()
    ]);
    if (!me || !target) return res.status(404).json({ message: 'User not found' });

    const dmAgg = await ConversationMember.aggregate([
      { $match: { member: { $in: [me.id, target.id] } } },
      { $group: { _id: '$conversation_id', members: { $addToSet: '$member' } } },
      { $match: { members: { $all: [me.id, target.id] } } }
    ]);

    const dmId = dmAgg[0]?._id;
    const dm = dmId
      ? await Conversation.findOne({ id: dmId, dm: true }, 'id').lean()
      : null;

    res.setHeader('Cache-Control', 'no-cache');
    res.json(dm ? dm.id : null);
  } catch (err) {
    console.error('getDirectMessage', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function getConversationsByUser(req, res) {
  const { username } = req.params;
  const page = +(req.query.page ?? 1);
  const limit = +(req.query.limit ?? 33);
  const skip = (page - 1) * limit;

  if (req.user.username !== username) return res.status(403).json({ message: 'Forbidden' });

  try {
    const me = await User.findOne({ username }, 'id').lean();
    if (!me) return res.status(404).json({ message: 'User not found' });

    const mem = await ConversationMember.find(
      { member: me.id, queue: false }, 'conversation_id'
    ).lean();
    const convIds = mem.map(m => m.conversation_id);

    const total = convIds.length;
    if (skip >= total) return res.json({ page, limit, totalCount: total, conversations: [], hasMore: false });

    const convs = await Conversation.find({ id: { $in: convIds } })
      .sort({ last_message_update: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    /* collect user ids */
    const uidSet = new Set();
    convs.forEach(c => {
      uidSet.add(c.creator);
      uidSet.add(c.last_message_user);
      c.collaborators.forEach(id => uidSet.add(id));
    });
    const allMem = await ConversationMember.find(
      { conversation_id: { $in: convIds } }, 'member'
    ).lean();
    allMem.forEach(m => uidSet.add(m.member));

    const uMap = await userMapByIds([...uidSet]);

    const formatted = await Promise.all(convs.map(async c => {
      const cMembers = allMem.filter(m => m.conversation_id === c.id);
      const active = cMembers.filter(m => !m.queue).map(m => uMap.get(m.member));
      const pending = cMembers.filter(m => m.queue).map(m => uMap.get(m.member));

      const view = await ChatView.findOne(
        { user: me.id, conversation_id: c.id }
      ).lean();
      const unread = view?.last_time_read
        ? await ChatMessage.countDocuments({
          conversation_id: c.id,
          user: { $ne: me.id },
          time_posted: { $gt: view.last_time_read }
        })
        : 0;

      const myJoin = cMembers.find(m => m.member === me.id)?.joined_on ?? new Date(0);
      const showLast = c.last_message_update >= myJoin;

      return {
        id: c.id,
        name: c.name,
        description: c.description,
        creator: uMap.get(c.creator),
        collaborators: c.collaborators.map(id => uMap.get(id)),
        dm: c.dm,
        last_message: showLast ? c.last_message : '',
        last_message_user: showLast ? uMap.get(c.last_message_user) : null,
        last_message_id: showLast ? c.last_message_id : '',
        last_message_update: showLast ? c.last_message_update : myJoin,
        membersCount: active.length,
        timeCreated: c.time_created,
        activeMembers: active,
        pendingMembers: pending,
        last_time_modified: c.last_time_modified,
        unread_count: unread,
        read: unread === 0
      };
    }));

    res.setHeader('Cache-Control', 'no-cache');
    res.json({
      page, limit,
      totalCount: total,
      conversations: formatted,
      hasMore: skip + formatted.length < total
    });
  } catch (err) {
    console.error('getConversationsByUser', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function approveMessage(req, res) {
  const { username, notifier } = req.params;
  const { type, target } = req.body;

  if (req.user.username !== username) return res.status(403).json({ message: 'Forbidden' });
  if (type !== 'messageApproval') return res.status(400).json({ message: 'Invalid type' });

  try {
    const [me, requester] = await Promise.all([
      User.findOne({ username }, 'id username profile.avatarURL').lean(),
      User.findOne({ username: notifier }, 'id username').lean()
    ]);
    if (!me || !requester) return res.status(404).json({ message: 'User not found' });

    /* activate membership */
    const updated = await ConversationMember.updateMany(
      { conversation_id: target, member: me.id, inviter: requester.id, queue: true },
      { $set: { queue: false, joined_on: new Date() } }
    );
    if (updated.modifiedCount === 0) return res.status(404).json({ message: 'Request not found' });

    /* socket notify requester if online */
    const sockets = await activeSockets(requester.username);
    if (sockets.length) sockets.forEach(id => {
      io.to(id).emit('notification', {
        type: 'messageApproval',
        user: requester.username,
        notifier: me.username,
        conversation_id: target
      });
    });

    return res.status(201).json({ success: true });
  } catch (err) {
    console.error('approveMessage', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function denyMessage(req, res) {
  const { username, notifier } = req.params;
  const { type, target } = req.body;

  if (req.user.username !== username) return res.status(403).json({ message: 'Forbidden' });
  if (type !== 'messageApproval') return res.status(400).json({ message: 'Invalid type' });

  try {
    const [me, requester] = await Promise.all([
      User.findOne({ username }, 'id').lean(),
      User.findOne({ username: notifier }, 'id').lean()
    ]);
    if (!me || !requester) return res.status(404).json({ message: 'User not found' });

    const removed = await ConversationMember.deleteMany(
      { conversation_id: target, member: me.id, inviter: requester.id, queue: true }
    );

    if (!removed.deletedCount) return res.status(404).json({ message: 'Request not found' });

    /* if DM only 2 members => delete conversation entirely */
    const conv = await Conversation.findOne({ id: target }).lean();
    if (conv && conv.dm) {
      await Promise.all([
        Conversation.deleteOne({ id: target }),
        ChatMessage.deleteMany({ conversation_id: target }),
        ConversationMember.deleteMany({ conversation_id: target })
      ]);
    }

    res.status(204).send();
  } catch (err) {
    console.error('denyMessage', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function editConversation(req, res) {
  const { username, conversationId } = req.params;
  const edits = JSON.parse(req.body.data ?? '{}');

  if (req.user.username !== username) return res.status(403).json({ message: 'Forbidden' });

  try {
    const me = await User.findOne({ username }, 'id username').lean();
    const conv = await Conversation.findOne({ id: conversationId }).lean();
    if (!me || !conv) return res.status(404).json({ message: 'Conversation not found' });

    const isCreator = conv.creator === me.id;
    const isCollaborator = conv.collaborators.includes(me.id);
    if (!isCreator && !isCollaborator) return res.status(403).json({ message: 'No permission' });

    /* handle optional media upload folder (multer puts path in req.tempDir) */
    if (req.tempDir) {
      const prefix = `${username}_${Date.now()}`;
      await uploadToR2(req.tempDir, prefix);
      const base = `${cfg.cdnBase}/${prefix}`;

      /* replace cover / background URLs */
      const subDirs = await fs.readdir(req.tempDir);
      if (subDirs.includes('cover')) {
        const obj = {};
        for (const f of await fs.readdir(path.join(req.tempDir, 'cover'))) if (f.endsWith('.webp')) {
          const res = f.match(/_(\d+p)\.webp$/)?.[1] ?? 'original';
          obj[res] = `${base}/cover/${f}`;
        }
        edits.cover = obj;
      }
      const mediaDir = subDirs.find(d => d.startsWith('media'));
      if (mediaDir) {
        const files = await fs.readdir(path.join(req.tempDir, mediaDir));
        const obj = {};
        for (const f of files) if (f.endsWith('.webp')) {
          const res = f.match(/_(\d+p)\.webp$/)?.[1] ?? 'original';
          obj[res] = `${base}/${mediaDir}/${f}`;
        }
        edits.background = obj;
      }
      await fs.rm(req.tempDir, { recursive: true, force: true });
    }

    edits.last_time_modified = new Date();
    await Conversation.updateOne({ id: conversationId }, { $set: edits });

    /* notify online collaborators */
    const sockets = await activeSockets(username);
    sockets.forEach(id => {
      io.to(id).emit('chatEdit', {
        status: 'success',
        message: 'Conversation updated'
      });
    });

    res.status(201).json({ success: true });
  } catch (err) {
    console.error('editConversation', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function addConversMember(req, res) {
  const { username, conversationId, member } = req.params;

  if (req.user.username !== username) return res.status(403).json({ message: 'Forbidden' });

  try {
    const [me, newUser, conv] = await Promise.all([
      User.findOne({ username }, 'id username').lean(),
      User.findOne({ username: member }, 'id username blocked').lean(),
      Conversation.findOne({ id: conversationId }).lean()
    ]);
    if (!me || !newUser || !conv) return res.status(404).json({ message: 'User or conversation not found' });

    const isCreator = conv.creator === me.id;
    const isCollaborator = conv.collaborators.includes(me.id);
    if (!isCreator && !isCollaborator) return res.status(403).json({ message: 'No permission' });

    /* already member? */
    const exists = await ConversationMember.exists({
      conversation_id: conversationId, member: newUser.id
    });
    if (exists) return res.status(400).json({ message: 'Already a member' });

    /* append member (active) */
    await ConversationMember.create({
      conversation_id: conversationId,
      member: newUser.id,
      inviter: me.id,
      queue: false,
      invited_on: new Date(),
      joined_on: new Date()
    });

    /* update conversation hash & count */
    const allMembers = await ConversationMember.find(
      { conversation_id: conversationId, queue: false }, 'member'
    ).lean();
    const ids = allMembers.map(m => m.member).sort();
    await Conversation.updateOne(
      { id: conversationId },
      {
        $set: {
          members_hash: generateHash(ids),
          members_count: ids.length
        }
      });

    res.status(201).json({ success: true });
  } catch (err) {
    console.error('addConversMember', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function removeConversMember(req, res) {
  const { username, conversationId, member } = req.params;

  if (req.user.username !== username) return res.status(403).json({ message: 'Forbidden' });

  try {
    const [me, target, conv] = await Promise.all([
      User.findOne({ username }, 'id').lean(),
      User.findOne({ username: member }, 'id').lean(),
      Conversation.findOne({ id: conversationId }).lean()
    ]);
    if (!me || !target || !conv) return res.status(404).json({ message: 'Not found' });

    if (conv.dm) return res.status(400).json({ message: 'Cannot remove from DM' });

    const isCreator = conv.creator === me.id;
    const isCollaborator = conv.collaborators.includes(me.id);
    const targetIsCollab = conv.collaborators.includes(target.id);

    if (!isCreator && (!isCollaborator || targetIsCollab)) return res.status(403).json({ message: 'No permission' });

    /* delete member */
    await ConversationMember.deleteOne({
      conversation_id: conversationId,
      member: target.id
    });

    const remain = await ConversationMember.find(
      { conversation_id: conversationId }, 'member'
    ).lean();
    const ids = remain.map(m => m.member).sort();

    await Conversation.updateOne(
      { id: conversationId },
      {
        $set: {
          members_hash: generateHash(ids),
          members_count: ids.length,
          collaborators: conv.collaborators.filter(id => id !== target.id)
        }
      });

    res.status(204).send();
  } catch (err) {
    console.error('removeConversMember', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function addConversAdmin(req, res) {
  const { username, conversationId, member } = req.params;

  if (req.user.username !== username) return res.status(403).json({ message: 'Forbidden' });

  try {
    const [me, target, conv] = await Promise.all([
      User.findOne({ username }, 'id').lean(),
      User.findOne({ username: member }, 'id').lean(),
      Conversation.findOne({ id: conversationId }).lean()
    ]);
    if (!me || !target || !conv) return res.status(404).json({ message: 'Not found' });

    if (conv.creator !== me.id) return res.status(403).json({ message: 'Only creator can add admin' });

    if (!conv.collaborators.includes(target.id)) await Conversation.updateOne(
      { id: conversationId },
      { $addToSet: { collaborators: target.id } }
    );

    res.status(201).json({ success: true });
  } catch (err) {
    console.error('addConversAdmin', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function removeConversAdmin(req, res) {
  const { username, conversationId, member } = req.params;

  if (req.user.username !== username) return res.status(403).json({ message: 'Forbidden' });

  try {
    const me = await User.findOne({ username }, 'id').lean();
    const conv = await Conversation.findOne({ id: conversationId }).lean();
    const admin = await User.findOne({ username: member }, 'id').lean();

    if (!me || !conv || !admin) return res.status(404).json({ message: 'Not found' });

    if (conv.creator !== me.id) return res.status(403).json({ message: 'Only creator can remove admin' });
    if (admin.id === conv.creator) return res.status(400).json({ message: 'Creator is always admin' });

    await Conversation.updateOne(
      { id: conversationId },
      { $pull: { collaborators: admin.id } }
    );

    res.status(204).send();
  } catch (err) {
    console.error('removeConversAdmin', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function readConversation(req, res) {
  const { username, conversationId, messageId } = req.params;

  if (req.user.username !== username) return res.status(403).json({ message: 'Forbidden' });

  try {
    await ChatView.updateOne(
      { user: req.user.id, conversation_id: conversationId },
      {
        $set: {
          last_message_read: messageId,
          last_time_read: new Date(),
          read: true
        },
        $setOnInsert: { time_posted: new Date() }
      },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('readConversation', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function markChatStatus(req, res) {
  const { username, conversationId } = req.params;
  const { reading } = req.body;

  if (req.user.username !== username) return res.status(403).json({ message: 'Forbidden' });
  if (typeof reading !== 'boolean') return res.status(400).json({ message: 'reading must be boolean' });

  try {
    await ChatView.updateOne(
      { user: req.user.id, conversation_id: conversationId },
      { $set: { read: reading } },
      { upsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('markChatStatus', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function leaveConversation(req, res) {
  const { username, conversationId } = req.params;

  if (req.user.username !== username) return res.status(403).json({ message: 'Forbidden' });

  try {
    const me = await User.findOne({ username }, 'id').lean();
    const conv = await Conversation.findOne({ id: conversationId }).lean();
    if (!me || !conv) return res.status(404).json({ message: 'Not found' });

    await ConversationMember.deleteOne({
      conversation_id: conversationId,
      member: me.id
    });

    const remain = await ConversationMember.countDocuments({
      conversation_id: conversationId
    });

    if (remain === 0) {
      /* delete empty conversation */
      await Promise.all([
        Conversation.deleteOne({ id: conversationId }),
        ChatMessage.deleteMany({ conversation_id: conversationId })
      ]);
    } else {
      /* update members hash/count */
      const ids = (await ConversationMember.find(
        { conversation_id: conversationId }, 'member'
      )).map(m => m.member).sort();
      await Conversation.updateOne(
        { id: conversationId },
        {
          $set: {
            collaborators: conv.collaborators.filter(id => id !== me.id),
            members_hash: generateHash(ids),
            members_count: ids.length
          }
        }
      );
    }
    res.status(204).send();
  } catch (err) {
    console.error('leaveConversation', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function getMessagesByConversation(req, res) {
  const { conversationId } = req.params;
  const page = +(req.query.page ?? 1);
  const limit = +(req.query.limit ?? 12);
  const skip = (page - 1) * limit;

  if (!req.user) return res.status(403).json({ message: 'Forbidden' });

  try {
    const conv = await Conversation.findOne({ id: conversationId }).lean();
    if (!conv) return res.status(404).json({ message: 'Conversation not found' });

    const member = await ConversationMember.findOne({
      conversation_id: conversationId,
      member: req.user.id,
      queue: false
    }).lean();
    if (!member) return res.status(403).json({ message: 'Not a member' });

    const query = {
      conversation_id: conversationId,
      time_posted: { $gte: member.joined_on }
    };
    const total = await ChatMessage.countDocuments(query);
    const msgs = await ChatMessage.find(query)
      .sort({ time_posted: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const ids = [...new Set(msgs.map(m => m.user))];
    const um = await userMapByIds(ids);

    const formatted = msgs.map(m => ({
      ...m,
      user: {
        username: um.get(m.user)?.username ?? 'system',
        avatar: um.get(m.user)?.avatar ?? ''
      },
      reactions: (m.reactions ?? []).map(r => ({
        reaction: r.reaction,
        users: r.users.map(id => um.get(id)?.username).filter(Boolean)
      }))
    }));

    res.setHeader('Cache-Control', 'no-cache');
    res.json({
      page, limit,
      messages: formatted,
      hasMore: skip + msgs.length < total
    });
  } catch (err) {
    console.error('getMessagesByConversation', err);
    res.status(500).json({ message: 'Server error' });
  }
}

const STICKER_HOSTS = ['giphy.com', 'media.giphy.com'];
async function validateSticker({ url, type }) {
  const host = new URL(url).hostname;
  if (!STICKER_HOSTS.some(d => host.endsWith(d))) return { ok: false, msg: 'domain not allowed' };
  if (type !== 'gif') return { ok: false, msg: 'only GIF stickers' };

  const res = await fetch(url, { method: 'HEAD', timeout: 4000 });
  if (!res.ok) return { ok: false, msg: `HTTP ${res.status}` };
  if (!res.headers.get('content-type')?.startsWith('image/gif')) return { ok: false, msg: 'not a GIF' };
  const size = +res.headers.get('content-length') || 0;
  if (size > 5 * 1024 * 1024) return { ok: false, msg: 'file too large' };
  return { ok: true };
}

export async function createNewMessage(req, res) {
  const { username } = req.params;
  const {
    conversationId, content = '', type = 'text',
    attachment = null, mentions = [], replyTarget = null
  } = req.body;

  if (req.user.username !== username) return res.status(403).json({ message: 'Forbidden' });

  if (type === 'text' && !content.trim()) return res.status(400).json({ message: 'Empty message' });
  if (type === 'sticker' && (!attachment || !attachment.url)) return res.status(400).json({ message: 'Sticker missing' });
  if (type === 'sticker') {
    const v = await validateSticker(attachment);
    if (!v.ok) return res.status(400).json({ message: `Sticker invalid – ${v.msg}` });
  }

  try {
    const me = await User.findOne({ username }, 'id username profile.avatarURL').lean();
    const conv = await Conversation.findOne({ id: conversationId }).lean();
    const isMember = await ConversationMember.exists({
      conversation_id: conversationId, member: me.id, queue: false
    });
    if (!me || !conv || !isMember) return res.status(404).json({ message: 'Conversation not found' });

    const msgObj = {
      id: nanoid(14),
      content,
      user: me.id,
      conversation_id: conversationId,
      type,
      attachment,
      mentions,
      reply_to: replyTarget,
      time_posted: new Date(),
      time_modified: new Date()
    };
    await ChatMessage.create(msgObj);

    await Conversation.updateOne(
      { id: conversationId },
      {
        $set: {
          last_message: content || (type === 'sticker' ? '[sticker]' : '[attachment]'),
          last_message_user: me.id,
          last_message_id: msgObj.id,
          last_message_update: msgObj.time_posted
        }
      });

    const mems = await ConversationMember.find(
      { conversation_id: conversationId, queue: false }, 'member'
    ).lean();
    const usernames = await User.find(
      { id: { $in: mems.map(m => m.member) } }, 'username'
    ).lean().then(a => a.map(u => u.username));

    await fanoutToSockets(usernames, 'shareChatMessage', {
      ...msgObj,
      user: { username: me.username, avatar: me.profile.avatarURL['360p'] }
    });

    res.status(201).json({ success: true, id: msgObj.id });
  } catch (err) {
    console.error('createNewMessage', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function sendMediaMessage(pending) {
  const me = await User.findOne({ id: pending.user }, 'username').lean();
  if (!me) throw new Error('User not found');

  /* build attachment url map from pending.tempDir files (already R2) */
  const fileURL = pending.expectedFiles.reduce((map, f) => {
    const res = f.filename.match(/_(\d+p)\./)?.[1] ?? 'original';
    const url = `${cfg.cdnBase}/${pending.r2prefix}/${f.field}/${f.filename}`;
    if (f.field.startsWith('media') && Array.isArray(map[res])) map[res].push(url);
    else if (f.field.startsWith('media')) map[res] = [url];
    else map[res] = url;
    return map;
  }, {});

  await createNewMessageInternal({
    username: me.username,
    conversationId: pending.asset,
    type: 'media',
    attachment: { type: 'image', url: fileURL, sensitivity: 'neutral' },
    content: '',
    mentions: [],
    replyTarget: null
  });
}

export async function reactToMessage(req, res) {
  const { username } = req.params;
  const { emoji, messageId } = req.body;

  if (req.user.username !== username) return res.status(403).json({ message: 'Forbidden' });
  if (!isValidEmoji(emoji)) return res.status(400).json({ message: 'Invalid emoji' });

  try {
    const me = await User.findOne({ username }, 'id').lean();
    const msg = await ChatMessage.findOne({ id: messageId }).lean();
    if (!me || !msg) return res.status(404).json({ message: 'Message not found' });

    const already = msg.reactions?.find(r => r.reaction === emoji && r.users.includes(me.id));
    if (already) {
      /* remove */
      await ChatMessage.updateOne(
        { id: messageId },
        { $pull: { "reactions.$[r].users": me.id } },
        { arrayFilters: [{ "r.reaction": emoji }] }
      );
      await ChatMessage.updateOne(
        { id: messageId },
        { $pull: { reactions: { reaction: emoji, users: { $size: 0 } } } }
      );
    } else {
      /* add */
      const exists = msg.reactions?.some(r => r.reaction === emoji);
      if (exists) await ChatMessage.updateOne(
        { "id": messageId, "reactions.reaction": emoji },
        {
          $addToSet: { "reactions.$.users": me.id },
          $set: { last_reaction_time: new Date() }
        }
      );
      else await ChatMessage.updateOne(
        { id: messageId },
        {
          $push: { reactions: { reaction: emoji, users: [me.id] } },
          $set: { last_reaction_time: new Date() }
        }
      );
    }

    /* notify sockets in conversation */
    const convMembers = await ConversationMember.find(
      { conversation_id: msg.conversation_id, queue: false }, 'member'
    ).lean();
    const names = await User.find(
      { id: { $in: convMembers.map(m => m.member) } }, 'username'
    ).lean().then(arr => arr.map(u => u.username));

    await fanoutToSockets(names, 'shareChatReaction', {
      message_id: messageId,
      conversation_id: msg.conversation_id,
      user: username,
      reaction: emoji,
      removed: !!already,
      time_posted: new Date()
    });

    res.json({ success: true, removed: !!already });
  } catch (err) {
    console.error('reactToMessage', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function deleteMessage(req, res) {
  const { username, messageId } = req.params;

  if (req.user.username !== username) return res.status(403).json({ message: 'Forbidden' });

  try {
    const msg = await ChatMessage.findOne({ id: messageId }).lean();
    if (!msg) return res.status(404).json({ message: 'Message not found' });
    if (msg.user !== req.user.id) return res.status(403).json({ message: 'Not owner' });

    await ChatMessage.deleteOne({ id: messageId });

    /* system replacement */
    const sysMsg = {
      id: nanoid(14),
      content: `@${username} deleted a message`,
      user: 'system',
      type: 'text',
      conversation_id: msg.conversation_id,
      attachment: { type: 'remover', message_id: messageId },
      time_posted: msg.time_posted,
      time_modified: new Date()
    };
    await ChatMessage.create(sysMsg);

    /* sockets */
    const members = await ConversationMember.find(
      { conversation_id: msg.conversation_id, queue: false }
    ).lean();
    const names = await User.find(
      { id: { $in: members.map(m => m.member) } }, 'username'
    ).lean().then(a => a.map(u => u.username));

    await fanoutToSockets(names, 'shareChatMessage', sysMsg);
    res.status(204).send();
  } catch (err) {
    console.error('deleteMessage', err);
    res.status(500).json({ message: 'Server error' });
  }
}

function buildRegexArray(kw) {
  return kw.toLowerCase().trim().split(/\s+/)
    .map(k => new RegExp(k, 'i'));
}

export async function searchConversation(req, res) {
  const { username, conversationId } = req.params;
  const { keywords } = req.query;

  if (req.user.username !== username) return res.status(403).json({ message: 'Forbidden' });

  try {
    const mem = await ConversationMember.findOne({
      conversation_id: conversationId,
      member: req.user.id,
      queue: false
    }).lean();
    if (!mem) return res.status(403).json({ message: 'Not a member' });

    const regexArr = buildRegexArray(keywords);
    const msgs = await ChatMessage.find({
      conversation_id: conversationId,
      user: { $ne: 'system' },
      time_posted: { $gte: mem.joined_on },
      $and: regexArr.map(r => ({ content: { $regex: r } }))
    }).sort({ time_posted: -1 }).limit(50).lean();

    const um = await userMapByIds([...new Set(msgs.map(m => m.user))]);
    res.setHeader('Cache-Control', 'no-cache');
    res.json({
      messages: msgs.map(m => ({
        ...m,
        user: {
          username: um.get(m.user)?.username,
          avatar: um.get(m.user)?.avatar
        }
      }))
    });
  } catch (err) {
    console.error('searchConversation', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export async function searchAllConversations(req, res) {
  const { username } = req.params;
  const { keywords } = req.query;

  if (req.user.username !== username) return res.status(403).json({ message: 'Forbidden' });

  try {
    const me = await User.findOne({ username }, 'id').lean();
    if (!me) return res.status(404).json({ message: 'User not found' });

    const convs = await ConversationMember.find(
      { member: me.id, queue: false }, 'conversation_id joined_on'
    ).lean();
    const convIds = convs.map(c => c.conversation_id);
    const joinedOn = Object.fromEntries(convs.map(c => [c.conversation_id, c.joined_on]));

    const regexArr = buildRegexArray(keywords);
    const msgs = await ChatMessage.find({
      conversation_id: { $in: convIds },
      user: { $ne: 'system' },
      $and: regexArr.map(r => ({ content: { $regex: r } }))
    }).sort({ time_posted: -1 }).lean();

    const filtered = msgs.filter(m => m.time_posted >= joinedOn[m.conversation_id]);
    const um = await userMapByIds([...new Set(filtered.map(m => m.user))]);

    res.setHeader('Cache-Control', 'no-cache');
    res.json({
      messages: filtered.map(m => ({
        ...m,
        user: {
          username: um.get(m.user)?.username,
          avatar: um.get(m.user)?.avatar
        }
      }))
    });
  } catch (err) {
    console.error('searchAllConversations', err);
    res.status(500).json({ message: 'Server error' });
  }
}

export default {
  startConversation,
  editConversation,
  getConversation,
  getDirectMessage,
  getConversationsByUser,
  approveMessage,
  denyMessage,
  addConversMember,
  removeConversMember,
  addConversAdmin,
  removeConversAdmin,
  readConversation,
  markChatStatus,
  leaveConversation,
  getMessagesByConversation,
  createNewMessage,
  sendMediaMessage,
  reactToMessage,
  deleteMessage,
  searchConversation,
  searchAllConversations
};