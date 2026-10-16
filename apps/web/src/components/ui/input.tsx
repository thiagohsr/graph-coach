import * as React from 'react';
import { cn } from '~/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-10 max-sm:h-11 w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-base outline-none transition-colors duration-(--duration-fast) disabled:bg-muted placeholder:text-muted-foreground focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 hover:border-muted-foreground aria-invalid:border-[1.5px] aria-invalid:border-danger md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
