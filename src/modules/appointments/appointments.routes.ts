import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { appointmentsService } from './appointments.service.js';
import { authMiddleware, requireRoles } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';
import { idempotencyMiddleware } from '../../common/idempotency/idempotency.manager.js';

const bookAppointmentSchema = z.object({
  body: z.object({
    doctorId: z.string().uuid(),
    slotId: z.string().uuid(),
    consultationType: z.enum(['VIDEO', 'AUDIO', 'CHAT']).optional(),
  }),
});

const rescheduleAppointmentSchema = z.object({
  params: z.object({
    appointmentId: z.string().uuid(),
  }),
  body: z.object({
    newSlotId: z.string().uuid(),
  }),
});

const cancelAppointmentSchema = z.object({
  params: z.object({
    appointmentId: z.string().uuid(),
  }),
  body: z.object({
    reason: z.string().max(255).optional(),
  }),
});

const router = Router();
router.use(authMiddleware);

// Book appointment - Protected by Idempotency Key
router.post(
  '/',
  requireRoles('PATIENT'),
  idempotencyMiddleware({ required: false }),
  validate(bookAppointmentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await appointmentsService.bookAppointment({
        patientId: req.user!.userId,
        doctorId: req.body.doctorId,
        slotId: req.body.slotId,
        consultationType: req.body.consultationType,
      });
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// List appointments for authenticated user (patient, doctor, admin)
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const list = await appointmentsService.listAppointments(req.user!.userId, req.user!.role);
    res.status(200).json({ success: true, data: list });
  } catch (err) {
    next(err);
  }
});

// Get appointment details (Anti-IDOR protected)
router.get('/:appointmentId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const appointment = await appointmentsService.getAppointmentById(
      req.user!.userId,
      req.user!.role,
      req.params.appointmentId as string
    );
    res.status(200).json({ success: true, data: appointment });
  } catch (err) {
    next(err);
  }
});

// Cancel appointment
router.post(
  '/:appointmentId/cancel',
  validate(cancelAppointmentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await appointmentsService.cancelAppointment(
        req.user!.userId,
        req.user!.role,
        req.params.appointmentId as string,
        req.body.reason
      );
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

// Reschedule appointment
router.post(
  '/:appointmentId/reschedule',
  validate(rescheduleAppointmentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await appointmentsService.rescheduleAppointment(
        req.user!.userId,
        req.user!.role,
        req.params.appointmentId as string,
        req.body.newSlotId
      );
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

export const appointmentsRoutes = router;
