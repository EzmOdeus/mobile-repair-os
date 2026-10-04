import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { validate } from '../middleware/validate.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import {
  changePassword,
  createUser,
  deactivateUser,
  getUser,
  listUsers,
  login,
  me,
  refresh,
  registerOrganization,
  rolesCatalog,
  updateProfile,
  updateUser,
} from '../controllers/authController.js';
import {
  changePasswordSchema,
  createUserSchema,
  loginSchema,
  refreshSchema,
  registerOrganizationSchema,
  updateProfileSchema,
  updateUserSchema,
} from '../validators/authValidators.js';

const router = Router();

/** حد معدل أشد على مسارات المصادقة لمنع التخمين */
const authLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60_000,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: 'RATE_LIMITED', message: 'محاولات كثيرة، حاول بعد قليل' },
  },
});

router.post('/login', authLimiter, validate(loginSchema), login);
router.post('/refresh', validate(refreshSchema), refresh);
router.post('/register', authLimiter, validate(registerOrganizationSchema), registerOrganization);

router.get('/me', authenticate, me);
router.patch('/me', authenticate, validate(updateProfileSchema), updateProfile);
router.post('/change-password', authenticate, validate(changePasswordSchema), changePassword);

// إدارة المستخدمين
router.get('/users', requirePermission('user:read'), listUsers);
router.get('/users/:id', requirePermission('user:read'), getUser);
router.post('/users', requirePermission('user:manage'), validate(createUserSchema), createUser);
router.patch('/users/:id', requirePermission('user:manage'), validate(updateUserSchema), updateUser);
router.delete('/users/:id', requirePermission('user:manage'), deactivateUser);

// كتالوج الأدوار والصلاحيات
router.get('/roles', authenticate, rolesCatalog);

export default router;
