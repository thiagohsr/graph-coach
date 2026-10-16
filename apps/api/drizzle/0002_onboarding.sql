ALTER TABLE "users" ADD COLUMN "onboarded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_outcome" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_onboarding_outcome_check" CHECK ("users"."onboarding_outcome" in ('completed', 'skipped'));
--> statement-breakpoint
-- Backfill (spec 009, reconciliation O4): accounts that exist now are already onboarded, except the seeded Demo Learner, who stays fresh so the demo can show the carousel.
UPDATE "public"."users" SET "onboarded_at" = now(), "onboarding_outcome" = 'completed' WHERE "email" <> 'learner@example.test';
