import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { logger } from '../config/logger.js';

export interface StorageDriver {
  put(storageKey: string, buffer: Buffer, mimeType: string): Promise<void>;
  getStream(storageKey: string): Promise<Readable>;
  /** يُستخدم للتحقق من وجود الملف قبل التقديم — يجب ألا يرمي خطأ */
  exists(storageKey: string): Promise<boolean>;
  delete(storageKey: string): Promise<void>;
}

export function resolveUploadDir(): string {
  return path.isAbsolute(env.UPLOAD_DIR)
    ? env.UPLOAD_DIR
    : path.resolve(process.cwd(), env.UPLOAD_DIR);
}

/* ------------------------------ القرص المحلي ------------------------------ */

const localDriver: StorageDriver = {
  async put(storageKey, buffer) {
    const absolute = path.join(resolveUploadDir(), storageKey);
    await fsp.mkdir(path.dirname(absolute), { recursive: true });
    await fsp.writeFile(absolute, buffer);
  },
  async getStream(storageKey) {
    const absolute = path.join(resolveUploadDir(), storageKey);
    if (!fs.existsSync(absolute)) throw ApiError.notFound('الملف غير موجود على القرص');
    return fs.createReadStream(absolute);
  },
  async exists(storageKey) {
    try {
      const stat = await fsp.stat(path.join(resolveUploadDir(), storageKey));
      return stat.isFile();
    } catch {
      return false;
    }
  },
  async delete(storageKey) {
    try {
      await fsp.unlink(path.join(resolveUploadDir(), storageKey));
    } catch (err) {
      logger.warn({ err, storageKey }, 'تعذر حذف الملف من القرص');
    }
  },
};

/* ------------------------- S3 متوافق (AWS/R2/MinIO) ------------------------- */

let s3Client: S3Client | null = null;

async function getS3Client(): Promise<S3Client> {
  if (s3Client) return s3Client;
  const { S3Client } = await import('@aws-sdk/client-s3');
  const missing = [
    ['S3_BUCKET', env.S3_BUCKET],
    ['S3_ACCESS_KEY_ID', env.S3_ACCESS_KEY_ID],
    ['S3_SECRET_ACCESS_KEY', env.S3_SECRET_ACCESS_KEY],
  ].filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw ApiError.businessRule(
      `إعدادات التخزين السحابي ناقصة: ${missing.join('، ')}`,
    );
  }
  s3Client = new S3Client({
    region: env.S3_REGION || 'auto',
    endpoint: env.S3_ENDPOINT || undefined,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
  return s3Client;
}

function isS3NotFound(err: unknown): boolean {
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  const name = (err as { name?: string })?.name ?? '';
  return status === 404 || ['NotFound', 'NoSuchKey', 'NotFoundException'].includes(name);
}

const s3Driver: StorageDriver = {
  async put(storageKey, buffer, mimeType) {
    const client = await getS3Client();
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await client.send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: storageKey,
        Body: buffer,
        ContentType: mimeType,
      }),
    );
  },
  async getStream(storageKey) {
    const client = await getS3Client();
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    try {
      const result = await client.send(
        new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: storageKey }),
      );
      if (!result.Body) throw ApiError.notFound('الملف غير موجود');
      // Body في v3 يأتي كـ Readable في Node — نحوّله عبر fromWeb للأمان
      const web = result.Body as unknown as import('stream/web').ReadableStream;
      return Readable.fromWeb(web);
    } catch (err) {
      if (isS3NotFound(err)) throw ApiError.notFound('الملف غير موجود');
      throw err;
    }
  },
  async exists(storageKey) {
    const client = await getS3Client();
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    try {
      await client.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: storageKey }));
      return true;
    } catch (err) {
      if (isS3NotFound(err)) return false;
      logger.warn({ err, storageKey }, 'فشل فحص وجود ملف في S3');
      return false;
    }
  },
  async delete(storageKey) {
    const client = await getS3Client();
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    try {
      await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: storageKey }));
    } catch (err) {
      logger.warn({ err, storageKey }, 'تعذر حذف الملف من S3');
    }
  },
};

/* ------------------------------ الاختيار ------------------------------ */

export function getStorageDriver(): StorageDriver {
  return env.STORAGE_DRIVER === 's3' ? s3Driver : localDriver;
}
