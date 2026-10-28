import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { availabilityService } from './availability.service.js';
import { authMiddleware, requireRoles } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';

const createSlotsSchema = z.object({
  body: z.object({
    slots: z.array(
      z.object({
        startTime: z.string().datetime(),
        endTime: z.string().datetime(),
      })
    ).min(1, 'Must provide at least one slot'),
  }),
});

const updateSlotSchema = z.object({
  params: z.object({
    slotId: z.string().uuid(),
  }),
  body: z.object({
    status: z.enum(['AVAILABLE', 'BLOCKED', 'CANCELLED']),
  }),
});

const router = Router();

// Public: view a doctor's availability
router.get('/doctors/:doctorId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slots = await availabilityService.getDoctorAvailability(
      req.params.doctorId as string,
      req.query.from as string | undefined,
      req.query.to as string | undefined
    );
    res.status(200).json({ success: true, data: slots });
  } catch (err) {
    next(err);
  }
});

// Doctor only: manage own slots
router.post(
  '/me',
  authMiddleware,
  requireRoles('DOCTOR'),
  validate(createSlotsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await availabilityService.createSlots(req.user!.userId, req.body.slots);
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/me/:slotId',
  authMiddleware,
  requireRoles('DOCTOR'),
  validate(updateSlotSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await availabilityService.updateSlotStatus(
        req.user!.userId,
        req.params.slotId as string,
        req.body.status
      );
      res.status(200).json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

export const availabilityRoutes = router;
