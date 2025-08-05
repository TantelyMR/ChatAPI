import mongoose from 'mongoose';
const { Schema, model } = mongoose;

/* reactions */
const reactionSchema = new Schema(
  {
    reaction: { type: String, required: true },
    users: { type: [String], default: [] }
  },
  { _id: false, id: false }
);

/* attachment */
const attachmentSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['image', 'video', 'gif', 'sticker'], required: true
    },
    url: { type: Schema.Types.Mixed, required: true },  // string | array | obj
    sensitivity: {
      type: String,
      enum: ['neutral', 'sensitive', 'unsafe'], default: 'neutral'
    }
  },
  { _id: false, id: false }
);

const chatMessageSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    content: { type: String, default: '' },
    user: { type: String, required: true },              // sender id
    conversation_id: { type: String, required: true, index: true },
    type: {
      type: String,
      enum: ['text', 'media', 'sticker', 'gif'],
      default: 'text'
    },
    attachment: { type: attachmentSchema },
    reactions: { type: [reactionSchema], default: [] },
    mentions: { type: [String], default: [] },
    reply_to: { type: Schema.Types.Mixed, default: null },

    last_reaction_time: { type: Date },

    time_posted: { type: Date, default: Date.now },
    time_modified: { type: Date, default: Date.now },

    reports_count: { type: Number, default: 0 }
  },
  { versionKey: false }
);

export const ChatMessage = model('ChatMessage', chatMessageSchema);
