CREATE TABLE "labels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT 'charcoal' NOT NULL,
	"is_favorite" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "labels_name_trimmed" CHECK ("labels"."name" = btrim("labels"."name") AND char_length("labels"."name") BETWEEN 1 AND 60),
	CONSTRAINT "labels_color_allowed" CHECK ("labels"."color" IN ('berry_red', 'red', 'orange', 'yellow', 'olive_green', 'lime_green', 'green', 'mint_green', 'teal', 'sky_blue', 'light_blue', 'blue', 'grape', 'violet', 'lavender', 'magenta', 'salmon', 'charcoal', 'grey', 'taupe'))
);
--> statement-breakpoint
ALTER TABLE "labels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "task_labels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"label_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_labels_task_id_label_id_uidx" UNIQUE("task_id","label_id")
);
--> statement-breakpoint
ALTER TABLE "task_labels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority" smallint DEFAULT 4 NOT NULL,
	"scheduled_date" date,
	"scheduled_time" time(0),
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_priority_range" CHECK ("tasks"."priority" BETWEEN 1 AND 4),
	CONSTRAINT "tasks_scheduled_time_requires_date" CHECK ("tasks"."scheduled_time" IS NULL OR "tasks"."scheduled_date" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_labels" ADD CONSTRAINT "task_labels_label_id_labels_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."labels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "labels_user_id_lower_name_idx" ON "labels" USING btree ("user_id",lower("name"));--> statement-breakpoint
CREATE INDEX "task_labels_user_id_idx" ON "task_labels" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "task_labels_label_id_idx" ON "task_labels" USING btree ("label_id");--> statement-breakpoint
CREATE INDEX "tasks_user_id_created_at_idx" ON "tasks" USING btree ("user_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
ALTER TABLE public.tasks ADD CONSTRAINT tasks_user_id_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint
GRANT SELECT ON public.tasks TO powersync_role;
--> statement-breakpoint
ALTER PUBLICATION powersync ADD TABLE public.tasks;
--> statement-breakpoint
ALTER TABLE public.labels ADD CONSTRAINT labels_user_id_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint
GRANT SELECT ON public.labels TO powersync_role;
--> statement-breakpoint
ALTER PUBLICATION powersync ADD TABLE public.labels;
--> statement-breakpoint
ALTER TABLE public.task_labels ADD CONSTRAINT task_labels_user_id_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint
GRANT SELECT ON public.task_labels TO powersync_role;
--> statement-breakpoint
ALTER PUBLICATION powersync ADD TABLE public.task_labels;