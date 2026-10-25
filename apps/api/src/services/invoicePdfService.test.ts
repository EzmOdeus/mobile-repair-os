import { describe, expect, it } from 'vitest';
import { buildInvoicePdf, buildTaxQrPayload, rtl, type InvoicePdfInput } from './invoicePdfService.js';

function decodeTlv(base64: string): Record<number, string> {
  const buffer = Buffer.from(base64, 'base64');
  const fields: Record<number, string> = {};
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const tag = buffer[offset]!;
    const length = buffer[offset + 1]!;
    fields[tag] = buffer.subarray(offset + 2, offset + 2 + length).toString('utf8');
    offset += 2 + length;
  }
  return fields;
}

function makeInput(lineCount = 2): InvoicePdfInput {
  return {
    invoice: {
      invoiceNumber: 'INV-2026-000123',
      type: 'repair',
      status: 'partially_paid',
      issuedAt: new Date('2026-10-24T09:30:00.000Z'),
      lines: Array.from({ length: lineCount }, (_, index) => ({
        kind: 'part',
        description: index === 0 ? 'شاشة أصلية iPhone 13 Pro Max — قطعة غيار' : `قطعة غيار رقم ${index + 1}`,
        quantity: index + 1,
        unitPriceEgp: 1000 + index * 100,
        totalEgp: (index + 1) * (1000 + index * 100),
      })),
      totals: {
        subtotalEgp: 1200,
        discountEgp: 0,
        taxRatePct: 14,
        taxEgp: 168,
        totalEgp: 1368,
        paidEgp: 368,
        dueEgp: 1000,
      },
      customerId: {
        fullName: 'أحمد محمد',
        phone: '01012345678',
        address: { governorate: 'القاهرة', city: 'مدينة نصر' },
      },
      ticketId: { ticketNumber: 'TK-000987' },
      customerNotes: 'يرجى الاتصال قبل التسليم',
    },
    organization: {
      name: 'موبايل ريبير',
      legalName: 'موبايل ريبير للتجارة والتوزيع',
      nameEn: 'Mobile Repair OS',
      taxId: '123-456-789',
      commercialRegister: 'C-998877',
      phone: '0223456789',
      address: { governorate: 'القاهرة', city: 'مدينة نصر', street: 'عباس العقاد', building: '12' },
      branding: { receiptFooterText: 'شكرًا لتعاملكم معنا' },
    },
    branch: {
      name: 'فرع مدينة نصر',
      code: 'NSR',
      phone: '01098765432',
      address: { governorate: 'القاهرة', city: 'مدينة نصر' },
    },
    payments: [
      {
        receiptNumber: 'RCP-000555',
        method: 'cash',
        amountEgp: 368,
        paidAt: new Date('2026-10-24T09:35:00.000Z'),
        isRefund: false,
      },
    ],
  };
}

function countPdfPages(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s])/g) ?? []).length;
}

describe('invoice PDF — رمز QR الضريبي', () => {
  it('يبني خمسة حقول TLV بالترتيب وبالقيم الصحيحة', () => {
    const payload = buildTaxQrPayload(makeInput());
    const fields = decodeTlv(payload);

    expect(Object.keys(fields)).toEqual(['1', '2', '3', '4', '5']);
    expect(fields[1]).toBe('موبايل ريبير للتجارة والتوزيع');
    expect(fields[2]).toBe('123-456-789');
    expect(fields[3]).toBe('2026-10-24T09:30:00.000Z');
    expect(fields[4]).toBe('1368.00');
    expect(fields[5]).toBe('168.00');
  });

  it('يستخدم اسم المؤسسة عند غياب الاسم القانوني والرقم الضريبي الفارغ', () => {
    const input = makeInput();
    input.organization = { name: 'ورشة سريعة' };
    const fields = decodeTlv(buildTaxQrPayload(input));

    expect(fields[1]).toBe('ورشة سريعة');
    expect(fields[2]).toBe('');
  });
});

describe('invoice PDF — ترتيب RTL', () => {
  it('يعكس ترتيب الكلمات العربية دون عكس حروفها', () => {
    expect(rtl('الإجمالي قبل الخصم')).toBe('الخصم قبل الإجمالي');
    expect(rtl('فاتورة ضريبية إلكترونية')).toBe('إلكترونية ضريبية فاتورة');
  });

  it('يُبقي الأرقام والمصطلحات اللاتينية بترتيب LTR', () => {
    expect(rtl('4,200.00 ج.م')).toBe('ج.م 4,200.00');
    expect(rtl('شاشة أصلية iPhone 13 Pro Max — قطعة غيار')).toBe(
      'غيار قطعة — iPhone 13 Pro Max أصلية شاشة',
    );
    expect(rtl('الرقم الضريبي 123-456-789')).toBe('123-456-789 الضريبي الرقم');
  });

  it('يطوي المسافات الزائدة ويُرجع النص كما هو عند غياب العربية', () => {
    expect(rtl('  iPhone   13 Pro Max  ')).toBe('iPhone 13 Pro Max');
    expect(rtl('')).toBe('');
  });
});

describe('invoice PDF — التوليد', () => {
  it('ينتج مستند PDF صالحًا لفاتورة قصيرة', async () => {
    const pdf = await buildInvoicePdf(makeInput());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(10_000);
    expect(countPdfPages(pdf)).toBe(1);
  }, 20_000);

  it('يضيف صفحات عند تجاوز البنود مساحة الصفحة', async () => {
    const pdf = await buildInvoicePdf(makeInput(60));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(countPdfPages(pdf)).toBeGreaterThan(1);
  }, 30_000);
});
