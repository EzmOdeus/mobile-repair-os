"use client";

import { useState } from "react";
import useSWR, { mutate } from "swr";
import Link from "next/link";
import { Search, Smartphone, AlertTriangle, Plus } from "lucide-react";
import { api, errorMessage, fetcher, qs } from "@/lib/api";
import { formatDateTime, maskImei, timeAgo } from "@/lib/format";
import {
  Badge,
  Card,
  EmptyState,
  LoadingBlock,
  PageHeader,
} from "@/components/ui";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/lib/auth";

interface DeviceRow {
  _id: string;
  brand: string;
  model: string;
  color?: string;
  storage?: string;
  imei?: string;
  category?: string;
  conditionOnIntake?: string;
  createdAt: string;
  customerId?: { fullName: string; phone: string } | null;
  passport?: {
    totalRepairs?: number;
    openTickets?: number;
    warrantyClaims?: number;
    riskFlags?: string[];
    lastServiceAt?: string | null;
  };
}

const CONDITION_LABELS: Record<string, string> = {
  new: "جديد",
  excellent: "ممتاز",
  good: "جيد",
  fair: "مقبول",
  poor: "ضعيف",
  damaged: "تالف",
};

export default function DevicesPage() {
  const toast = useToast();
  const { hasPermission } = useAuth();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [onlyProblematic, setOnlyProblematic] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [deviceForm, setDeviceForm] = useState({ brand: "", model: "", color: "", storage: "", imei: "", conditionOnIntake: "good" });
  const [isSaving, setIsSaving] = useState(false);

  const closeCreate = () => {
    setCreateOpen(false);
    setCustomerSearch("");
    setCustomerId("");
    setDeviceForm({ brand: "", model: "", color: "", storage: "", imei: "", conditionOnIntake: "good" });
  };

  const { data: customers } = useSWR<{ items: { _id: string; fullName: string; phone: string }[] }>(
    createOpen ? `/customers${qs({ q: customerSearch || undefined, limit: 50 })}` : null,
    fetcher,
  );

  const key = onlyProblematic
    ? "/devices/problematic"
    : `/devices${qs({ q: search || undefined, page, limit: 20 })}`;

  const { data, error, isLoading } = useSWR<{
    items?: DeviceRow[];
    devices?: DeviceRow[];
    meta?: { total: number; page: number; pages: number };
    count?: number;
  }>(key, fetcher);

  const rows = onlyProblematic ? (data?.devices ?? []) : (data?.items ?? []);

  return (
    <div>
      <PageHeader
        title="الأجهزة"
        subtitle={
          onlyProblematic
            ? `${rows.length} جهاز يحتاج متابعة`
            : `${data?.meta?.total ?? 0} جهاز مسجل`
        }
        actions={hasPermission("device:create") ? (
          <button type="button" className="btn-primary" onClick={() => setCreateOpen(true)}>
            <Plus size={16} /> جهاز جديد
          </button>
        ) : undefined}
      />
      <Card className="mb-4 card-pad">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="relative sm:col-span-2">
            <Search
              size={16}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400"
            />
            <input
              className="input pr-9"
              placeholder="ابحث بالموديل أو IMEI أو السيريال…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              disabled={onlyProblematic}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-ink-300"
              checked={onlyProblematic}
              onChange={(e) => setOnlyProblematic(e.target.checked)}
            />
            الأجهزة التي تحتاج متابعة (أعطال متكررة/عوائد ضمان)
          </label>
        </div>
      </Card>

      {error ? (
        <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorMessage(error)}
        </Card>
      ) : null}

      <Card>
        {isLoading ? (
          <LoadingBlock rows={6} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>الجهاز</th>
                  <th>العميل</th>
                  <th>IMEI</th>
                  <th>الحالة عند الاستلام</th>
                  <th>سجل الإصلاح</th>
                  <th>آخر خدمة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.length ? (
                  rows.map((device) => (
                    <tr key={device._id}>
                      <td>
                        <p className="font-medium text-ink-800">
                          {device.brand} {device.model}
                        </p>
                        <p className="text-xs text-ink-500">
                          {[device.color, device.storage]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </td>
                      <td className="text-xs">
                        {device.customerId ? (
                          <>
                            <p className="text-ink-700">
                              {device.customerId.fullName}
                            </p>
                            <p className="text-ink-400" dir="ltr">
                              {device.customerId.phone}
                            </p>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="num text-xs" dir="ltr">
                        {maskImei(device.imei)}
                      </td>
                      <td className="text-xs">
                        {CONDITION_LABELS[device.conditionOnIntake ?? "good"] ??
                          "—"}
                      </td>
                      <td className="text-xs">
                        <span className="num font-bold text-ink-700">
                          {device.passport?.totalRepairs ?? 0}
                        </span>{" "}
                        إصلاح
                        {device.passport?.openTickets ? (
                          <Badge className="ms-2 border-amber-200 bg-amber-50 text-amber-800">
                            {device.passport.openTickets} مفتوح
                          </Badge>
                        ) : null}
                        {device.passport?.warrantyClaims ? (
                          <Badge className="ms-1 border-red-200 bg-red-50 text-red-700">
                            {device.passport.warrantyClaims} ضمان
                          </Badge>
                        ) : null}
                      </td>
                      <td className="text-xs text-ink-500">
                        {device.passport?.lastServiceAt
                          ? timeAgo(device.passport.lastServiceAt)
                          : "—"}
                      </td>
                      <td>
                        <Link
                          href={`/devices/${device._id}`}
                          className="btn-ghost text-xs"
                        >
                          جواز الجهاز
                        </Link>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState
                        title="لا توجد أجهزة"
                        icon={<Smartphone size={22} />}
                      />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {!onlyProblematic && data?.meta && data.meta.pages > 1 ? (
          <div className="flex items-center justify-between border-t border-ink-100 px-4 py-3 text-xs text-ink-600">
            <span>
              صفحة {data.meta.page} من {data.meta.pages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn-secondary text-xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
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

      {onlyProblematic && rows.length ? (
        <p className="mt-3 flex items-center gap-1.5 text-xs text-amber-700">
          <AlertTriangle size={14} /> هذه الأجهزة لديها 3 إصلاحات أو أكثر، أو
          claim ضمان، أو آثار سوائل.
        </p>
      ) : null}

      <p className="mt-4 text-[11px] text-ink-400">
        آخر تحديث: {formatDateTime(new Date())}
      </p>

      <Modal
        open={createOpen}
        onClose={closeCreate}
        title="تسجيل جهاز جديد"
        subtitle="اربط الجهاز بملف العميل ليظهر عند إنشاء تذكرة صيانة"
        footer={
          <>
            <button type="button" className="btn-secondary" onClick={closeCreate} disabled={isSaving}>إلغاء</button>
            <button
              type="button"
              className="btn-primary"
              disabled={isSaving || !customerId || !deviceForm.brand.trim() || !deviceForm.model.trim()}
              onClick={async () => {
                setIsSaving(true);
                try {
                  await api.post("/devices", { ...deviceForm, customerId });
                  await mutate((key) => typeof key === "string" && (key.startsWith("/devices") || key.startsWith("/customers")));
                  toast.success("تم تسجيل الجهاز بنجاح");
                  closeCreate();
                } catch (err) {
                  toast.error(errorMessage(err));
                } finally {
                  setIsSaving(false);
                }
              }}
            >
              {isSaving ? "جارٍ الحفظ…" : "حفظ الجهاز"}
            </button>
          </>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2">
            <span className="label">ابحث عن العميل بالاسم أو رقم الهاتف *</span>
            <input className="input" value={customerSearch} onChange={(event) => { setCustomerSearch(event.target.value); setCustomerId(""); }} placeholder="اسم العميل أو 01xxxxxxxxx" />
          </label>
          <label className="block sm:col-span-2">
            <span className="label">العميل *</span>
            <select className="input" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">اختر العميل</option>
              {(customers?.items ?? []).map((customer) => (
                <option key={customer._id} value={customer._id}>{customer.fullName} — {customer.phone}</option>
              ))}
            </select>
            {customerSearch && !customers?.items.length ? <span className="mt-1 block text-xs text-ink-500">لا يوجد عميل مطابق. سجّل العميل أولًا من صفحة العملاء.</span> : null}
          </label>
          <label className="block"><span className="label">الماركة *</span><input className="input" value={deviceForm.brand} onChange={(event) => setDeviceForm({ ...deviceForm, brand: event.target.value })} placeholder="Samsung" /></label>
          <label className="block"><span className="label">الموديل *</span><input className="input" value={deviceForm.model} onChange={(event) => setDeviceForm({ ...deviceForm, model: event.target.value })} placeholder="Galaxy A15" /></label>
          <label className="block"><span className="label">اللون</span><input className="input" value={deviceForm.color} onChange={(event) => setDeviceForm({ ...deviceForm, color: event.target.value })} /></label>
          <label className="block"><span className="label">المساحة</span><input className="input" value={deviceForm.storage} onChange={(event) => setDeviceForm({ ...deviceForm, storage: event.target.value })} placeholder="128GB" /></label>
          <label className="block sm:col-span-2"><span className="label">IMEI / السيريال</span><input className="input" value={deviceForm.imei} onChange={(event) => setDeviceForm({ ...deviceForm, imei: event.target.value })} dir="ltr" /></label>
          <label className="block sm:col-span-2"><span className="label">حالة الجهاز</span><select className="input" value={deviceForm.conditionOnIntake} onChange={(event) => setDeviceForm({ ...deviceForm, conditionOnIntake: event.target.value })}><option value="new">جديد</option><option value="excellent">ممتاز</option><option value="good">جيد</option><option value="fair">مقبول</option><option value="poor">ضعيف</option><option value="damaged">تالف</option></select></label>
        </div>
      </Modal>
    </div>
  );
}
