// BLACKBOX — Express server entry point

require('dotenv').config()
const express      = require('express')
const cors         = require('cors')
const { connectDB } = require('./config/db')
const errorHandler  = require('./middleware/errorHandler')

const app  = express()
const PORT = process.env.PORT || 5000

// ── CORS ─────────────────────────────────────────────────────
// Allow the Vite dev client and the production preview server.
// Add additional origins here if deploying to a real host.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean)

const DEFAULT_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]

const allowedOrigins = [...new Set([...DEFAULT_ORIGINS, ...ALLOWED_ORIGINS])]

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Postman, same-origin)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`))
    }
  },
  methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: false,
}))

// ── Body parsing ──────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }))

// ── Request logger (development) ─────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log(`[API] ${req.method} ${req.path}`)
    next()
  })
}

// ── Health check ─────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    ok:        true,
    service:   'blackbox-api',
    version:   '0.4.0',
    timestamp: new Date().toISOString(),
  })
})

// ── Incident routes ───────────────────────────────────────────
app.use('/api/incidents', require('./routes/incidents'))

// ── 404 catch-all (API only) ─────────────────────────────────
app.use('/api/*', (_req, res) => {
  res.status(404).json({ success: false, error: 'API endpoint not found' })
})

// ── Global error handler ─────────────────────────────────────
// Must be registered after all routes.
app.use(errorHandler)

// ── Start ────────────────────────────────────────────────────
async function start() {
  await connectDB()
  app.listen(PORT, () => {
    console.log(`[BLACKBOX] Server running on http://localhost:${PORT}`)
    console.log(`[BLACKBOX] Health: http://localhost:${PORT}/api/health`)
  })
}

start().catch((err) => {
  console.error('[BLACKBOX] Failed to start server:', err.message)
  process.exit(1)
})
