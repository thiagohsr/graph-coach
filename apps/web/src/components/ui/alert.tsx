import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '~/lib/utils';

const alertVariants = cva('relative w-full rounded-md border px-4 py-3 text-sm', {
  variants: {
    variant: {
      default: 'border-info bg-info-soft text-foreground',
      info: 'border-info bg-info-soft text-foreground',
      warning: 'border-warning bg-warning-soft text-foreground',
      success: 'border-success bg-success-soft text-foreground',
      destructive: 'border-danger bg-danger-soft text-danger',
    },
  },
  defaultVariants: { variant: 'default' },
});

function Alert({ className, variant, ...props }: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return <div data-slot="alert" role="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-title" className={cn('mb-1 font-semibold', className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="alert-description" className={cn('text-sm [&_p]:leading-relaxed', className)} {...props} />;
}

export { Alert, AlertDescription, AlertTitle };
