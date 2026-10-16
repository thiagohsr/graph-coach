import * as React from 'react';
import { cn } from '~/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex min-h-24 w-full rounded-md border border-input bg-card px-3 py-2 text-base outline-none transition-colors duration-(--duration-fast) disabled:bg-muted placeholder:text-muted-foreground focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 hover:border-muted-foreground aria-invalid:border-[1.5px] aria-invalid:border-danger md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
