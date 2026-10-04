'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Plus, Search, Users, Phone } from 'lucide-react';
import { api, errorMessage, fetcher, qs } from '@/lib/api';
import { formatDateTime, formatMoney, timeAgo } from '@/lib/format';
import { Badge, Card, EmptyState, Field, LoadingBlock, PageHeader } from '@/components/ui';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/lib/auth';

interface Customer {
  _id: string;
  code?: string;
  fullName: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  type: string;
  companyName?: string;
  tags?: string[];
  isBlacklisted?: boolean;
  stats?: { totalTickets?: number; openTickets?: number; totalSpentEgp?: number; lastVisitAt?: string | null };
  createdAt: string;
}

export default function CustomersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();
  const { hasPermission } = useAuth();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  const key = `/customers${qs({ q: search || undefined, type: typeFilter || undefined, page, limit: 20 })}`;
  const { data, error, isLoading } = useSWR<{ items: Customer[]; meta: { total: number; page: number; pages: number } }>(
    key,
    fetcher,
  );

  return (
    <div>
      <PageHeader
        title="العملاء"
        subtitle={`${data?.meta.total ?? 0} عميل مسجل`}
        actions={
          hasPermission('customer:create') ? (
            <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
              <Plus size={16} /> عميل جديد
            </button>
          ) : null
        }
      />

      <Card className="mb-4 card-pad">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="relative sm:col-span-2">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              className="input pr-9"
              placeholder="ابحث بالاسم أو رقم الهاتف أو كود العميل…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <select className="input" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">كل الأنواع</option>
            <option value="individual">أفراد</option>
            <option value="company">شركات</option>
            <option value="reseller">تجار</option>
          </select>
        </div>
      </Card>

      {error ? <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMessage(error)}</Card> : null}

      <Card>
        {isLoading ? (
          <LoadingBlock rows={6} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>العميل</th>
                  <th>الهاتف</th>
                  <th>النوع</th>
                  <th>تذاكر</th>
                  <th>إجمالي المصروف</th>
                  <th>آخر زيارة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data?.items?.length ? (
                  data.items.map((customer) => (
                    <tr key={customer._id} className="cursor-pointer" onClick={() => router.push(`/customers/${customer._id}`)}>
                      <td>
                        <p className="font-medium text-ink-800">{customer.fullName}</p>
                        {customer.companyName ? <p className="text-xs text-ink-500">{customer.companyName}</p> : null}
                        {customer.isBlacklisted ? (
                          <Badge className="mt-1 border-red-200 bg-red-50 text-red-700">محظور</Badge>
                        ) : null}
                      </td>
                      <td className="num text-xs" dir="ltr">
                        {customer.phone}
                      </td>
                      <td className="text-xs">
                        {customer.type === 'company' ? 'شركة' : customer.type === 'reseller' ? 'تاجر' : 'فرد'}
                      </td>
                      <td className="num text-xs">
                        {customer.stats?.openTickets ? (
                          <span className="font-bold text-amber-700">{customer.stats.openTickets} مفتوحة</span>
                        ) : null}
                        <span className="block text-ink-400">من {customer.stats?.totalTickets ?? 0}</span>
                      </td>
                      <td className="num text-xs font-medium">{formatMoney(customer.stats?.totalSpentEgp ?? 0)}</td>
                      <td className="text-xs text-ink-500">
                        {customer.stats?.lastVisitAt ? timeAgo(customer.stats.lastVisitAt) : '—'}
                      </td>
                      <td>
                        <Link
                          href={`/customers/${customer._id}`}
                          className="btn-ghost text-xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          التفاصيل
                        </Link>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState title="لا يوجد عملاء" description="ابدأ بإضافة أول عميل" icon={<Users size={22} />} />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {data && data.meta.pages > 1 ? (
          <div className="flex items-center justify-between border-t border-ink-100 px-4 py-3 text-xs text-ink-600">
            <span>
              صفحة {data.meta.page} من {data.meta.pages} · {data.meta.total} عميل
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                السابق
              </button>
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={page >= data.meta.pages}
                onClick={() => setPage((p) => p + 1)}
              >
                التالي
              </button>
            </div>
          </div>
        ) : null}
      </Card>

      <CreateCustomerModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={async (id) => {
          setCreateOpen(false);
          await mutate(key);
          toast.success('تم إضافة العميل');
          router.push(`/customers/${id}`);
        }}
      />

      {searchParams.get('new') === '1' ? null : null}
    </div>
  );
}

function CreateCustomerModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const toast = useToast();
  const [form, setForm] = useState({
    fullName: '',
    phone: '',
    phoneAlt: '',
    email: '',
    type: 'individual',
    companyName: '',
    governorate: '',
    area: '',
    notes: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async () => {
    if (!form.fullName.trim() || !form.phone.trim()) {
      toast.error('الاسم ورقم الهاتف مطلوبان');
      return;
    }
    setIsSubmitting(true);
    try {
      const created = await api.post<{ _id: string }>('/customers', {
        fullName: form.fullName,
        phone: form.phone,
        phoneAlt: form.phoneAlt,
        email: form.email || undefined,
        type: form.type,
        companyName: form.companyName,
        address: { governorate: form.governorate, area: form.area },
        notes: form.notes,
      });
      onCreated(created._id);
      setForm({
        fullName: '',
        phone: '',
        phoneAlt: '',
        email: '',
        type: 'individual',
        companyName: '',
        governorate: '',
        area: '',
        notes: '',
      });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="عميل جديد"
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="button" className="btn-primary" onClick={submit} disabled={isSubmitting}>
            {isSubmitting ? 'جارٍ الحفظ…' : 'حفظ'}
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="الاسم الكامل" required>
          <input className="input" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
        </Field>
        <Field label="رقم الموبايل" required>
          <input
            className="input"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            dir="ltr"
            placeholder="01012345678"
          />
        </Field>
        <Field label="رقم بديل">
          <input className="input" value={form.phoneAlt} onChange={(e) => setForm({ ...form, phoneAlt: e.target.value })} dir="ltr" />
        </Field>
        <Field label="البريد الإلكتروني">
          <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" />
        </Field>
        <Field label="نوع العميل">
          <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="individual">فرد</option>
            <option value="company">شركة</option>
            <option value="reseller">تاجر</option>
          </select>
        </Field>
        <Field label="اسم الشركة">
          <input className="input" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
        </Field>
        <Field label="المحافظة">
          <input className="input" value={form.governorate} onChange={(e) => setForm({ ...form, governorate: e.target.value })} />
        </Field>
        <Field label="المنطقة">
          <input className="input" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="ملاحظات">
            <textarea className="input min-h-[3rem]" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

void Phone;
void formatDateTime;
