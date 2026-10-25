import { describe, expect, it } from 'vitest';
import {
  buildSmsPayload,
  buildWhatsAppPayload,
  normalizeWhatsAppPhone,
  parseWhatsAppTemplateMap,
  resolveNotificationProvider,
} from './notificationService.js';

describe('messaging payloads', () => {
  it('يحوّل رقمًا مصريًا محليًا إلى صيغة واتساب الدولية', () => {
    expect(normalizeWhatsAppPhone('01012345678')).toBe('201012345678');
    expect(normalizeWhatsAppPhone('+20 101 234 5678')).toBe('201012345678');
    expect(normalizeWhatsAppPhone('201012345678')).toBe('201012345678');
  });

  it('يرسل نصًا حرًا عند غياب قالب معتمد', () => {
    const payload = buildWhatsAppPayload('01012345678', 'جهازك جاهز', 'ready_for_pickup', {}, {});
    expect(payload).toMatchObject({
      messaging_product: 'whatsapp',
      to: '201012345678',
      type: 'text',
      text: { body: 'جهازك جاهز' },
    });
  });

  it('يستخدم قالب Meta ويرتب وسائطه حسب الإعداد', () => {
    const templates = parseWhatsAppTemplateMap(
      JSON.stringify({
        ready_for_pickup: {
          name: 'repair_ready',
          language: 'ar_EG',
          params: ['customerName', 'device', 'total'],
        },
      }),
    );
    const payload = buildWhatsAppPayload(
      '01012345678',
      'نص بديل',
      'ready_for_pickup',
      { customerName: 'أحمد', device: 'iPhone 13', total: '850' },
      templates,
    );
    expect(payload.type).toBe('template');
    expect(payload.template).toEqual({
      name: 'repair_ready',
      language: { code: 'ar_EG' },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'أحمد' },
            { type: 'text', text: 'iPhone 13' },
            { type: 'text', text: '850' },
          ],
        },
      ],
    });
  });

  it('يرفض الأرقام غير الصالحة قبل استدعاء المزود', () => {
    expect(() => buildWhatsAppPayload('abc', 'نص', undefined, {}, {})).toThrow(/رقم واتساب غير صالح/);
  });

  it('يجهّز حمولة بوابة SMS المحلية', () => {
    expect(buildSmsPayload('+201012345678', 'رسالة')).toMatchObject({
      to: '01012345678',
      message: 'رسالة',
    });
  });

  it('يعيد اسم المزود log افتراضيًا', () => {
    expect(resolveNotificationProvider('whatsapp')).toBe('log');
    expect(resolveNotificationProvider('sms')).toBe('log');
    expect(resolveNotificationProvider('in_app')).toBe('log');
  });

  it('يتجاهل خريطة قوالب غير صالحة بدل تعطيل الإرسال', () => {
    expect(parseWhatsAppTemplateMap('{not-json')).toEqual({});
    expect(parseWhatsAppTemplateMap(JSON.stringify({ x: { name: '' } }))).toEqual({});
  });
});
