import mongoose from 'mongoose';
const { Schema, model } = mongoose;

/* avatar resolutions sub-schema */
const avatarResSchema = new Schema(
  {
    '180p': { type: String, default: '' },
    '360p': { type: String, default: '' },
    '720p': { type: String, default: '' }
  },
  { _id: false, id: false }
);

/* profile sub-schema */
const profileSchema = new Schema(
  {
    avatarURL: { type: avatarResSchema, default: () => ({}) }
  },
  { _id: false, id: false }
);

/* main schema */
const userSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    username: { type: String, required: true, unique: true },
    passwordHash: { type: String, required: true },
    blocked: { type: [String], default: [] },
    mentions: {
      type: String,
      enum: ['everyone', 'approval', 'nobody'],
      default: 'everyone'
    },
    profile: { type: profileSchema, default: () => ({}) },
    time_created: { type: Date, default: Date.now }
  },
  { versionKey: false }
);

export const User = model('User', userSchema);
