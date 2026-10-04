import multer from 'multer';
import { env } from '../config/env.js';
import { isAllowedMime } from '../services/storageService.js';
import { ApiError } from '../utils/ApiError.js';

const MAX_BYTES = env.UPLOAD_MAX_FILE_MB * 1024 * 1024;

/**
 * رفع الملفات في الذاكرة ثم تُحفظ عبر storageService (بديل Supabase Storage).
 * حدود صريحة للنوع والحجم، والتحقق من نوع MIME يتم في الطبقة الثانية أيضًا.
 */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_BYTES,
    files: 12,
    fields: 40,
  },
  fileFilter: (_req, file, cb) => {
    if (isAllowedMime(file.mimetype)) return cb(null, true);
    return cb(ApiError.badRequest(`نوع الملف غير مدعوم: ${file.mimetype}`));
  },
});

export const uploadSingle = upload.single('file');
export const uploadMany = upload.array('files', 12);
export const uploadEvidence = upload.fields([
  { name: 'files', maxCount: 10 },
  { name: 'signature', maxCount: 1 },
]);
