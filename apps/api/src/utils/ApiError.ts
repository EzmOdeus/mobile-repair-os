export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INVALID_TRANSITION'
  | 'BUSINESS_RULE'
  | 'TENANT_MISMATCH'
  | 'INTERNAL_ERROR';

const DEFAULT_MESSAGES_AR: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: 'بيانات الطلب غير صحيحة',
  UNAUTHORIZED: 'يجب تسجيل الدخول',
  FORBIDDEN: 'لا تملك صلاحية تنفيذ هذه العملية',
  NOT_FOUND: 'العنصر المطلوب غير موجود',
  CONFLICT: 'يوجد تعارض مع بيانات موجودة بالفعل',
  RATE_LIMITED: 'عدد الطلبات كبير، حاول بعد قليل',
  INVALID_TRANSITION: 'انتقال الحالة غير مسموح في دورة الصيانة',
  BUSINESS_RULE: 'العملية مرفوضة وفق قواعد النظام',
  TENANT_MISMATCH: 'المورد المطلوب لا يخص مؤسستك',
  INTERNAL_ERROR: 'حدث خطأ غير متوقع',
};

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 422,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INVALID_TRANSITION: 409,
  BUSINESS_RULE: 422,
  TENANT_MISMATCH: 403,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message?: string, details?: unknown) {
    super(message ?? DEFAULT_MESSAGES_AR[code]);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message?: string, details?: unknown) {
    return new ApiError('VALIDATION_ERROR', message, details);
  }
  static unauthorized(message?: string) {
    return new ApiError('UNAUTHORIZED', message);
  }
  static forbidden(message?: string) {
    return new ApiError('FORBIDDEN', message);
  }
  static notFound(message?: string) {
    return new ApiError('NOT_FOUND', message);
  }
  static conflict(message?: string, details?: unknown) {
    return new ApiError('CONFLICT', message, details);
  }
  static invalidTransition(message?: string, details?: unknown) {
    return new ApiError('INVALID_TRANSITION', message, details);
  }
  static businessRule(message?: string, details?: unknown) {
    return new ApiError('BUSINESS_RULE', message, details);
  }
  static tenantMismatch(message?: string) {
    return new ApiError('TENANT_MISMATCH', message);
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}
