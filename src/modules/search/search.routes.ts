import { Router, type Request, type Response, type NextFunction } from 'express';
import { searchService } from './search.service.js';

const router = Router();

router.get('/doctors', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const specialization = req.query.specialization as string | undefined;
    const minExperience = req.query.minExperience ? parseInt(req.query.minExperience as string, 10) : undefined;
    const maxFee = req.query.maxFee ? parseFloat(req.query.maxFee as string) : undefined;
    const availableDate = req.query.availableDate as string | undefined;
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 10;

    const results = await searchService.searchDoctors({
      specialization,
      minExperience,
      maxFee,
      availableDate,
      page,
      limit,
    });

    res.status(200).json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
});

export const searchRoutes = router;
