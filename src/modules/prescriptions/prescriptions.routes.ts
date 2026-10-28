import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { prescriptionsService } from './prescriptions.service.js';
import { authMiddleware, requireRoles } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';
import { idempotencyMiddleware } from '../../common/idempotency/idempotency.manager.js';

const issuePrescriptionSchema = z.object({
  params: z.object({
    consultationId: z.string().uuid(),
  }),
  body: z.object({
    diagnosis: z.string().min(2).max(1000),
    medications: z.array(
      z.object({
        name: z.string().min(1),
        dosage: z.string().min(1),
        frequency: z.string().min(1),
        durationDays: z.number().int().positive(),
        instructions: z.string().optional(),
      })
    ).min(1, 'At least one medication is required'),
    instructions: z.string().max(2000).optional(),
  }),
});

const router = Router();
router.use(authMiddleware);

// Issue prescription for a consultation (Doctor only, idempotent)
router.post(
  '/consultations/:consultationId/prescriptions',
  requireRoles('DOCTOR'),
  idempotencyMiddleware({ required: false }),
  validate(issuePrescriptionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await prescriptionsService.issuePrescription(req.user!.userId, {
        consultationId: req.params.consultationId as string,
        diagnosis: req.body.diagnosis,
        medications: req.body.medications,
        instructions: req.body.instructions,
      });
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// List prescriptions for a consultation
router.get(
  '/consultations/:consultationId/prescriptions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const list = await prescriptionsService.listPrescriptionsForConsultation(
        req.user!.userId,
        req.user!.role,
        req.params.consultationId as string
      );
      res.status(200).json({ success: true, data: list });
    } catch (err) {
      next(err);
    }
  }
);

// Get single prescription by ID
router.get('/:prescriptionId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const prescription = await prescriptionsService.getPrescriptionById(
      req.user!.userId,
      req.user!.role,
      req.params.prescriptionId as string
    );
    res.status(200).json({ success: true, data: prescription });
  } catch (err) {
    next(err);
  }
});

export const prescriptionsRoutes = router;
