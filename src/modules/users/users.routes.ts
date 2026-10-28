import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { usersService } from './users.service.js';
import { authMiddleware, requireRoles } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';

const updateProfileSchema = z.object({
  body: z.object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    phone: z.string().max(30).optional(),
    address: z.string().optional(),
    medicalHistory: z.string().optional(),
  }),
});

const updateUserStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    isActive: z.boolean(),
  }),
});

export class UsersController {
  async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = await usersService.getMe(req.user!.userId);
      res.status(200).json({ success: true, data: user });
    } catch (err) {
      next(err);
    }
  }

  async updateMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const updated = await usersService.updateMe(req.user!.userId, req.body);
      res.status(200).json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }

  async updateUserStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await usersService.updateUserStatus(
        req.user!.userId,
        req.params.id as string,
        req.body.isActive
      );
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
}

export const usersController = new UsersController();

const router = Router();
router.use(authMiddleware);

router.get('/me', (req, res, next) => usersController.getMe(req, res, next));
router.patch('/me', validate(updateProfileSchema), (req, res, next) => usersController.updateMe(req, res, next));
router.patch('/:id/status', requireRoles('ADMIN'), validate(updateUserStatusSchema), (req, res, next) =>
  usersController.updateUserStatus(req, res, next)
);

export const usersRoutes = router;
