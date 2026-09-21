'use client';
// src/components/brand/Logo.tsx
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useBranding } from '@/components/brand/BrandingProvider';

type LogoProps = {
  /** Render white (for dark/green backgrounds). */
  onDark?: boolean;
  width?: number;
  height?: number;
  priority?: boolean;
  className?: string;
};

export function Logo({ onDark = false, width = 150, height = 47, priority = false, className }: LogoProps) {
  const branding = useBranding();
  const image = (
    <Image
      src={branding.logoUrl || '/company-logo.png'}
      alt={branding.shortName}
      width={width}
      height={height}
      priority={priority}
      className={cn('h-auto w-auto object-contain', className)}
    />
  );
  // Uploaded logos aren't guaranteed to have a transparent background, so on
  // dark headers we seat the logo on a light plate rather than inverting its
  // colors — an invert filter turns any opaque logo into a solid white box.
  if (!onDark) return image;
  return <span className="inline-flex items-center rounded-md bg-white/95 px-2 py-1">{image}</span>;
}
