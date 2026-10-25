'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { AlertTriangle, Copy, Download, KeyRound, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react';
import { api, errorMessage, fetcher } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Badge, Card, CardHeader, Field } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';

interface TwoFactorStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesRemaining: number;
  recommended: boolean;
}

interface SetupResponse {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
  message?: string;
}

type Mode = 'idle' | 'setup' | 'disable' | 'regenerate';

export function TwoFactorCard() {
  const toast = useToast();
  const { refreshProfile } = useAuth();
  const { data, isLoading, mutate } = useSWR<TwoFactorStatus>('/auth/2fa/status', fetcher);

  const [mode, setMode] = useState<Mode>('idle');
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetForm = () => {
    setMode('idle');
    setSetup(null);
    setCode('');
    setPassword('');
    setError(null);
  };

  const fail = (err: unknown) => {
    const message = errorMessage(err);
    setError(message);
    toast.error(message);
  };

  const startSetup = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<SetupResponse>('/auth/2fa/setup');
      setSetup(result);
      setMode('setup');
      setCode('');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const confirmEnable = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) {
      setError('أدخل الرمز المكوّن من 6 أرقام');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ recoveryCodes: string[] }>('/auth/2fa/enable', { code: code.trim() });
      setRecoveryCodes(result.recoveryCodes);
      resetForm();
      await mutate();
      await refreshProfile();
      toast.success('تم تفعيل التحقق بخطوتين');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const confirmDisable = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/2fa/disable', { password, code: code.trim() });
      resetForm();
      await mutate();
      await refreshProfile();
      toast.success('تم إيقاف التحقق بخطوتين');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const confirmRegenerate = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ recoveryCodes: string[] }>('/auth/2fa/recovery-codes', {
        password,
        code: code.trim(),
      });
      setRecoveryCodes(result.recoveryCodes);
      resetForm();
      await mutate();
      toast.success('تم تجديد رموز الاسترداد');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const copyCodes = async () => {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      toast.success('تم نسخ رموز الاسترداد');
    } catch {
      toast.error('تعذر النسخ من المتصفح، حدّد الرموز يدويًا');
    }
  };

  const downloadCodes = () => {
    if (!recoveryCodes) return;
    const content = [
      'رموز استرداد التحقق بخطوتين — Mobile Repair OS',
      '',
      ...recoveryCodes,
      '',
      'كل رمز يُستخدم مرة واحدة فقط. احفظ هذا الملف في مكان آمن.',
    ].join('\n');
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'mros-2fa-recovery-codes.txt';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  if (recoveryCodes) {
    return (
      <Card className="mb-4 border-amber-300">
        <CardHeader
          title="رموز استرداد التحقق بخطوتين"
          subtitle="تُعرض مرة واحدة فقط — احفظها الآن في مكان آمن"
          icon={<KeyRound size={18} />}
          action={<Badge className="border-amber-300 bg-amber-50 text-amber-700">مهم</Badge>}
        />
        <div className="card-pad space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <p>
              استخدم أحد هذه الرموز للدخول إذا فقدت هاتفك. كل رمز يُستهلك مرة واحدة، ولن تتمكن من رؤية القائمة مرة أخرى.
            </p>
          </div>
          <div dir="ltr" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {recoveryCodes.map((item) => (
              <code key={item} className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-center text-sm font-bold tracking-wider text-ink-800">
                {item}
              </code>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={copyCodes}>
              <Copy size={15} /> نسخ الرموز
            </button>
            <button type="button" className="btn-secondary" onClick={downloadCodes}>
              <Download size={15} /> تنزيل ملفًا
            </button>
            <button type="button" className="btn-primary" onClick={() => setRecoveryCodes(null)}>
              لقد حفظتها
            </button>
          </div>
        </div>
      </Card>
    );
  }

  if (isLoading || !data) {
    return (
      <Card className="mb-4">
        <CardHeader title="التحقق بخطوتين" subtitle="جارٍ قراءة حالة الحساب…" icon={<ShieldCheck size={18} />} />
        <div className="card-pad text-sm text-ink-500">جارٍ التحميل…</div>
      </Card>
    );
  }

  const codeField =
    mode === 'disable' ? 'رمز التحقق أو رمز الاسترداد' : 'رمز التحقق الحالي';

  return (
    <Card className="mb-4">
      <CardHeader
        title="التحقق بخطوتين (2FA)"
        subtitle="طبقة حماية إضافية للحسابات الإدارية عبر تطبيق مصادقة"
        icon={<ShieldCheck size={18} />}
        action={
          <Badge
            className={
              data.enabled
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-ink-200 bg-ink-50 text-ink-600'
            }
          >
            {data.enabled ? 'مفعّل' : 'غير مفعّل'}
          </Badge>
        }
      />
      <div className="card-pad space-y-4">
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>
        ) : null}

        {mode === 'setup' && setup ? (
          <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
            <div className="rounded-xl border border-ink-200 bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qrDataUrl} alt="رمز QR لإعداد التحقق بخطوتين" className="mx-auto h-auto w-full max-w-[240px]" />
            </div>
            <div className="space-y-3">
              <p className="text-xs leading-relaxed text-ink-600">
                امسح الرمز بتطبيق Google Authenticator أو Authy أو 1Password، ثم أدخل الرمز الظاهر لتأكيد التفعيل.
              </p>
              <div>
                <span className="label">أو أدخل المفتاح يدويًا</span>
                <code dir="ltr" className="block break-all rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-xs font-bold tracking-wider text-ink-800">
                  {setup.secret}
                </code>
              </div>
              <form onSubmit={confirmEnable} className="space-y-3">
                <Field label="رمز التحقق" required hint="6 أرقام من تطبيق المصادقة">
                  <input
                    className="input text-center text-lg tracking-[0.3em]"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="123456"
                    required
                    dir="ltr"
                  />
                </Field>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className="btn-primary" disabled={busy}>
                    {busy ? 'جارٍ التحقق…' : 'تأكيد وتفعيل'}
                  </button>
                  <button type="button" className="btn-secondary" onClick={resetForm} disabled={busy}>
                    إلغاء
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : mode === 'disable' || mode === 'regenerate' ? (
          <form onSubmit={mode === 'disable' ? confirmDisable : confirmRegenerate} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs leading-relaxed text-red-700">
              {mode === 'disable'
                ? 'إيقاف التحقق بخطوتين يزيل طبقة الحماية الإضافية عن حسابك. ستحتاج إلى كلمة المرور ورمز حالي للتأكيد.'
                : 'تجديد الرموز يُبطل كل الرموز القديمة فورًا. ستحتاج إلى كلمة المرور ورمز TOTP الحالي.'}
            </div>
            <Field label="كلمة المرور الحالية" required>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                dir="ltr"
              />
            </Field>
            <Field label={codeField} required hint={mode === 'disable' ? 'يمكنك استخدام رمز استرداد بدلًا من رمز التطبيق' : '6 أرقام من التطبيق'}>
              <input
                className="input text-center tracking-[0.3em]"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={20}
                required
                dir="ltr"
              />
            </Field>
            <div className="sm:col-span-2 flex flex-wrap gap-2">
              <button type="submit" className={mode === 'disable' ? 'btn-danger' : 'btn-primary'} disabled={busy}>
                {busy ? 'جارٍ التنفيذ…' : mode === 'disable' ? 'تأكيد الإيقاف' : 'تجديد الرموز'}
              </button>
              <button type="button" className="btn-secondary" onClick={resetForm} disabled={busy}>
                إلغاء
              </button>
            </div>
          </form>
        ) : (
          <>
            {data.recommended && !data.enabled ? (
              <div className="flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 p-3 text-xs leading-relaxed text-brand-800">
                <ShieldCheck size={16} className="mt-0.5 shrink-0" />
                <p>يُنصح بتفعيل التحقق بخطوتين لحسابات المالك والمدير لحماية بيانات المركز والصلاحيات الحساسة.</p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink-800">
                  {data.enabled ? 'الحساب محمي بالتحقق بخطوتين' : 'أضف طبقة حماية ثانية لحسابك'}
                </p>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-500">
                  {data.enabled
                    ? 'سيُطلب رمز من تطبيق المصادقة في كل تسجيل دخول. رموز الاسترداد تسمح بالدخول عند فقدان الهاتف.'
                    : 'بعد التفعيل سيُطلب رمز متغيّر كل 30 ثانية من تطبيق المصادقة، حتى لو عرف أحد كلمة المرور.'}
                </p>
                {data.enabled ? (
                  <p className="mt-2 text-[11px] text-ink-500">
                    {data.enabledAt ? `مفعّل منذ ${formatDateTime(data.enabledAt)} · ` : ''}
                    رموز الاسترداد المتبقية: <span className="num font-bold text-ink-700">{data.recoveryCodesRemaining}</span>
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                {data.enabled ? (
                  <>
                    <button type="button" className="btn-secondary" onClick={() => { setMode('regenerate'); setError(null); }}>
                      <RefreshCw size={15} /> تجديد رموز الاسترداد
                    </button>
                    <button type="button" className="btn-danger" onClick={() => { setMode('disable'); setError(null); }}>
                      <ShieldOff size={15} /> إيقاف
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn-primary" onClick={startSetup} disabled={busy}>
                    <ShieldCheck size={15} /> {busy ? 'جارٍ التحضير…' : 'تفعيل التحقق بخطوتين'}
                  </button>
                )}
              </div>
            </div>

            {data.enabled && data.recoveryCodesRemaining <= 2 ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                رموز الاسترداد المتبقية {data.recoveryCodesRemaining} فقط — جدّدها الآن لضمان عدم فقدان الوصول.
              </div>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}
