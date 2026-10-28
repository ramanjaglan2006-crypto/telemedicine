import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { paymentsService } from './payments.service.js';
import { authMiddleware } from '../../common/middleware/auth.js';
import { validate } from '../../common/middleware/validate.js';
import { idempotencyMiddleware } from '../../common/idempotency/idempotency.manager.js';

const createPaymentSchema = z.object({
  body: z.object({
    appointmentId: z.string().uuid(),
  }),
});

const router = Router();

// Create payment intent - Idempotent
router.post(
  '/',
  authMiddleware,
  idempotencyMiddleware({ required: false }),
  validate(createPaymentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const intent = await paymentsService.createPaymentIntent(
        req.user!.userId,
        req.body.appointmentId
      );
      res.status(201).json({ success: true, data: intent });
    } catch (err) {
      next(err);
    }
  }
);

// Get payment status
router.get('/:paymentId', authMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const payment = await paymentsService.getPaymentById(
      req.user!.userId,
      req.user!.role,
      req.params.paymentId as string
    );
    res.status(200).json({ success: true, data: payment });
  } catch (err) {
    next(err);
  }
});

// Webhook Receiver (No JWT auth - verified via cryptographic signature)
router.post('/webhooks/:provider', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const signature = (req.header('Stripe-Signature') || req.header('X-Webhook-Signature')) as string | undefined;
    const rawPayload = JSON.stringify(req.body);
    const result = await paymentsService.processWebhook(
      req.params.provider as string,
      signature,
      rawPayload,
      req.body
    );
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

export const paymentsRoutes = router;
