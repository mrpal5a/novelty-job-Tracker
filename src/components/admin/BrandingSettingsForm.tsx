'use client';
// src/components/admin/BrandingSettingsForm.tsx
// The self-service form behind /admin/settings. Two independent saves —
// text fields via PATCH /api/settings/branding, logo via a separate
// POST /api/settings/branding/logo (multipart) — so uploading a new logo
// doesn't require re-typing the address, and vice versa.

import { useState } from 'react';
import Image from 'next/image';
import toast from 'react-hot-toast';
import { Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import type { Branding } from '@/lib/branding-utils';

const inputCls = cn(
  'w-full px-3 py-2 rounded-lg text-sm bg-[var(--field-bg)] border border-[var(--field-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

function Field({
  label, hint, value, onChange, type = 'text', multiline = false,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  multiline?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-[var(--glass-muted)] mb-1">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          className={cn(inputCls, 'font-mono resize-y')}
        />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
        />
      )}
      {hint && <p className="text-[11px] text-[var(--glass-muted)] mt-1">{hint}</p>}
    </div>
  );
}

export default function BrandingSettingsForm({ initial }: { initial: Branding }) {
  const [name, setName]                     = useState(initial.name);
  const [shortName, setShortName]           = useState(initial.shortName);
  const [productionName, setProductionName] = useState(initial.productionName);
  const [address, setAddress]               = useState(initial.address);
  const [supportEmail, setSupportEmail]     = useState(initial.supportEmail);
  const [returnAddress, setReturnAddress]   = useState(initial.returnAddress);
  const [logoUrl, setLogoUrl]               = useState(initial.logoUrl);

  const [saving, setSaving]         = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/settings/branding', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, shortName, productionName, address, supportEmail, returnAddress }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? 'Failed to save settings');
        return;
      }
      toast.success('Settings saved');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setUploadingLogo(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/settings/branding/logo', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error ?? 'Failed to upload logo');
        return;
      }
      setLogoUrl(data.logoUrl);
      toast.success('Logo updated');
    } catch {
      toast.error('Network error. Please try again.');
    } finally {
      setUploadingLogo(false);
    }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="glass rounded-xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[var(--glass-ink)]">Logo</h2>
        <div className="flex items-center gap-4">
          <div className="h-16 w-40 rounded-lg border border-[var(--field-border)] bg-white flex items-center justify-center overflow-hidden">
            <Image
              src={logoUrl || '/company-logo.png'}
              alt={shortName}
              width={140}
              height={56}
              className="h-auto w-auto max-h-14 max-w-[130px] object-contain"
            />
          </div>
          <label className={cn(
            'inline-flex items-center gap-1.5 min-h-11 px-4 rounded-lg text-sm font-medium cursor-pointer',
            'bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)]',
            'hover:bg-black/[0.04]',
            uploadingLogo && 'opacity-60 pointer-events-none',
          )}>
            <Upload className="h-4 w-4" aria-hidden="true" />
            {uploadingLogo ? 'Uploading…' : 'Upload new logo'}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={handleLogoChange} />
          </label>
        </div>
        <p className="text-[11px] text-[var(--glass-muted)]">PNG, JPEG, WebP, or SVG. Under 2 MB.</p>
      </div>

      <div className="glass rounded-xl p-6 space-y-4">
        <h2 className="text-sm font-semibold text-[var(--glass-ink)]">Company details</h2>

        <Field
          label="Company name"
          hint="Shown on the login page, tracking portal, and email headers/footers."
          value={name}
          onChange={setName}
        />
        <Field
          label="Short name"
          hint="Used in page titles, the logo's alt text, and the delivery-scene truck livery."
          value={shortName}
          onChange={setShortName}
        />
        <Field
          label="Production / trade name"
          hint="All-caps name printed on physical roll slips and box slips — can differ from the company name above."
          value={productionName}
          onChange={setProductionName}
        />
        <Field
          label="Address"
          hint="One line, shown in the tracking portal footer and email signatures."
          value={address}
          onChange={setAddress}
        />
        <Field
          label="Support email"
          hint="Shown on the public tracking portal for customers who can't find their order."
          type="email"
          value={supportEmail}
          onChange={setSupportEmail}
        />
        <Field
          label="Factory return address"
          hint="Pre-filled as the sender on the courier address slip. One line per row."
          value={returnAddress}
          onChange={setReturnAddress}
          multiline
        />

        <div className="pt-2">
          <Button intent="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
