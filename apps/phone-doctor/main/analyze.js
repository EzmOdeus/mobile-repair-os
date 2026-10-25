// analyze.js — محرك التحليل: يحوّل نتائج الفحص لمشاكل + يقترح حلول من قاعدة المعرفة
'use strict';

const { KB } = require('./kb');

/** مطابقة العَرَض المدخل مع كلمات قاعدة المعرفة وترجيح النتائج */
function matchSymptom(text) {
  const q = String(text || '').toLowerCase();
  if (!q.trim()) return { matches: [], usedAI: false };
  const scored = [];
  for (const entry of KB) {
    let score = 0;
    for (const kw of entry.keywords) {
      if (q.includes(String(kw).toLowerCase())) score += kw.includes(' ') ? 3 : 2;
    }
    if (score > 0) scored.push({ entry, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const best = scored.length ? scored[0].score : 0;
  return { matches: scored, bestScore: best };
}

/** بناء حل منقح من مُدخل KB */
function buildSolution(entry, confidence) {
  return {
    title: entry.title,
    category: entry.category === 'hardware' ? 'هارد وير' : 'سوفت وير',
    severity: entry.severity,
    steps: entry.steps,
    parts: entry.parts,
    costEGP: entry.costEGP,
    successRate: entry.successRate,
    confidence: confidence || 'high',
  };
}

/** استشارة الأعطال: من كلمات الفني إلى الحل خطوة بخطوة */
function askExpertLocal(text) {
  const { matches, bestScore } = matchSymptom(text);
  if (!matches.length) return { status: 'no-match', solutions: [], suggestAI: true };
  const top = matches.filter((m) => m.score === bestScore).slice(0, 3);
  const solutions = top.map((m) => buildSolution(m.entry, bestScore >= 3 ? 'high' : 'medium'));
  return { status: 'ok', solutions, suggestAI: bestScore < 3 };
}

/** خريطة تصحيح نتائج الفحص المحلي للعلاقات مع قاعدة المعرفة */
function diagnoseChecks(checks, deviceKind) {
  const issues = [];
  if (deviceKind !== 'android') return issues;

  for (const c of checks) {
    if (c.status !== 'fail' && c.status !== 'warn') continue;

    // البطارية
    if (c.category === 'البطارية') {
      if (/بيت|ميتة/.test(c.value || '') || (c.value && /injury/i.test(c.value))) {
        issues.push({ id: 'battery-health', title: 'حالة البطارية سيئة', source: c.name, severity: 'high' });
      }
      if (c.name === 'مستوى البطارية' && c.status === 'fail') {
        issues.push({ id: 'battery-drain', title: 'البطارية بكت مع الجهاز', source: c.name, severity: 'medium' });
      }
      if (c.name === 'حرارة البطارية' && c.status === 'fail') {
        issues.push({ id: 'overheat', title: 'حرارة البطارية مرتفعة', source: c.name, severity: 'high' });
      }
      if (c.name === 'حالة البطارية (جهز)' && c.status === 'fail') {
        issues.push({ id: 'battery-swollen-check', title: 'البطارية مجهول صحتها', source: c.name, severity: 'high' });
      }
    }

    // التخزين
    if (c.category === 'التخزين' && c.status === 'fail') {
      issues.push({ id: 'storage-full', title: 'مساحة التخزين ممتلئة', source: c.name, severity: 'medium' });
      const kbEntry = KB.find((k) => k.id === 'storage-full');
      if (kbEntry) issues[issues.length - 1].solution = buildSolution(kbEntry, 'high');
    }

    // الأمان
    if (c.category === 'الأمان والحماية') {
      if (c.name === 'حالة البوتلودر' && /مفتوح/.test(c.value || '')) {
        issues.push({ id: 'bootloader-unlocked', title: 'البوتلودر مفتوح (فرامور غير موثوق بالأصل)', source: c.name, severity: 'medium' });
      }
      if (/Root|روت/.test(c.name || '') && (c.value || '').includes('روت')) {
        issues.push({ id: 'root-detected', title: 'الجهاز فيه روت/Chicks', source: c.name, severity: 'medium' });
      }
      if (c.name === 'Knox / Warranty Bit' && c.status === 'fail') {
        issues.push({ id: 'knox-tripped', title: 'Knox مُحترق — الجهاز معدَّل مسبقًا', source: c.name, severity: 'medium' });
      }
      if (c.name === 'SELinux الفعلي' && c.status === 'fail') {
        issues.push({ id: 'selinux-open', title: 'SELinux مش Enforcing', source: c.name, severity: 'medium' });
      }
    }

    // الشبكة/SIM
    if (c.category === 'الشبكة وSIM' && (c.name === 'حالة SIM') && c.status === 'warn' && /ABSENT/i.test(c.value || '')) {
      issues.push({ id: 'sim-not-detected', title: 'الشريحة مش بتتقرأ', source: c.name, severity: 'high' });
    }
  }

  // ربط العطلات بخلل قاعدة المعرفة
  for (const issue of issues) {
    if (issue.solution) continue;
    const map = {
      'battery-health': 'battery-drain',
      'battery-drain': 'battery-drain',
      overheat: 'charging-slow-overheat',
      'battery-swollen-check': 'battery-swollen',
    };
    const kbId = map[issue.id];
    if (kbId) {
      const kbEntry = KB.find((k) => k.id === kbId);
      if (kbEntry) issue.solution = buildSolution(kbEntry, 'medium');
    }
  }
  return issues;
}

/** تقييم عام لحالة الجهاز من نقاط الفحص */
function overallHealth(checks) {
  const counts = { pass: 0, warn: 0, fail: 0, info: 0 };
  for (const c of checks) {
    if (c.status in counts) counts[c.status]++;
  }
  return counts;
}

module.exports = { matchSymptom, askExpertLocal, diagnoseChecks, buildSolution, overallHealth };
