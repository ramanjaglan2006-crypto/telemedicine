import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { consultationsService } from './consultations.service.js';
import { authMiddleware, requireRoles } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';

const completeConsultationSchema = z.object({
  body: z.object({
    clinicalNotes: z.string().max(5000).optional(),
  }),
});

const router = Router();
router.use(authMiddleware);

router.get('/:consultationId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const consultation = await consultationsService.getConsultationById(
      req.user!.userId,
      req.user!.role,
      req.params.consultationId as string
    );
    res.status(200).json({ success: true, data: consultation });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:consultationId/start',
  requireRoles('DOCTOR'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await consultationsService.startConsultation(
        req.user!.userId,
        req.params.consultationId as string
      );
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:consultationId/complete',
  requireRoles('DOCTOR'),
  validate(completeConsultationSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await consultationsService.completeConsultation(
        req.user!.userId,
        req.params.consultationId as string,
        req.body.clinicalNotes
      );
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

export const consultationsRoutes = router;
