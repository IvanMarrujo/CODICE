import { Router } from 'express'
const router = Router()
router.get('/', (req, res) => res.json({ route: 'admin', status: 'stub — implementar' }))
export default router
