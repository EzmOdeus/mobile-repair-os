// adb.js — تغليف أوامر ADB لاكتشاف جهاز أندرويد عبر USB وإجراء الفحص الشامل
'use strict';

const { execFile } = require('child_process');

/** تشغيل أمر مع timeout وحصيلة منظمة */
function run(binary, args, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      binary,
      args,
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err ? (typeof err.code === 'number' ? err.code : -1) : 0,
          stdout: stdout || '',
          stderr: stderr || '',
          error: err && err.message ? err.message : null,
        });
      }
    );
  });
}

function adbRun(adbPath, serial, args, opts) {
  const full = serial ? ['-s', serial, ...args] : args.slice();
  return run(adbPath, full, opts);
}

/** shell + ESC للحماية من كسر السطر (نتشغل عادة بأوامر بسيطة) */
function shell(adbPath, serial, command, opts) {
  return adbRun(adbPath, serial, ['shell', command], opts);
}

/** تحويل مخرجات getprop إلى كائن */
function parseProps(text) {
  const props = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\[(.+)\]\s*:\s*\[(.*)\]\s*$/.exec(line.trim());
    if (m) props[m[1]] = m[2];
  }
  return props;
}

/** تحويل dumpsys battery إلى كائن */
function parseBattery(text) {
  const b = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*([A-Za-z0-9_ ]+?):\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim();
    if (/^-?\d+$/.test(val)) b[key] = parseInt(val, 10);
    else b[key] = val;
  }
  return b;
}

/** أعمدة تخزين من df -k /data */
function parseDfData(text) {
  // toybox df -k /data
  // Filesystem     1K-blocks     Used Available Use% Mounted on
  // /dev/block/...  109553976 42105452  67448524  39% /data
  const lines = String(text).split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    const cols = line.split(/\s+/);
    if (cols.length >= 5 && /data/.test(cols[cols.length - 1])) {
      return {
        filesystem: cols[0],
        blocksKb: toInt(cols[1]),
        usedKb: toInt(cols[2]),
        availableKb: toInt(cols[3]),
        usedPercent: toInt(cols[4]),
      };
    }
  }
  return null;
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function humanGb(kb) {
  if (kb == null) return null;
  return +(kb / (1024 * 1024)).toFixed(1); // كتلة 1K → GB
}

/**
 * التحقق من وجود ADB
 * يعيد { ok, adbPath, version, error }
 */
async function ensureAdb(adbPath) {
  const bin = adbPath && adbPath.trim() ? adbPath.trim() : 'adb';
  const res = await run(bin, ['version'], { timeoutMs: 5000 });
  if (!res.ok || !/Android Debug Bridge/i.test(res.stdout)) {
    return { ok: false, adbPath: bin, error: 'لم يتم العثور على ADB — ثبّت أدوات المنصة أو حدد مسار adb.exe من الإعدادات' };
  }
  const version = (res.stdout.match(/version ([\d.]+)/) || [])[1] || null;
  return { ok: true, adbPath: bin, version };
}

/** قائمة الأجهزة المتواصلة عبر USB (أندرويد فقط) */
async function listDevices(adbPath) {
  const res = await run(adbPath, ['devices'], { timeoutMs: 6000 });
  if (!res.ok) return [];
  const devices = [];
  for (const line of String(res.stdout).split(/\r?\n/).slice(1)) {
    const m = /^(\S+)\s+(\S+)\s*$/.exec(line.trim());
    if (m && m[2] === 'device') devices.push({ serial: m[1], kind: 'android' });
  }
  return devices;
}

/** قراءة خصائص getprop مع تمرير قائمة التصريح (whitelist) */
function pick(props) {
  const g = (k) => props[k] || null;
  const platform = g('ro.board.platform') || g('ro.soc.model') || g('ro.hw.platform') || null;
  const brand = g('ro.product.brand') || g('ro.product.manufacturer') || null;
  const model = g('ro.product.model') || g('ro.product.device') || null;
  const marketing = g('ro.product.marketname') || g('ro.product.odm.model') || null;
  const firstModelName = [marketing, g('ro.product.market_name')].find(Boolean) || model;
  return {
    brand,
    brandUpper: brand ? brand.toUpperCase() : null,
    model: firstModelName,
    deviceCode: g('ro.product.device'),
    platform, // منصة الرقاقة (المعالج)
    cpuCores: toInt(g('ro.product.cpu.processor_count')),
    cpuAbi: g('ro.product.cpu.abi') || g('ro.product.cpu.abilist'),
    ram: g('ro.product.ram') || g('ro.boot.ram') || g('ro.product.ram_size'),
    androidVersion: g('ro.build.version.release') || null,
    androidSdk: toInt(g('ro.build.version.sdk')),
    buildId: g('ro.build.id'),
    fingerprint: g('ro.build.fingerprint'),
    kernel: g('ro.kernel.version') || g('ro.uname.kernel') || null,
    securityPatch: g('ro.build.version.security_patch') || null,
    verifiedBootState: g('ro.boot.verifiedbootstate'), // green/yellow/orange/red
    flashLocked: g('ro.boot.flash.locked'),
    verityMode: g('ro.boot.veritymode'),
    secure: g('ro.secure'),
    debuggable: g('ro.debuggable'),
    selinux: g('ro.build.selinux') || null, // غير موثوقة دائمًا — نتحقق منها بـ getenforce
    warrantyBit: g('ro.boot.warranty_bit') || g('ro.warranty_bit'),
    knox: g('ro.config.knox') || g('ro.boot.knox') || null,
    screen: g('hw.lcd.width'),
    sims: toInt(g('ro.multisim.simslotcount')) || toInt(g('persist.radio.multisim.config') === 'dsds' ? 2 : null),
    treble: g('ro.treble.enabled'),
    frp: g('ro.frp.pst') ? 'partition-present' : null,
  };
}

function bootStateLabel(state) {
  switch (state) {
    case 'green': return 'مقفول وموثوق (صانع)';
    case 'yellow': return 'توثيق مخصص (قفل مخصص)';
    case 'orange': return 'مفتوح (unlock) — الحماية معطلة';
    case 'red': return 'فشل توثيق (corrupt)';
    default: return null;
  }
}

/**
 * الفحص الشامل لجهاز أندرويد متوصل عبر USB
 * يعيد نقاط فحص موحدة { category, name, status: pass|warn|fail|info, value, note }
 */
async function fullCheck(adbPath, serial) {
  const checks = [];

  // 1) الخصائص
  const propsRes = await shell(adbPath, serial, 'getprop', { timeoutMs: 15000 });
  const props = propsRes.ok ? parseProps(propsRes.stdout) : {};
  const info = pick(props);

  if (!info.brand) {
    checks.push({ category: 'جهاز', name: 'قراءة هوية الجهاز', status: 'fail', value: null, note: 'لم نتمكن من قراءة خصائص الجهاز — تأكد من تفعيل تشخيص USB وإذن التصحيح على الموبايل' });
  }

  // 2) البطارية
  const batRes = await shell(adbPath, serial, 'dumpsys battery', { timeoutMs: 10000 });
  if (batRes.ok) {
    const b = parseBattery(batRes.stdout);
    const level = b.level != null ? b.level : null;
    const healthMap = { 1: 'غير معروف', 2: 'سليمة', 3: 'تهوّن (overheat)', 4: 'ميتة', 5: 'فحط جهد (over-voltage)', 6: 'عطل غير محدد (failure)' };
    const chargeStatusMap = { 1: 'غير معروف', 2: 'يُشحن (توصيل)', 3: 'يُفرغ', 4: 'خارج السلك', 5: 'شحن كامل' };
    checks.push({
      category: 'البطارية',
      name: 'مستوى البطارية',
      status: level >= 10 ? (level >= 30 ? 'pass' : 'warn') : 'fail',
      value: level != null ? `٪${level}` : null,
      note: level != null && level < 10 ? 'البطارية شبه فاضية — اعمل اختبار شحن' : null,
    });
    checks.push({
      category: 'البطارية',
      name: 'حالة البطارية (جهز)',
      status: b.health === 2 ? 'pass' : b.health >= 3 ? 'fail' : 'info',
      value: healthMap[b.health] || null,
      note: b.health >= 3 ? 'البطارية فيها مشكلة مبلغة من الجهاز نفسه — عمّعها أن تكون محتاجة للتبديل' : null,
    });
    checks.push({
      category: 'البطارية',
      name: 'حالة الشحن',
      status: 'info',
      value: chargeStatusMap[b.status] || null,
      note: b.acPowered === 1 || b.usbPowered === 1 ? 'موصّل بكابل الذي يعمل ويعرّف الجهاز' : null,
    });
    if (b.temperature != null) {
      checks.push({
        category: 'البطارية',
        name: 'حرارة البطارية',
        status: b.temperature <= 35 ? 'pass' : b.temperature <= 42 ? 'warn' : 'fail',
        value: `${(b.temperature / 10).toFixed(1)}°C`,
        note: b.temperature > 42 ? 'حرارة عالية أثناء الفحص — احتمال مشكلة حرارية أو شحن غيارات' : null,
      });
    }
    if (b.voltage != null) {
      checks.push({
        category: 'البطارية',
        name: 'جهد البطارية',
        status: b.voltage >= 3400 && b.voltage <= 4400 ? 'pass' : b.voltage < 3400 ? 'warn' : 'warn',
        value: `${(b.voltage / 1000).toFixed(2)} V`,
      });
    }
  } else {
    checks.push({ category: 'البطارية', name: 'قراءة البطارية', status: 'info', value: null, note: 'تعذر قراءة البطارية تلقائيًا' });
  }

  // 3) التخزين
  const dfRes = await shell(adbPath, serial, 'df -k /data', { timeoutMs: 10000 });
  if (dfRes.ok) {
    const data = parseDfData(dfRes.stdout);
    if (data) {
      checks.push({
        category: 'التخزين',
        name: 'مصفوفة التخزين',
        status: data.usedPercent == null ? 'info' : data.usedPercent < 85 ? 'pass' : data.usedPercent < 95 ? 'warn' : 'fail',
        value: data.usedPercent != null ? `${data.usedPercent}% مستعمل` : null,
        note: `المساحة الكلية ~${humanGb(data.blocksKb)}GB، المتبقّي ~${humanGb(data.availableKb)}GB`,
      });
      if (data.availableKb != null && data.availableKb < 2 * 1024 * 1024 * 1024) {
        checks.push({
          category: 'التخزين',
          name: 'مساحة حرة',
          status: 'warn',
          value: humanGb(data.availableKb),
          note: 'مساحة حرة قليلة جداً — تبطّيء الجهاز غالبًا من المساحة الملعنة',
        });
      }
    } else {
      checks.push({ category: 'التخزين', name: 'مصفوفة التخزين', status: 'info', value: null, note: 'تعذر قراءة تفاصيل تخزين /data' });
    }
  }

  // 4) الذاكرة
  const memRes = await shell(adbPath, serial, 'dumpsys meminfo', { timeoutMs: 10000 });
  if (memRes.ok) {
    const m = /Total RAM:\s*([\d.]+)\s*GB/.exec(memRes.stdout);
    if (m) checks.push({ category: 'الذاكرة', name: 'الرامات', status: 'info', value: `${m[1]} GB` });
  }
  if (info.ram) checks.push({ category: 'الذاكرة', name: 'الرامات (معلنة بالجهاز)', status: 'info', value: info.ram });

  // 5) الأمان
  checks.push({
    category: 'الأمان والحماية',
    name: 'حالة البوتلودر',
    status: info.verifiedBootState === 'green' ? 'pass' : info.verifiedBootState === 'orange' ? 'fail' : 'info',
    value: bootStateLabel(info.verifiedBootState),
    note: info.verifiedBootState === 'orange' ? 'البوتلودر مفتوح — الحماية معطلة وقد يكون فرامور مخصص (تعريب/أوفيس)' : null,
  });
  checks.push({
    category: 'الأمان والحماية',
    name: 'تحديث الأمان (Security Patch)',
    status: info.securityPatch ? 'info' : 'warn',
    value: info.securityPatch,
    note: info.securityPatch && info.securityPatch < '2024' ? 'تحديث الأمان قديم — يفضَّل تحديث الفرامور' : null,
  });
  checks.push({
    category: 'الأمان والحماية',
    name: 'SELinux',
    status: 'info',
    value: props['ro.build.selinux'] === '1' ? 'Permissive' : null,
    note: 'التحقق الفعلي يتم عبر getenforce',
  });
  const selinuxRes = await shell(adbPath, serial, 'getenforce', { timeoutMs: 6000 });
  if (selinuxRes.ok) {
    const val = selinuxRes.stdout.trim();
    checks.push({
      category: 'الأمان والحماية',
      name: 'SELinux الفعلي',
      status: val === 'Enforcing' ? 'pass' : 'fail',
      value: val,
      note: val !== 'Enforcing' ? 'SELinux مش Enforcing — غالبًا فرامور معدّل أو روت' : null,
    });
  }
  checks.push({
    category: 'الأمان والحماية',
    name: 'جهاز Microless / Root',
    status: 'info',
    value: info.debuggable === '1' || info.secure === '0' ? 'تؤشرات روت' : 'تؤشرات سليم',
    note: info.debuggable === '1' || info.secure === '0' ? 'ro.debuggable=1 أو ro.secure=0 — غالبًا روت أو بناء ديف' : null,
  });
  if (info.warrantyBit === '1' || info.warrantyBit === 1) {
    checks.push({
      category: 'الأمان والحماية',
      name: 'Knox / Warranty Bit',
      status: 'fail',
      value: 'مُحترق (tripped)',
      note: 'Knox مُحترق — الضمان الرسمي الكامل على الأجهزة المعدّلة',
    });
  } else if (info.knox) {
    checks.push({ category: 'الأمان والحماية', name: 'Knox (سامسونج)', status: 'info', value: 'موجود وسليم' });
  }

  // 6) الشبكة وSIM
  const simState = props['gsm.sim.state'];
  if (simState != null) {
    checks.push({
      category: 'الشبكة وSIM',
      name: 'حالة SIM',
      status: /READY|LOADED/i.test(simState) ? 'pass' : /ABSENT|PIN|PUK/i.test(simState) ? 'warn' : 'info',
      value: simState,
      note: /ABSENT/i.test(simState) ? 'مفيش SIM مقروء — جرّب شريحة تانية أو سوفت إمي غير متاح (مشكلة إيمي قاعدة)' : /PIN|PUK/i.test(simState) ? 'الشريحة محمية برمز (PIN/PUK)' : null,
    });
  }
  const operator = props['gsm.operator.alpha'];
  if (operator) checks.push({ category: 'الشبكة وSIM', name: 'مُشغّل الشبكة', status: 'info', value: operator });
  const netType = props['gsm.network.type'];
  if (netType) checks.push({ category: 'الشبكة وSIM', name: 'نوع الشبكة', status: 'info', value: netType });

  // 7) IMEI — محاولة بسيطة (قد يبطل على بعض الأجهزة لو الخيرية عبر عدم الإذن)
  const imeiRes = await shell(adbPath, serial, 'dumpsys telephony.registry | grep -E \'mImei|imei\'', { timeoutMs: 8000 });
  let imeis = [];
  if (imeiRes.ok) {
    const rx = /mImei(?:\s*Id)?\s*=\s*(\d{15,17})/gi;
    let mm;
    while ((mm = rx.exec(imeiRes.stdout))) imeis.push(mm[1]);
  }
  if (props['persist.radio.imei']) imeis.push(props['persist.radio.imei']);
  imeis = [...new Set(imeis)].slice(0, 2);
  checks.push({
    category: 'الشبكة وSIM',
    name: 'IMEI',
    status: imeis.length ? 'info' : 'warn',
    value: imeis.join(' / ') || null,
    note: !imeis.length ? 'لم يكون متوفر بدون إذن — اقرأه من الصندوق أو *#06# وثبّته يدويًا في التقرير' : null,
  });

  // 8) الشاشة واللمس — لا يزال يدويًا، لكن ن امکان قياس وقت قفة الشاشة لوجود معلومات
  const displayRes = await shell(adbPath, serial, 'dumpsys display | grep -i "mBaseDisplayInfo"', { timeoutMs: 8000 });
  if (displayRes.ok) {
    const resMatch = /([0-9]{3,4})\s*x\s*([0-9]{3,4})/.exec(displayRes.stdout);
    if (resMatch) checks.push({ category: 'الشاشة', name: 'دقة الشاشة', status: 'pass', value: `${resMatch[1]}x${resMatch[2]} (معلنة)` });
  }

  // 9) اختبارات حساسة إن كان ممكن (فحوص افتراضية معظمها يدوي)
  checks.push({
    category: 'اختبارات يدوية',
    name: 'قائمة اختبار يدوي',
    status: 'info',
    value: null,
    note: 'شاشة لمس، سماعة إتصال، مايك، سماعة أعلاه، كاميرات، فلاش، بصمة/فيس، فيبرات، رد → الفني يختبرها بيدَه من شاشة «مشاكل»',
  });

  return { info, checks };
}

module.exports = { ensureAdb, listDevices, fullCheck, parseProps, parseBattery, bootStateLabel };
