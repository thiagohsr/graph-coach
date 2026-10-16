import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '~/lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-semibold whitespace-nowrap transition-colors duration-(--duration-fast) ease-(--ease-standard) outline-none active:translate-y-px motion-reduce:active:translate-y-0 disabled:cursor-not-allowed focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover active:bg-primary-hover disabled:hover:bg-primary',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/85',
        outline: 'border border-input bg-card text-foreground hover:bg-accent active:bg-muted',
        secondary: 'border border-input bg-secondary text-secondary-foreground hover:bg-accent active:bg-muted',
        ghost: 'text-text-secondary hover:bg-accent hover:text-foreground active:bg-muted',
        link: 'text-primary underline underline-offset-4 hover:text-primary-hover',
      },
      size: {
        default: 'h-10 px-4 py-2 has-[>svg]:px-3 max-sm:h-11',
        sm: 'h-9 gap-1.5 px-3 has-[>svg]:px-2.5 max-sm:h-11',
        lg: 'h-11 px-6 has-[>svg]:px-4',
        icon: 'size-10 max-sm:size-11',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}

export { Button, buttonVariants };
