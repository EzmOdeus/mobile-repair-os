// iphone.js — اكتشاف آيفون عبر Apple Mobile Device Service (usbmuxd) على ويندوز
// يستخدم TCP localhost:27015 للتواصل مع usbmuxd، ثم lockdown عبر التونل للحصول على بيانات أساسية.
// بيانات أعمق تحتاج تثبيت زوج (Trust) — تعطى للموظف كتوجيه.
'use strict';

const net = require('net');

const USBMUXD_PORT = 27015;
const MSG = { RESULT: 1, CONNECT: 2, LISTEN: 3, ATTACHED: 4, DETACHED: 5, VERSION: 6 };
const LOCKDOWN_PORT = 62078;
const HEADER_SIZE = 16;

/** بناء رأس رسالة usbmuxd (16 بايت) */
function buildHeader(bodyLength, type, tag) {
  const buf = Buffer.alloc(HEADER_SIZE);
  buf.writeUInt32LE(HEADER_SIZE + bodyLength, 0);
  buf.writeUInt32LE(1, 4); // protocol version
  buf.writeUInt32LE(type, 8);
  buf.writeUInt32LE(tag, 12);
  return buf;
}

/**
 * طلب قائمة الأجهزة عبر رسالة LISTEN — بالفعل usbmuxd يرد بكل ATTACHED
 */
function buildListenMessage(tag) {
  return buildHeader(0, MSG.LISTEN, tag);
}

/** رسالة الاتصال بـ lockdown: DeviceID (LE) + port (BE per sockaddr) */
function buildConnectMessage(deviceId, port, tag) {
  const body = Buffer.alloc(8);
  body.writeInt32LE(deviceId, 0);
  body.writeInt32BE(port, 4);
  return Buffer.concat([buildHeader(body.length, MSG.CONNECT, tag), body]);
}

/** قراءة رأس رسالة */
function parseHeader(buf) {
  if (buf.length < HEADER_SIZE) return null;
  return { length: buf.readUInt32LE(0), version: buf.readUInt32LE(4), type: buf.readUInt32LE(8), tag: buf.readUInt32LE(12) };
}

/** XML plist صغير — مُفَكِّك بدائي لدكت اللافتات المطلوب */
function extractPlistValues(xml) {
  // يبحث عن كل <key>..</key><string>..</string> و <key>..</key><integer>..</integer>
  const out = {};
  const rx = /<key>([^<]+)<\/key>\s*<(string|integer|true|false)>(?:([^<]+)<\/\2>)?/g;
  let m;
  while ((m = rx.exec(String(xml)))) {
    const key = m[1];
    if (m[2] === 'string' || m[2] === 'integer') out[key] = m[2] === 'integer' ? parseInt(m[3], 10) : m[3];
    else out[key] = m[2] === 'true';
  }
  return out;
}

/** بناء رسالة lockdown XML plist */
function lockdownXml(dict) {
  const parts = Object.entries(dict).map(([k, v]) => `<key>${k}</key><string>${v}</string>`);
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>${parts.join('')}</dict></plist>`;
}

/** عدد الحروف المستخدم على مستوى JST بدء plist إرسال */
function plistBuffer(xml) {
  const buf = Buffer.from(xml, 'utf8');
  const frame = Buffer.alloc(4);
  frame.writeUInt32BE(buf.length, 0); // lockdown يستخدم Big-endian (network order) بالطول
  return Buffer.concat([frame, buf]);
}

/**
 * توصيل بخدمة usbmuxd (Windows Apple Mobile Device Service) وسماع ATTACHED
 * يعيد مصفوفة { deviceId, udid, productName, model, iphoneOSVersion } أو []
 */
function usbmuxdListen({ timeoutMs = 3000 } = {}) {
  return new Promise((resolve) => {
    const found = [];
    const socket = net.connect(USBMUXD_PORT, '127.0.0.1');
    let tag = 1;
    let buffer = Buffer.alloc(0);
    let settled = false;

    const finish = (devices) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* تجاهل */ }
      resolve(devices);
    };

    socket.setTimeout(timeoutMs, () => finish(found));
    socket.on('error', () => finish([])); // الخدمة غير شغالة/غير مثبتة (iTunes مطلوب)

    socket.on('connect', () => {
      socket.write(buildListenMessage(tag));
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      // نحلل كل رسالة متاحة
      while (buffer.length >= HEADER_SIZE) {
        const head = parseHeader(buffer);
        if (!head || head.length < HEADER_SIZE || buffer.length < head.length) break;
        const body = buffer.subarray(HEADER_SIZE, head.length);
        if (head.type === MSG.ATTACHED) {
          // الجسم: PropertiesDictLength (4 LE) + DeviceID (4) + plist XML للخصائص
          if (body.length >= 8) {
            const deviceId = body.readInt32LE(4);
            const plistXml = body.subarray(8).toString('utf8');
            const vals = extractPlistValues(plistXml);
            found.push({
              deviceId,
              kind: 'iphone',
              udid: vals.USBSerialNumber || vals.SerialNumber || null,
              model: vals.ProductType || null,
              cpuModel: null,
              androidVersion: null, // آيفون: iOS
              iphoneOSVersion: vals.ProductVersion || null,
              deviceName: vals.DeviceName || null,
              serialNumber: vals.SerialNumber || null,
            });
          }
          settled = true; // يكفي واحد من قائمة الأجهزة — نغلق
          try { socket.destroy(); } catch { /* تجاهل */ }
          return finish(found);
        }
        buffer = buffer.subarray(head.length);
      }
    });
  });
}

/**
 * محاولة قراءة قيم lockdown (بدون زوج/pairing — القيم الأساسية فقط متوفرة)
 */
function lockdownGetValue(deviceId, { timeoutMs = 4000 } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect(USBMUXD_PORT, '127.0.0.1');
    let tag = 101;
    let buffer = Buffer.alloc(0);
    let stage = 'waitForConnect';
    let settled = false;
    const done = (values) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* تجاهل */ }
      resolve(values);
    };
    socket.setTimeout(timeoutMs, () => done({}));
    socket.on('error', () => done({}));

    socket.on('connect', () => {
      socket.write(buildConnectMessage(deviceId, LOCKDOWN_PORT, tag++));
    });

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 'waitForConnect') {
        if (buffer.length >= HEADER_SIZE) {
          const head = parseHeader(buffer);
          if (head && buffer.length >= head.length) {
            const body = buffer.subarray(HEADER_SIZE, head.length);
            const resultCode = body.length >= 4 ? body.readInt32LE(0) : -1;
            if (resultCode !== 0) return done({}); // فشل التونل (قفل الشاشة/غير متوافق)
            stage = 'lockdown';
            socket.write(plistBuffer(lockdownXml({
              ConType: 'com.apple.mobile.lockdown',
              Request: 'GetValue',
            })));
            buffer = Buffer.alloc(0);
          }
        }
        return;
      }
      // مرحلة lockdown: الرد XML plist بطول 4 bytes BE
      if (stage === 'lockdown' && buffer.length >= 4) {
        const len = buffer.readUInt32BE(0);
        if (buffer.length >= 4 + len) {
          const xml = buffer.subarray(4, 4 + len).toString('utf8');
          const vals = extractPlistValues(xml);
          const value = vals.Value && typeof vals.Value !== 'boolean' ? {} : null;
          // GetValue الفعلي — الحزمة تحتوي على قيم مفادها يتكرر داخل Value — نستعمل extractPlistValues فهي شاملة
          const out = vals.Value === undefined ? vals : { ...vals };
          done(out || value || vals);
        }
      }
    });
  });
}

/** خريطة ProductType → اسم تسويقي (عينة كبيرة شائعة) */
const IPHONE_MODEL_NAMES = {
  'iPhone1,1': 'iPhone', 'iPhone1,2': 'iPhone 3G', 'iPhone2,1': 'iPhone 3GS',
  'iPhone3,1': 'iPhone 4', 'iPhone3,2': 'iPhone 4', 'iPhone3,3': 'iPhone 4 CDMA',
  'iPhone4,1': 'iPhone 4s', 'iPhone5,1': 'iPhone 5', 'iPhone5,2': 'iPhone 5',
  'iPhone5,3': 'iPhone 5c', 'iPhone5,4': 'iPhone 5c', 'iPhone6,1': 'iPhone 5s',
  'iPhone6,2': 'iPhone 5s', 'iPhone7,1': 'iPhone 6 Plus', 'iPhone7,2': 'iPhone 6',
  'iPhone8,1': 'iPhone 6s', 'iPhone8,2': 'iPhone 6s Plus', 'iPhone8,4': 'iPhone SE (1st)',
  'iPhone9,1': 'iPhone 7', 'iPhone9,3': 'iPhone 7', 'iPhone9,2': 'iPhone 7 Plus', 'iPhone9,4': 'iPhone 7 Plus',
  'iPhone10,1': 'iPhone 8', 'iPhone10,4': 'iPhone 8', 'iPhone10,2': 'iPhone 8 Plus', 'iPhone10,5': 'iPhone 8 Plus',
  'iPhone10,3': 'iPhone X', 'iPhone10,6': 'iPhone X',
  'iPhone11,2': 'iPhone XS', 'iPhone11,4': 'iPhone XS Max', 'iPhone11,6': 'iPhone XS Max',
  'iPhone11,8': 'iPhone XR', 'iPhone12,1': 'iPhone 11', 'iPhone12,3': 'iPhone 11 Pro', 'iPhone12,5': 'iPhone 11 Pro Max',
  'iPhone12,8': 'iPhone SE (2nd)',
  'iPhone13,1': 'iPhone 12 mini', 'iPhone13,2': 'iPhone 12', 'iPhone13,3': 'iPhone 12 Pro', 'iPhone13,4': 'iPhone 12 Pro Max',
  'iPhone14,4': 'iPhone 13 mini', 'iPhone14,5': 'iPhone 13', 'iPhone14,2': 'iPhone 13 Pro', 'iPhone14,3': 'iPhone 13 Pro Max',
  'iPhone14,6': 'iPhone SE (3rd)', 'iPhone14,7': 'iPhone 14', 'iPhone14,8': 'iPhone 14 Plus',
  'iPhone15,2': 'iPhone 14 Pro', 'iPhone15,3': 'iPhone 14 Pro Max',
  'iPhone15,4': 'iPhone 15', 'iPhone15,5': 'iPhone 15 Plus', 'iPhone16,1': 'iPhone 15 Pro', 'iPhone16,2': 'iPhone 15 Pro Max',
  'iPhone16,3': 'iPhone 16 Pro', 'iPhone16,4': 'iPhone 16 Pro Max', 'iPhone17,3': 'iPhone 16', 'iPhone17,4': 'iPhone 16 Plus',
  'iPhone17,5': 'iPhone 16e',
};

async function detectIphones() {
  const devices = await usbmuxdListen();
  const enriched = [];
  for (const dev of devices) {
    const values = await lockdownGetValue(dev.deviceId);
    if (values.ProductType) dev.model = values.ProductType;
    if (values.ProductVersion) dev.iphoneOSVersion = values.ProductVersion;
    if (values.SerialNumber) dev.serialNumber = values.SerialNumber;
    if (values.UDID) dev.udid = values.UDID;
    dev.marketingName = IPHONE_MODEL_NAMES[dev.model] || null;
    enriched.push(dev);
  }
  return enriched;
}

module.exports = {
  USBMUXD_PORT, LOCKDOWN_PORT,
  buildHeader, buildListenMessage, buildConnectMessage, parseHeader,
  extractPlistValues, lockdownXml, plistBuffer,
  usbmuxdListen, lockdownGetValue, detectIphones, IPHONE_MODEL_NAMES,
};
