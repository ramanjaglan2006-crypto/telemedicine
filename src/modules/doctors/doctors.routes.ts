import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { doctorsService } from './doctors.service.js';
import { authMiddleware, requireRoles } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';

const updateDoctorSchema = z.object({
  body: z.object({
    specialization: z.string().min(2).optional(),
    yearsOfExperience: z.number().int().min(0).optional(),
    bio: z.string().optional(),
    consultationFee: z.number().positive().optional(),
  }),
});

const router = Router();

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const specialization = req.query.specialization as string | undefined;
    const minExperience = req.query.minExperience ? parseInt(req.query.minExperience as string, 10) : undefined;
    const doctors = await doctorsService.listDoctors({ specialization, minExperience });
    res.status(200).json({ success: true, data: doctors });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doctor = await doctorsService.getDoctorById(req.params.id as string);
    res.status(200).json({ success: true, data: doctor });
  } catch (err) {
    next(err);
  }
});

router.patch(
  '/me',
  authMiddleware,
  requireRoles('DOCTOR'),
  validate(updateDoctorSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await doctorsService.updateDoctorProfile(req.user!.userId, req.body);
      res.status(200).json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

export const doctorsRoutes = router;
