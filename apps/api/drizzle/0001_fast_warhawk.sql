CREATE TABLE "access_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"label" varchar(80) NOT NULL,
	"source_runs" integer DEFAULT 0 NOT NULL,
	"prompt_runs" integer DEFAULT 0 NOT NULL,
	"lift_days" integer DEFAULT 0 NOT NULL,
	"max_redemptions" integer NOT NULL,
	"redeemed_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"disabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "access_codes_code_hash_unique" UNIQUE("code_hash"),
	CONSTRAINT "access_codes_source_runs_check" CHECK ("access_codes"."source_runs" >= 0),
	CONSTRAINT "access_codes_prompt_runs_check" CHECK ("access_codes"."prompt_runs" >= 0),
	CONSTRAINT "access_codes_lift_days_check" CHECK ("access_codes"."lift_days" >= 0),
	CONSTRAINT "access_codes_max_redemptions_check" CHECK ("access_codes"."max_redemptions" >= 1),
	CONSTRAINT "access_codes_redeemed_count_check" CHECK ("access_codes"."redeemed_count" >= 0 and "access_codes"."redeemed_count" <= "access_codes"."max_redemptions"),
	CONSTRAINT "access_codes_grant_check" CHECK ("access_codes"."source_runs" + "access_codes"."prompt_runs" + "access_codes"."lift_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "code_redemptions" (
	"code_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "code_redemptions_code_id_user_id_pk" PRIMARY KEY("code_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bonus_source_runs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bonus_prompt_runs" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "limits_lifted_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "code_redemptions" ADD CONSTRAINT "code_redemptions_code_id_access_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."access_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_redemptions" ADD CONSTRAINT "code_redemptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_bonus_source_runs_check" CHECK ("users"."bonus_source_runs" >= 0);--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_bonus_prompt_runs_check" CHECK ("users"."bonus_prompt_runs" >= 0);