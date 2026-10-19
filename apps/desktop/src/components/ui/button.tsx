import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
const variants = cva('inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:pointer-events-none disabled:opacity-50 px-4 py-2', {
  variants: { variant: { default: 'bg-blue-600 text-white hover:bg-blue-700', outline: 'border border-border bg-panel hover:bg-muted', ghost: 'hover:bg-muted text-subtle', destructive: 'bg-red-600 text-white hover:bg-red-700' } }, defaultVariants: { variant: 'default' },
});
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof variants> { asChild?: boolean }
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, asChild = false, ...props }, ref) => {
  const Component = asChild ? Slot : 'button';
  return <Component className={cn(variants({ variant }), className)} ref={ref} {...props} />;
});
Button.displayName = 'Button';