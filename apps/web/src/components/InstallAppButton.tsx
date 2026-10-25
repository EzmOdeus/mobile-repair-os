'use client';

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * زر تثبيت PWA. يظهر فقط عندما يوفر المتصفح حدث beforeinstallprompt
 * (أي عند تحقق شروط التثبيت)، ويختفي داخل النافذة المثبتة.
 */
export function InstallAppButton({ compact = false }: { compact?: boolean }) {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

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

  if (installed || !promptEvent) return null;

  const install = async () => {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice.outcome === 'accepted') setInstalled(true);
    setPromptEvent(null);
  };

  return (
    <button
      type="button"
      onClick={install}
      className={compact ? 'btn-ghost px-2 text-xs' : 'btn-secondary w-full justify-start text-xs'}
      title="تثبيت التطبيق على الجهاز"
    >
      <Download size={15} />
      {compact ? 'تثبيت' : 'تثبيت التطبيق على الجهاز'}
    </button>
  );
}
