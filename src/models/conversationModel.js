import mongoose from 'mongoose';
const { Schema, model } = mongoose;

const conversationSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    name: { type: String, default: '' },
    description: { type: String, default: '' },
    creator: { type: String, required: true },            // user id
    collaborators: { type: [String], default: [] },             // admin ids
    members_hash: { type: String, required: true, index: true },
    members_count: { type: Number, default: 2 },
    dm: { type: Boolean, default: false },

    last_message: { type: String, default: '' },
    last_message_user: { type: String, default: '' },
    last_message_id: { type: String, default: '' },
    last_message_update: { type: Date },

    time_created: { type: Date, default: Date.now },
    last_time_modified: { type: Date, default: Date.now },

    background: { type: Schema.Types.Mixed, default: () => ({}) },
    cover: { type: Schema.Types.Mixed, default: () => ({}) },

    reports_count: { type: Number, default: 0 }
  },
  { versionKey: false }
);

export const Conversation = model('Conversation', conversationSchema);
