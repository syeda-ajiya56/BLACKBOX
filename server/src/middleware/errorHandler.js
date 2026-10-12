// BLACKBOX — Global error handler middleware
// Must be registered LAST with app.use() in index.js.
// Catches any error thrown or passed via next(err) in route handlers.

module.exports = function errorHandler(err, req, res, next) {
  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const details = Object.values(err.errors).map(e => e.message)
    return res.status(400).json({
      success: false,
      error:   'Validation failed',
      details,
    })
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    return res.status(409).json({
      success: false,
      error:   'Duplicate record — an incident with this id already exists',
    })
  }

  // Default: internal server error
  console.error('[API] Unhandled error:', err.message)
  res.status(500).json({
    success: false,
    error:   'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  })
}
