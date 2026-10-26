'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * زر تثبيت PWA. يفتح نافذة التثبيت الأصلية عند دعمها، وإرشادات التثبيت اليدوي
 * في المتصفحات التي لا توفر beforeinstallprompt، ويختفي داخل النافذة المثبتة.
 */
export function InstallAppButton({ compact = false }: { compact?: boolean }) {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [instructions, setInstructions] = useState('');

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  const install = async () => {
    if (!promptEvent) {
      const userAgent = window.navigator.userAgent;
      setInstructions(
        /iPhone|iPad|iPod/i.test(userAgent)
          ? 'اضغط زر المشاركة في Safari، ثم اختر «إضافة إلى الشاشة الرئيسية».'
          : /Android/i.test(userAgent)
            ? 'افتح قائمة المتصفح ⋮، ثم اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».'
            : 'افتح قائمة المتصفح، ثم اختر «تثبيت التطبيق» أو استخدم أيقونة التثبيت بجانب شريط العنوان.',
      );
      setShowInstructions(true);
      return;
    }

    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setPromptEvent(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={install}
        className={compact ? 'btn-ghost px-2 text-xs' : 'btn-secondary w-full justify-start text-xs'}
        title="تثبيت التطبيق على الجهاز"
      >
        <Download size={15} />
        {compact ? 'تثبيت' : 'تثبيت التطبيق على الجهاز'}
      </button>
      {showInstructions ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-ink-900/50 p-4"
          onClick={() => setShowInstructions(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="pwa-install-title"
            className="w-full max-w-sm rounded-2xl bg-white p-5 text-right shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="pwa-install-title" className="text-base font-bold text-ink-900">
              تثبيت Mobile Repair OS
            </h2>
            <p className="mt-2 text-sm leading-7 text-ink-600">{instructions}</p>
            <button
              type="button"
              className="btn-primary mt-4 w-full justify-center"
              onClick={() => setShowInstructions(false)}
            >
              فهمت
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
