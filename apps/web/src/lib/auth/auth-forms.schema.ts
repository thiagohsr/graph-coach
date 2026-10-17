import { z } from 'zod';

// Validation shared by the card (before sending) and the server functions (before any Cognito call).
// Messages are ours and never echo the input.

export const EMAIL_MESSAGE = 'Enter a valid e-mail address.';
export const PASSWORD_MESSAGE =
  'At least 10 characters, with a lower-case letter, an upper-case letter, and a number.';
export const PASSWORD_SPACE_MESSAGE = "Passwords can't start or end with a space.";
export const SIGN_IN_PASSWORD_MESSAGE = 'Enter your password.';
export const CODE_MESSAGE = 'Enter the 6-digit code.';

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 64;

/** The rules the user pool enforces, as the checklist shows them. */
export const PASSWORD_RULES: readonly {
  id: string;
  label: string;
  test: (p: string) => boolean;
}[] = [
  {
    id: 'length',
    label: 'At least 10 characters',
    test: (p) => p.length >= PASSWORD_MIN && p.length <= PASSWORD_MAX,
  },
  { id: 'lower', label: 'A lower-case letter', test: (p) => /[a-z]/.test(p) },
  { id: 'upper', label: 'An upper-case letter', test: (p) => /[A-Z]/.test(p) },
  { id: 'digit', label: 'A number', test: (p) => /[0-9]/.test(p) },
];

export function passwordMeetsRules(p: string): boolean {
  return PASSWORD_RULES.every((r) => r.test(p));
}

export const EmailSchema = z
  .string({ message: EMAIL_MESSAGE })
  .trim()
  .toLowerCase()
  .min(3, EMAIL_MESSAGE)
  .max(254, EMAIL_MESSAGE)
  .email(EMAIL_MESSAGE);

export const NewPasswordSchema = z
  .string({ message: PASSWORD_MESSAGE })
  .max(PASSWORD_MAX, PASSWORD_MESSAGE)
  .superRefine((v, ctx) => {
    if (v !== v.trim()) ctx.addIssue({ code: 'custom', message: PASSWORD_SPACE_MESSAGE });
    else if (!passwordMeetsRules(v)) ctx.addIssue({ code: 'custom', message: PASSWORD_MESSAGE });
  });

/** Sign-in does not apply the complexity rules: an old password stays usable if the policy changed. */
export const SignInPasswordSchema = z
  .string({ message: SIGN_IN_PASSWORD_MESSAGE })
  .min(1, SIGN_IN_PASSWORD_MESSAGE)
  .max(PASSWORD_MAX, SIGN_IN_PASSWORD_MESSAGE);

export const CodeSchema = z
  .string({ message: CODE_MESSAGE })
  .transform((v) => v.replace(/\D/g, ''))
  .pipe(z.string().length(6, CODE_MESSAGE));

export const GuardSchema = z.object({
  website: z.string().max(200),
  startedAt: z.string().max(600),
});

export const RedirectSchema = z.string().max(2000).optional();

export const SignUpInputSchema = z.object({
  email: EmailSchema,
  password: NewPasswordSchema,
  guard: GuardSchema,
});
export const ConfirmSignUpInputSchema = z.object({
  email: EmailSchema,
  code: CodeSchema,
  password: z.string().max(PASSWORD_MAX).optional(),
  redirect: RedirectSchema,
});
export const ResendInputSchema = z.object({ email: EmailSchema, guard: GuardSchema.optional() });
export const SignInInputSchema = z.object({
  email: EmailSchema,
  password: SignInPasswordSchema,
  redirect: RedirectSchema,
});
export const ForgotInputSchema = z.object({ email: EmailSchema, guard: GuardSchema });
export const ConfirmForgotInputSchema = z.object({
  email: EmailSchema,
  code: CodeSchema,
  newPassword: NewPasswordSchema,
});

/** First message per field of a failed parse. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    out[key] ??= issue.message;
  }
  return out;
}

export type SignUpInput = z.input<typeof SignUpInputSchema>;
export type ConfirmSignUpInput = z.input<typeof ConfirmSignUpInputSchema>;
export type ResendInput = z.input<typeof ResendInputSchema>;
export type SignInInput = z.input<typeof SignInInputSchema>;
export type ForgotInput = z.input<typeof ForgotInputSchema>;
export type ConfirmForgotInput = z.input<typeof ConfirmForgotInputSchema>;
