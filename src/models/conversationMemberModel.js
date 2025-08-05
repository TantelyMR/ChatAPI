import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const conversationMemberSchema = new Schema(
  {
    conversation_id: { type: String, required: true, index: true },
    member: { type: String, required: true },
    inviter: { type: String, required: true },
    queue: { type: Boolean, default: false },
    invited_on: { type: Date, default: Date.now },
    joined_on: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

conversationMemberSchema.index(
  { conversation_id: 1, member: 1 },
  { unique: true }
);

export const ConversationMember = model('ConversationMember', conversationMemberSchema);
