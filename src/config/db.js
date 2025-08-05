import mongoose from 'mongoose';
import { cfg }  from './env.js';

export async function connectDB () {
  await mongoose.connect(cfg.mongoUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5_000
  });
  console.log('🗄️  Mongo connected');
}
