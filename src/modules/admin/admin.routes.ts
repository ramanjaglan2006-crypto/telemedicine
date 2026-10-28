import { Router, type Request, type Response, type NextFunction } from 'express';
import { adminService } from './admin.service.js';
import { authMiddleware, requireRoles } from '../../common/middleware/auth.js';

const router = Router();
router.use(authMiddleware);
router.use(requireRoles('ADMIN'));

router.get('/analytics/overview', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const analytics = await adminService.getOverviewAnalytics();
    res.status(200).json({ success: true, data: analytics });
  } catch (err) {
    next(err);
  }
});

router.get('/audit-logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const action = req.query.action as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const logs = await adminService.getAuditLogs({ action, limit });
    res.status(200).json({ success: true, data: logs });
  } catch (err) {
    next(err);
  }
});

export const adminRoutes = router;
