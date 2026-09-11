CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority" smallint DEFAULT 4 NOT NULL,
	"scheduled_date" date,
	"scheduled_time" time(0),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_priority_range" CHECK ("tasks"."priority" BETWEEN 1 AND 4),
	CONSTRAINT "tasks_scheduled_time_requires_date" CHECK ("tasks"."scheduled_time" IS NULL OR "tasks"."scheduled_date" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "tasks_user_id_created_at_idx" ON "tasks" USING btree ("user_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
ALTER TABLE public.tasks ADD CONSTRAINT tasks_user_id_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint
GRANT SELECT ON public.tasks TO powersync_role;
--> statement-breakpoint
ALTER PUBLICATION powersync ADD TABLE public.tasks;