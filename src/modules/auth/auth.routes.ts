import { Router } from 'express';
import { authController } from './auth.controller.js';
import { validate } from '../../common/middleware/validate.js';
import { authMiddleware } from '../../common/middleware/auth.js';
import { rateLimiter } from '../../common/middleware/rateLimit.js';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  mfaVerifySchema,
} from './auth.schemas.js';

const router = Router();

// Rate limit authentication attempts (prevent brute force / credential stuffing)
const authRateLimiter = rateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 10,
});

router.post('/register', authRateLimiter, validate(registerSchema), (req, res, next) =>
  authController.register(req, res, next)
);

router.post('/login', authRateLimiter, validate(loginSchema), (req, res, next) =>
  authController.login(req, res, next)
);

router.post('/refresh', validate(refreshSchema), (req, res, next) =>
  authController.refresh(req, res, next)
);

router.post('/logout', validate(refreshSchema), (req, res, next) =>
  authController.logout(req, res, next)
);

router.post('/mfa/enroll', authMiddleware, (req, res, next) =>
  authController.enrollMfa(req, res, next)
);

router.post('/mfa/verify', authMiddleware, validate(mfaVerifySchema), (req, res, next) =>
  authController.verifyMfa(req, res, next)
);

export const authRoutes = router;
