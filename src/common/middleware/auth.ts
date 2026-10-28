import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, type TokenPayload } from '../security/jwt.js';
import { UnauthorizedError, ForbiddenError } from '../errors/AppError.js';
import { db } from '../../infrastructure/database/db.js';

export interface AuthenticatedUser extends TokenPayload {
  isActive: boolean;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      requestId?: string;
    }
  }
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or malformed Authorization header');
  }

  const token = authHeader.substring(7).trim();
  const decoded = verifyAccessToken(token);

  // Check user active status in database
  const user = db.findById('users', decoded.userId);
  if (!user || user.is_active === false) {
    throw new UnauthorizedError('User account is inactive or no longer exists');
  }

  req.user = {
    ...decoded,
    isActive: user.is_active as boolean,
  };

  next();
}

/**
 * Role-Based Access Control (RBAC) Middleware
 * Restricts access to specified roles
 */
export function requireRoles(...allowedRoles: ('PATIENT' | 'DOCTOR' | 'ADMIN')[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new UnauthorizedError('Authentication required');
    }

    if (!allowedRoles.includes(req.user.role)) {
      throw new ForbiddenError(
        `Access denied. Role '${req.user.role}' is not authorized to access this resource.`
      );
    }

    next();
  };
}
