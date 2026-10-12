// BLACKBOX — Incident routes
const express    = require('express')
const router     = express.Router()
const controller = require('../controllers/incidentController')

router.get('/',           controller.listIncidents)
router.get('/:id',        controller.getIncident)
router.post('/',          controller.createIncident)
router.put('/:id',        controller.updateIncident)
router.delete('/:id',     controller.deleteIncident)

// Conflict resolution — accepts the LWW-winning record after a 409.
// The server assigns the next authoritative version; no normal version
// check is applied (the client already resolved the conflict locally).
router.post('/:id/resolve', controller.resolveIncident)

module.exports = router
