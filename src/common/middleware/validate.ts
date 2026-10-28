import type { Request, Response, NextFunction } from 'express';
import { type ZodTypeAny, ZodError, type ZodIssue } from 'zod';
import { BadRequestError } from '../errors/AppError.js';

export function validate(schema: ZodTypeAny) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      if (parsed && typeof parsed === 'object') {
        const record = parsed as Record<string, unknown>;
        if (record.body !== undefined) req.body = record.body;
        if (record.query !== undefined) req.query = record.query as typeof req.query;
        if (record.params !== undefined) req.params = record.params as typeof req.params;
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const details = (error.issues || []).map((err: ZodIssue) => ({
          field: err.path.join('.'),
          message: err.message,
        }));
        next(new BadRequestError('Validation failed', details));
      } else {
        next(error);
      }
    }
  };
}
