import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const chatViewSchema = new Schema(
  {
    user: { type: String, required: true },
    conversation_id: { type: String, required: true },
    last_message_read: { type: String, default: '' },
    last_time_read: { type: Date },
    read: { type: Boolean, default: true },
    time_posted: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

chatViewSchema.index({ user: 1, conversation_id: 1 }, { unique: true });

export const ChatView = model('ChatView', chatViewSchema);
