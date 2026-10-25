import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import bidiFactory from 'bidi-js';

/**
 * فاتورة PDF عربية (RTL) مولّدة على الخادم.
 *
 * القيود المقصودة:
 * - لا نستخدم متصفحًا أو Chromium على السيرفر؛ PDFKit + خط Cairo المرفق مع
 *   الحزمة، مع تشكيل الحروف العربية وترتيب bidi قبل الرسم.
 * - رمز QR يحمل بيانات ضريبية بخمسة حقول TLV (اسم البائع، الرقم الضريبي،
 *   التاريخ، الإجمالي، الضريبة). هذا تنسيق شائع للفاتورة المصرية، لكنه ليس
 *   توقيعًا أو إرسالًا لمنظومة ETA — الربط الرسمي يظل خطوة منفصلة.
 */

/**
 * مسار الخطوط يختلف بين التشغيل المحلي (dist/ أو src/) وبين Vercel حيث
 * includeFiles ينسخ assets إلى cwd. نجرّب المواقع المعروفة قبل الفشل.
 */
function resolveFont(fileName: string): string {
  const candidates = [
    path.resolve(process.cwd(), 'assets/fonts', fileName),
    fileURLToPath(new URL(`../../assets/fonts/${fileName}`, import.meta.url)),
    path.resolve(process.cwd(), 'apps/api/assets/fonts', fileName),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `خط PDF «${fileName}» غير موجود. تأكد من تضمين مجلد assets في حزمة النشر (includeFiles).`,
    );
  }
  return found;
}

let cachedFonts: { regular: string; bold: string } | null = null;

function getFonts(): { regular: string; bold: string } {
  if (!cachedFonts) {
    cachedFonts = {
      regular: resolveFont('Cairo-Regular.ttf'),
      bold: resolveFont('Cairo-Bold.ttf'),
    };
  }
  return cachedFonts;
}

const bidi = bidiFactory();

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const PRIMARY = '#0f766e';
const INK = '#111827';
const MUTED = '#6b7280';
const BORDER = '#e5e7eb';
const SURFACE = '#f9fafb';

export interface InvoicePdfAddress {
  governorate?: string;
  city?: string;
  area?: string;
  street?: string;
  building?: string;
}

export interface InvoicePdfOrganization {
  name: string;
  nameEn?: string;
  legalName?: string;
  taxId?: string;
  commercialRegister?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: InvoicePdfAddress;
  branding?: { receiptFooterText?: string };
}

export interface InvoicePdfBranch {
  name: string;
  code?: string;
  phone?: string;
  email?: string;
  address?: InvoicePdfAddress;
}

export interface InvoicePdfCustomer {
  fullName?: string;
  companyName?: string;
  phone?: string;
  phoneAlt?: string;
  address?: InvoicePdfAddress;
}

export interface InvoicePdfLine {
  kind?: string;
  description: string;
  quantity: number;
  unitPriceEgp: number;
  totalEgp: number;
}

export interface InvoicePdfTotals {
  subtotalEgp: number;
  discountEgp: number;
  taxRatePct: number;
  taxEgp: number;
  totalEgp: number;
  paidEgp: number;
  dueEgp: number;
}

export interface InvoicePdfInvoice {
  invoiceNumber: string;
  type: string;
  status: string;
  issuedAt?: Date | string | null;
  paidAt?: Date | string | null;
  notes?: string;
  customerNotes?: string;
  lines: InvoicePdfLine[];
  totals: InvoicePdfTotals;
  customerId?: InvoicePdfCustomer | null;
  ticketId?: { ticketNumber?: string } | null;
}

export interface InvoicePdfPayment {
  receiptNumber: string;
  method: string;
  amountEgp: number;
  paidAt?: Date | string | null;
  isRefund?: boolean;
}

export interface InvoicePdfInput {
  invoice: InvoicePdfInvoice;
  organization: InvoicePdfOrganization;
  branch?: InvoicePdfBranch | null;
  payments?: InvoicePdfPayment[];
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  issued: 'صادرة',
  partially_paid: 'مدفوعة جزئيًا',
  paid: 'مدفوعة',
  void: 'ملغاة',
  refunded: 'مرتجعة',
};

const TYPE_LABELS: Record<string, string> = {
  repair: 'فاتورة صيانة',
  pos_sale: 'بيع مباشر',
  accessory: 'بيع ملحقات',
  service: 'خدمة',
  warranty_replacement: 'استبدال ضمان',
};

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'نقدي',
  card: 'بطاقة',
  wallet: 'محفظة إلكترونية',
  instapay: 'إنستاباي',
  bank_transfer: 'تحويل بنكي',
  credit: 'آجل',
};

const DATE_FORMAT = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Africa/Cairo',
});

const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN_STRONG = /[A-Za-z0-9]/;

/**
 * PDFKit/fontkit يشكّل الكلمات العربية تلقائيًا لكنه يرسم الكلمات بترتيب منطقي
 * من اليسار لليمين. لذلك نرتّب الرموز (الكلمات) فقط وفق مستويات bidi، ونترك
 * كل كلمة بترتيبها المنطقي ليتولى fontkit تشكيل حروفها.
 */
function tokenLevel(text: string, start: number, end: number, levels: Uint8Array): number {
  for (let i = start; i < end; i += 1) {
    const char = text[i]!;
    if (ARABIC_SCRIPT.test(char)) return levels[i] ?? 1;
    if (LATIN_STRONG.test(char)) return levels[i] ?? 2;
  }
  let max = 0;
  for (let i = start; i < end; i += 1) max = Math.max(max, levels[i] ?? 0);
  return max;
}

/** ترتيب بصري لكلمات سطر عربي مع الحفاظ على ترتيب حروف كل كلمة */
function rtlTokens(value: string): string[] {
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const levels = bidi.getEmbeddingLevels(text, 'rtl').levels;
  const tokens: { text: string; level: number }[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    const start = match.index ?? 0;
    tokens.push({ text: match[0], level: tokenLevel(text, start, start + match[0].length, levels) });
  }

  const runs: (typeof tokens)[] = [];
  let run: typeof tokens = [];
  let parity = -1;
  for (const token of tokens) {
    const nextParity = token.level % 2;
    if (!run.length || nextParity === parity) {
      run.push(token);
      parity = nextParity;
    } else {
      runs.push(run);
      run = [token];
      parity = nextParity;
    }
  }
  if (run.length) runs.push(run);

  return runs
    .reverse()
    .flatMap((tokensInRun) => (tokensInRun[0]!.level % 2 === 1 ? [...tokensInRun].reverse() : tokensInRun))
    .map((token) => token.text);
}

export function rtl(value: string): string {
  return rtlTokens(value).join(' ');
}

function measureRtlLines(doc: PDFKit.PDFDocument, text: string, width: number): string[] {
  const spaceWidth = doc.widthOfString(' ');
  const lines: string[] = [];
  for (const paragraph of String(text).split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = '';
    let lineWidth = 0;
    for (const word of words) {
      const wordWidth = doc.widthOfString(word);
      if (line && lineWidth + spaceWidth + wordWidth > width) {
        lines.push(line);
        line = word;
        lineWidth = wordWidth;
      } else {
        lineWidth += (line ? spaceWidth : 0) + wordWidth;
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function money(value: number): string {
  return `${Number(value ?? 0).toLocaleString('en-EG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ج.م`;
}

function qty(value: number): string {
  return Number(value ?? 0).toLocaleString('en-EG');
}

function dateLabel(value?: Date | string | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '—' : DATE_FORMAT.format(date);
}

function addressLine(address?: InvoicePdfAddress): string {
  if (!address) return '';
  return [address.governorate, address.city, address.area, address.street, address.building]
    .filter(Boolean)
    .join('، ');
}

function tlv(tag: number, value: string): Buffer {
  const buff = Buffer.from(value, 'utf8');
  const length = Math.min(buff.length, 255);
  return Buffer.concat([Buffer.from([tag, length]), buff.subarray(0, length)]);
}

/** TLV/base64 بخمسة حقول — بيانات التحقق الضريبية داخل QR */
export function buildTaxQrPayload(input: InvoicePdfInput): string {
  const invoice = input.invoice;
  const issuedAt =
    invoice.issuedAt instanceof Date
      ? invoice.issuedAt.toISOString()
      : invoice.issuedAt
        ? new Date(invoice.issuedAt).toISOString()
        : new Date().toISOString();
  const sellerName = input.organization.legalName || input.organization.name || '';
  return Buffer.concat([
    tlv(1, sellerName),
    tlv(2, input.organization.taxId ?? ''),
    tlv(3, issuedAt),
    tlv(4, Number(invoice.totals.totalEgp ?? 0).toFixed(2)),
    tlv(5, Number(invoice.totals.taxEgp ?? 0).toFixed(2)),
  ]).toString('base64');
}

interface PdfContext {
  doc: PDFKit.PDFDocument;
  input: InvoicePdfInput;
  y: number;
}

function drawRtl(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  options: PDFKit.Mixins.TextOptions = {},
): number {
  const width = options.width ?? doc.page.width - x - doc.page.margins.right;
  const align = options.align ?? 'left';
  const lineGap = options.lineGap ?? 0;
  const spaceWidth = doc.widthOfString(' ');
  const lines = measureRtlLines(doc, text, width);
  let cursorY = y;
  for (const line of lines) {
    const tokens = rtlTokens(line);
    const lineWidth =
      tokens.reduce((total, token) => total + doc.widthOfString(token), 0) +
      spaceWidth * Math.max(0, tokens.length - 1);
    let cursorX =
      align === 'right' ? x + width - lineWidth : align === 'center' ? x + (width - lineWidth) / 2 : x;
    for (const token of tokens) {
      doc.text(token, cursorX, cursorY, { lineBreak: false });
      cursorX += doc.widthOfString(token) + spaceWidth;
    }
    cursorY += doc.currentLineHeight(true) + lineGap;
  }
  return cursorY;
}

function drawLabelValue(
  ctx: PdfContext,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  valueIsLatin = false,
): void {
  const { doc } = ctx;
  doc.font('Cairo').fontSize(8).fillColor(MUTED);
  drawRtl(doc, label, x, y, { width, align: 'right' });
  doc.font('Cairo-Bold').fontSize(9).fillColor(INK);
  if (valueIsLatin) doc.text(value || '—', x, y + 11, { width, align: 'right' });
  else drawRtl(doc, value || '—', x, y + 11, { width, align: 'right' });
}

function drawHeader(ctx: PdfContext): void {
  const { doc, input } = ctx;
  const org = input.organization;
  doc.rect(0, 0, PAGE_WIDTH, 118).fill(PRIMARY);
  doc.fillColor('#ffffff').font('Cairo-Bold').fontSize(19);
  drawRtl(doc, org.legalName || org.name, MARGIN, 28, { width: CONTENT_WIDTH, align: 'right' });
  doc.font('Cairo').fontSize(9).fillColor('#d1fae5');
  drawRtl(
    doc,
    [org.nameEn, org.taxId ? `الرقم الضريبي ${org.taxId}` : ''].filter(Boolean).join(' · '),
    MARGIN,
    55,
    { width: CONTENT_WIDTH, align: 'right' },
  );

  doc.font('Cairo-Bold').fontSize(19).fillColor('#ffffff');
  drawRtl(doc, 'فاتورة ضريبية إلكترونية', MARGIN, 30, { width: 240, align: 'left' });
  doc.font('Cairo').fontSize(9).fillColor('#d1fae5');
  doc.text(input.invoice.invoiceNumber, MARGIN, 57, { width: 240, align: 'left' });
  drawRtl(doc, dateLabel(input.invoice.issuedAt), MARGIN, 71, { width: 240, align: 'left' });

  ctx.y = 136;
  doc.fillColor(INK);
}

function drawMetaAndSeller(ctx: PdfContext): void {
  const { doc, input } = ctx;
  const org = input.organization;
  const branch = input.branch;
  const rightX = MARGIN + CONTENT_WIDTH - 260;
  const leftX = MARGIN;

  doc.font('Cairo-Bold').fontSize(10).fillColor(PRIMARY);
  drawRtl(doc, 'البائع', rightX, ctx.y, { width: 260, align: 'right' });
  doc.font('Cairo-Bold').fontSize(11).fillColor(INK);
  drawRtl(doc, org.legalName || org.name, rightX, ctx.y + 16, { width: 260, align: 'right' });
  doc.font('Cairo').fontSize(8.5).fillColor(MUTED);
  const sellerLines = [
    org.taxId ? `الرقم الضريبي: ${org.taxId}` : 'الرقم الضريبي: غير مسجل',
    org.commercialRegister ? `السجل التجاري: ${org.commercialRegister}` : '',
    branch ? `الفرع: ${branch.name}${branch.code ? ` (${branch.code})` : ''}` : '',
    branch?.phone || org.phone ? `الهاتف: ${branch?.phone || org.phone}` : '',
    addressLine(branch?.address ?? org.address),
  ].filter(Boolean);
  let sellerY = ctx.y + 34;
  for (const line of sellerLines) {
    drawRtl(doc, line, rightX, sellerY, { width: 260, align: 'right' });
    sellerY += 13;
  }

  doc.font('Cairo-Bold').fontSize(10).fillColor(PRIMARY);
  drawRtl(doc, 'بيانات الفاتورة', leftX, ctx.y, { width: 230, align: 'left' });
  const meta: [string, string, boolean?][] = [
    ['رقم الفاتورة', input.invoice.invoiceNumber, true],
    ['النوع', TYPE_LABELS[input.invoice.type] ?? input.invoice.type],
    ['الحالة', STATUS_LABELS[input.invoice.status] ?? input.invoice.status],
    ['تاريخ الإصدار', dateLabel(input.invoice.issuedAt)],
    ...(input.invoice.ticketId?.ticketNumber
      ? ([['التذكرة', input.invoice.ticketId.ticketNumber, true]] as [string, string, boolean?][])
      : []),
  ];
  let metaY = ctx.y + 16;
  for (const [label, value, latin] of meta) {
    if (latin) drawLabelValue(ctx, label, value, leftX, metaY, 230, true);
    else drawLabelValue(ctx, label, value, leftX, metaY, 230);
    metaY += 27;
  }

  ctx.y = Math.max(sellerY, metaY) + 6;
}

function drawCustomer(ctx: PdfContext): void {
  const { doc, input } = ctx;
  const customer = input.invoice.customerId;
  const height = 58;
  doc.roundedRect(MARGIN, ctx.y, CONTENT_WIDTH, height, 5).fill(SURFACE);
  doc.fillColor(INK).font('Cairo-Bold').fontSize(9);
  drawRtl(doc, 'العميل', MARGIN + CONTENT_WIDTH - 110, ctx.y + 10, { width: 100, align: 'right' });
  doc.font('Cairo-Bold').fontSize(10.5);
  drawRtl(doc, customer?.fullName || customer?.companyName || 'عميل نقدي', MARGIN + CONTENT_WIDTH - 300, ctx.y + 10, {
    width: 185,
    align: 'right',
  });
  doc.font('Cairo').fontSize(8.5).fillColor(MUTED);
  drawRtl(
    doc,
    [customer?.phone, addressLine(customer?.address)].filter(Boolean).join(' · ') || '—',
    MARGIN + CONTENT_WIDTH - 300,
    ctx.y + 29,
    { width: 185, align: 'right' },
  );

  const notes = input.invoice.customerNotes || input.invoice.notes || '';
  if (notes) {
    doc.font('Cairo').fontSize(8).fillColor(MUTED);
    drawRtl(doc, `ملاحظات: ${notes}`.slice(0, 160), MARGIN + 10, ctx.y + 12, {
      width: CONTENT_WIDTH - 310,
      align: 'left',
    });
  }
  ctx.y += height + 16;
}

const COLUMNS = [
  { key: 'index', width: 28, label: '#' },
  { key: 'description', width: 267, label: 'البيان' },
  { key: 'quantity', width: 45, label: 'الكمية' },
  { key: 'unit', width: 85, label: 'سعر الوحدة' },
  { key: 'total', width: 90, label: 'الإجمالي' },
] as const;

function drawTableHeader(ctx: PdfContext): void {
  const { doc } = ctx;
  const rowHeight = 25;
  doc.rect(MARGIN, ctx.y, CONTENT_WIDTH, rowHeight).fill('#e6f4f1');
  let edge = MARGIN + CONTENT_WIDTH;
  doc.font('Cairo-Bold').fontSize(8.5).fillColor(PRIMARY);
  for (const column of COLUMNS) {
    const x = edge - column.width;
    drawRtl(doc, column.label, x + 4, ctx.y + 8, {
      width: column.width - 8,
      align: column.key === 'index' ? 'center' : column.key === 'description' ? 'right' : 'right',
    });
    edge -= column.width;
  }
  edge = MARGIN + CONTENT_WIDTH;
  doc
    .moveTo(MARGIN, ctx.y)
    .lineTo(MARGIN + CONTENT_WIDTH, ctx.y)
    .lineTo(MARGIN + CONTENT_WIDTH, ctx.y + rowHeight)
    .lineTo(MARGIN, ctx.y + rowHeight)
    .lineTo(MARGIN, ctx.y)
    .strokeColor(BORDER)
    .lineWidth(0.7)
    .stroke();
  ctx.y += rowHeight;
}

function drawTableRow(ctx: PdfContext, line: InvoicePdfLine, index: number): void {
  const { doc } = ctx;
  doc.font('Cairo').fontSize(8.5);
  const descLines = measureRtlLines(doc, line.description || '—', COLUMNS[1].width - 10);
  const rowHeight = Math.max(23, descLines.length * doc.currentLineHeight(true) + 10);

  if (ctx.y + rowHeight > 680) {
    doc.addPage();
    currentPageHeader(ctx);
    drawTableHeader(ctx);
    doc.font('Cairo').fontSize(8.5);
  }

  if (index % 2 === 0) doc.rect(MARGIN, ctx.y, CONTENT_WIDTH, rowHeight).fill('#fbfcfc');
  let edge = MARGIN + CONTENT_WIDTH;
  const values: Record<string, string> = {
    index: String(index + 1),
    description: line.description || '—',
    quantity: qty(line.quantity),
    unit: money(line.unitPriceEgp),
    total: money(line.totalEgp),
  };
  for (const column of COLUMNS) {
    const x = edge - column.width;
    doc.fillColor(INK).font(column.key === 'description' ? 'Cairo' : 'Cairo');
    const value = column.key === 'description' ? values[column.key] : values[column.key];
    if (column.key === 'description') {
      drawRtl(doc, value, x + 5, ctx.y + 6, { width: column.width - 10, align: 'right' });
    } else if (column.key === 'index' || column.key === 'quantity') {
      doc.text(value, x + 5, ctx.y + 7, { width: column.width - 10, align: column.key === 'index' ? 'center' : 'right' });
    } else {
      drawRtl(doc, value, x + 5, ctx.y + 7, { width: column.width - 10, align: 'right' });
    }
    edge -= column.width;
  }

  doc
    .moveTo(MARGIN, ctx.y + rowHeight)
    .lineTo(MARGIN + CONTENT_WIDTH, ctx.y + rowHeight)
    .strokeColor(BORDER)
    .lineWidth(0.5)
    .stroke();
  ctx.y += rowHeight;
}

function currentPageHeader(ctx: PdfContext): void {
  const { doc } = ctx;
  doc.rect(0, 0, PAGE_WIDTH, 52).fill(PRIMARY);
  doc.fillColor('#ffffff').font('Cairo-Bold').fontSize(11);
  drawRtl(doc, `${ctx.input.organization.legalName || ctx.input.organization.name} — ${ctx.input.invoice.invoiceNumber}`, MARGIN, 19, {
    width: CONTENT_WIDTH,
    align: 'right',
  });
  ctx.y = 68;
  doc.fillColor(INK);
}

function drawFooter(ctx: PdfContext): void {
  const { doc, input } = ctx;
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = 0; i < total; i += 1) {
    doc.switchToPage(range.start + i);
    // يبقى نص التذييل أعلى الهامش السفلي؛ تجاوزه يدفع PDFKit لإضافة صفحة فارغة
    doc.font('Cairo').fontSize(7.5).fillColor(MUTED);
    const y = doc.page.maxY() - doc.currentLineHeight(true) - 2;
    doc.moveTo(MARGIN, y - 7).lineTo(MARGIN + CONTENT_WIDTH, y - 7).strokeColor(BORDER).lineWidth(0.6).stroke();
    const footer = input.organization.branding?.receiptFooterText || 'شكرًا لثقتكم — هذه فاتورة إلكترونية مولّدة آليًا.';
    drawRtl(doc, footer, MARGIN + 70, y, { width: CONTENT_WIDTH - 140, align: 'center' });
    drawRtl(doc, `صفحة ${i + 1} من ${total}`, MARGIN + CONTENT_WIDTH - 70, y, { width: 70, align: 'right' });
    if (input.branch?.phone || input.organization.phone) {
      doc.text(input.branch?.phone || input.organization.phone || '', MARGIN, y, {
        width: 70,
        align: 'left',
        lineBreak: false,
      });
    }
  }
}

function drawTotalsAndQr(ctx: PdfContext, qr: Buffer): void {
  const { doc, input } = ctx;
  if (ctx.y + 210 > PAGE_HEIGHT - 60) {
    doc.addPage();
    currentPageHeader(ctx);
  }

  const totals = input.invoice.totals;
  const boxWidth = 245;
  const x = MARGIN + CONTENT_WIDTH - boxWidth;
  let y = ctx.y + 12;

  doc.font('Cairo-Bold').fontSize(9).fillColor(PRIMARY);
  drawRtl(doc, 'ملخص الفاتورة', x, y, { width: boxWidth, align: 'right' });
  y += 18;

  const rows: [string, string, boolean?][] = [
    ['الإجمالي قبل الخصم', money(totals.subtotalEgp)],
    ...(totals.discountEgp > 0 ? ([['الخصم', `- ${money(totals.discountEgp)}`]] as [string, string, boolean?][]) : []),
    [`الضريبة (${totals.taxRatePct}%)`, money(totals.taxEgp)],
    ['الإجمالي', money(totals.totalEgp), true],
    ['المدفوع', money(totals.paidEgp)],
    ['المتبقي', money(totals.dueEgp), true],
  ];

  for (const [label, value, strong] of rows) {
    if (label === 'الإجمالي') {
      doc.moveTo(x, y - 3).lineTo(x + boxWidth, y - 3).strokeColor(BORDER).lineWidth(0.7).stroke();
    }
    doc.font(strong ? 'Cairo-Bold' : 'Cairo').fontSize(strong ? 10 : 8.5).fillColor(strong ? INK : MUTED);
    drawRtl(doc, label, x + 110, y, { width: boxWidth - 110, align: 'right' });
    doc.font(strong ? 'Cairo-Bold' : 'Cairo').fontSize(strong ? 10 : 8.5).fillColor(strong ? INK : MUTED);
    drawRtl(doc, value, x, y, { width: boxWidth - 115, align: 'left' });
    y += strong ? 21 : 17;
  }

  const status = STATUS_LABELS[input.invoice.status] ?? input.invoice.status;
  const statusColor = input.invoice.status === 'paid' ? '#047857' : input.invoice.status === 'void' ? '#b91c1c' : '#b45309';
  doc.font('Cairo-Bold').fontSize(9).fillColor(statusColor);
  drawRtl(doc, `الحالة: ${status}`, x, y + 4, { width: boxWidth, align: 'right' });

  const qrSize = 104;
  const qrX = MARGIN;
  const qrY = ctx.y + 8;
  doc.roundedRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 34, 5).fill('#ffffff').strokeColor(BORDER).lineWidth(0.6).stroke();
  doc.image(qr, qrX, qrY, { width: qrSize, height: qrSize });
  doc.font('Cairo').fontSize(7).fillColor(MUTED);
  drawRtl(doc, 'امسح رمز QR للتحقق من البيانات الضريبية', qrX - 6, qrY + qrSize + 5, {
    width: qrSize + 12,
    align: 'center',
  });

  if ((input.payments ?? []).length) {
    doc.font('Cairo').fontSize(7.5).fillColor(MUTED);
    const count = input.payments!.length;
    const last = input.payments![0];
    drawRtl(
      doc,
      `المدفوعات: ${count} عملية${last ? ` · آخرها ${PAYMENT_LABELS[last.method] ?? last.method} ${money(last.amountEgp)}` : ''}`,
      qrX,
      qrY + qrSize + 24,
      { width: 250, align: 'left' },
    );
  }

  ctx.y = Math.max(y + 25, qrY + qrSize + 40);
}

export async function buildInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: MARGIN,
    bufferPages: true,
    info: {
      Title: `فاتورة ${input.invoice.invoiceNumber}`,
      Author: input.organization.legalName || input.organization.name,
      Subject: 'فاتورة ضريبية إلكترونية',
      Creator: 'Mobile Repair OS',
    },
  });

  const fonts = getFonts();
  doc.registerFont('Cairo', fonts.regular);
  doc.registerFont('Cairo-Bold', fonts.bold);

  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const ctx: PdfContext = { doc, input, y: 0 };
  drawHeader(ctx);
  drawMetaAndSeller(ctx);
  drawCustomer(ctx);

  doc.font('Cairo-Bold').fontSize(10).fillColor(PRIMARY);
  drawRtl(doc, 'بنود الفاتورة', MARGIN, ctx.y, { width: CONTENT_WIDTH, align: 'right' });
  ctx.y += 18;
  drawTableHeader(ctx);

  input.invoice.lines.forEach((line, index) => drawTableRow(ctx, line, index));
  if (!input.invoice.lines.length) {
    doc.font('Cairo').fontSize(9).fillColor(MUTED);
    drawRtl(doc, 'لا توجد بنود في هذه الفاتورة', MARGIN, ctx.y + 12, { width: CONTENT_WIDTH, align: 'center' });
    ctx.y += 34;
  }

  const qr = await QRCode.toBuffer(buildTaxQrPayload(input), {
    type: 'png',
    width: 320,
    margin: 1,
    errorCorrectionLevel: 'M',
  });

  drawTotalsAndQr(ctx, qr);
  drawFooter(ctx);
  doc.end();
  return completed;
}
