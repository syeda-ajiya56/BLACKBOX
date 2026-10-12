// BLACKBOX — MongoDB connection
const mongoose = require('mongoose')

async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/blackbox'
  try {
    await mongoose.connect(uri)
    console.log('[BLACKBOX] MongoDB connected:', uri)
  } catch (err) {
    console.error('[BLACKBOX] MongoDB connection error:', err.message)
    process.exit(1)
  }
}

module.exports = { connectDB }
