// BLACKBOX — conflictResolver unit test runner (Node.js ES module)
// Run: node src/sync/conflictResolver.test.mjs
import { resolveConflict, runConflictResolverTests } from './conflictResolver.js'

console.log('Running conflictResolver unit tests...\n')
const { passed, failed } = runConflictResolverTests()
process.exit(failed > 0 ? 1 : 0)
