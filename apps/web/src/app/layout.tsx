import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { ToastProvider } from '@/components/ui/Toast';

export const metadata: Metadata = {
  title: 'Mobile Repair OS — نظام إدارة مراكز صيانة الموبايل',
  description:
    'منصة تشغيل متخصصة لمراكز صيانة الهواتف: دورة حياة الجهاز، التوثيق الرقمي، التشخيص، الفحص، الضمان، وتحليلات القطع.',
  applicationName: 'Mobile Repair OS',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0f766e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>
        <ToastProvider>
          <AuthProvider>{children}</AuthProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
