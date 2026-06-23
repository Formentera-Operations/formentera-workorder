


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."bump_maintenance_form_submission_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."bump_maintenance_form_submission_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_kpi_summary"("user_assets" "text"[], "range_start" "date", "range_end" "date") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
WITH filtered AS (
  SELECT id, "Ticket_Status", "Asset", "Issue_Date", "Field", "Equipment"
  FROM "Maintenance_Form_Submission"
  WHERE user_assets IS NULL
     OR cardinality(user_assets) = 0
     OR "Asset" = ANY(user_assets)
),
status_counts AS (
  SELECT COALESCE(
    jsonb_object_agg(grouped_status, c),
    '{}'::jsonb
  ) AS counts
  FROM (
    -- NULL Ticket_Status historically rolled into "Open"; preserve that
    -- so the card counts match the total.
    SELECT COALESCE("Ticket_Status", 'Open') AS grouped_status, COUNT(*) AS c
    FROM filtered
    GROUP BY COALESCE("Ticket_Status", 'Open')
  ) s
),
aged AS (
  SELECT COALESCE(jsonb_agg(t.row ORDER BY t.issue_date ASC), '[]'::jsonb) AS oldest
  FROM (
    SELECT
      "Issue_Date" AS issue_date,
      jsonb_build_object(
        'ticket_id', id,
        'field',     COALESCE("Field", ''),
        'equipment', COALESCE("Equipment", 'Unknown'),
        'status',    "Ticket_Status",
        'days_open', FLOOR(EXTRACT(EPOCH FROM (NOW() - "Issue_Date")) / 86400)::int
      ) AS row
    FROM filtered
    WHERE "Ticket_Status" IN ('Open', 'In Progress', 'Backlogged', 'Awaiting Cost')
      AND id > 700
    ORDER BY "Issue_Date" ASC
    LIMIT 10
  ) t
),
trend_data AS (
  SELECT "Issue_Date"::date AS day, COUNT(*) AS cnt
  FROM filtered
  WHERE "Issue_Date" >= range_start::timestamptz
    AND "Issue_Date" <  (range_end + 1)::timestamptz
  GROUP BY "Issue_Date"::date
),
trend AS (
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'date',  to_char(d, 'YYYY-MM-DD'),
        'count', COALESCE(td.cnt, 0)
      ) ORDER BY d
    ),
    '[]'::jsonb
  ) AS daily
  FROM generate_series(range_start::timestamp, range_end::timestamp, '1 day'::interval) d
  LEFT JOIN trend_data td ON td.day = d::date
)
SELECT jsonb_build_object(
  'statusCounts', (SELECT counts FROM status_counts),
  'agedTickets',  (SELECT oldest FROM aged),
  'dailyTrend',   (SELECT daily FROM trend),
  'total',        (SELECT COUNT(*) FROM filtered)
);
$$;


ALTER FUNCTION "public"."get_kpi_summary"("user_assets" "text"[], "range_start" "date", "range_end" "date") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO user_profiles (id, full_name, email)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.email
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."Dispatch" (
    "id" integer NOT NULL,
    "ticket_id" integer,
    "maintenance_foreman" "text",
    "date_assigned" timestamp with time zone,
    "due_date" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "production_foreman" "text",
    "work_order_decision" "text",
    "ticket_status" "text",
    "self_dispatch_assignee" "text",
    "Estimate_Cost" numeric(12,2),
    "client_request_id" "text"
);


ALTER TABLE "public"."Dispatch" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."Dispatch_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."Dispatch_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."Dispatch_id_seq" OWNED BY "public"."Dispatch"."id";



CREATE TABLE IF NOT EXISTS "public"."Maintenance_Form_Submission" (
    "id" integer NOT NULL,
    "Department" "text",
    "Issue_Date" timestamp with time zone DEFAULT "now"(),
    "Location_Type" "text",
    "Field" "text",
    "Route" "text",
    "Facility" "text",
    "Equipment_Type" "text",
    "Equipment" "text",
    "Issue_Description" "text",
    "Troubleshooting_Conducted" "text",
    "Contacted_Vendor" "text",
    "Priority_of_Issue" "text",
    "Issue_Photos" "jsonb" DEFAULT '[]'::"jsonb",
    "Well" "text",
    "Created_by_Email" "text",
    "Created_by_Name" "text",
    "Ticket_Status" "text" DEFAULT 'Open'::"text",
    "Asset" "text",
    "Area" "text",
    "Work_Order_Type" "text",
    "Self_Dispatch_Assignee" "text",
    "Estimate_Cost" numeric(12,2),
    "assigned_foreman" "text",
    "Well_UNITID" "text",
    "client_request_id" "text",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."Maintenance_Form_Submission" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."Maintenance_Form_Submission_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."Maintenance_Form_Submission_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."Maintenance_Form_Submission_id_seq" OWNED BY "public"."Maintenance_Form_Submission"."id";



CREATE TABLE IF NOT EXISTS "public"."Repairs_Closeout" (
    "id" integer NOT NULL,
    "ticket_id" integer,
    "start_date" timestamp with time zone,
    "repair_details" "text",
    "repair_images" "jsonb" DEFAULT '[]'::"jsonb",
    "vendor" "text",
    "total_repair_cost" numeric(12,2),
    "date_completed" timestamp with time zone,
    "final_status" "text",
    "date_closed" timestamp with time zone,
    "closed_by" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "Work_Order_Type" "text",
    "Priority_of_Issue" "text",
    "AFE_Number" "text",
    "Job_Category" "text",
    "Job_Type_Primary" "text",
    "client_request_id" "text"
);


ALTER TABLE "public"."Repairs_Closeout" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."Repairs_Closeout_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."Repairs_Closeout_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."Repairs_Closeout_id_seq" OWNED BY "public"."Repairs_Closeout"."id";



CREATE TABLE IF NOT EXISTS "public"."comments" (
    "id" integer NOT NULL,
    "ticket_id" integer,
    "author_name" "text",
    "author_email" "text",
    "body" "text" NOT NULL,
    "parent_id" integer,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."comments" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."comments_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."comments_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."comments_id_seq" OWNED BY "public"."comments"."id";



CREATE TABLE IF NOT EXISTS "public"."deleted_tickets" (
    "id" bigint NOT NULL,
    "original_data" "jsonb" NOT NULL,
    "deleted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_by_email" "text" NOT NULL,
    "deleted_by_name" "text",
    "deleted_by_role" "text" NOT NULL,
    "deletion_reason" "text" NOT NULL
);


ALTER TABLE "public"."deleted_tickets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employees" (
    "id" integer NOT NULL,
    "name" "text" NOT NULL,
    "job_title" "text",
    "manager" "text",
    "work_email" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "role" "text" DEFAULT 'field_user'::"text" NOT NULL,
    "assets" "text"[] DEFAULT '{}'::"text"[]
);


ALTER TABLE "public"."employees" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."employees_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."employees_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."employees_id_seq" OWNED BY "public"."employees"."id";



CREATE TABLE IF NOT EXISTS "public"."equipment_Type" (
    "id" "text" NOT NULL,
    "equipment_type" "text" NOT NULL,
    "department_owner_id" "text"
);


ALTER TABLE "public"."equipment_Type" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."equipment_library" (
    "id" integer NOT NULL,
    "match_type" "text",
    "equip_name" "text" NOT NULL,
    "equip_code" "text",
    "type" "text"
);


ALTER TABLE "public"."equipment_library" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."equipment_library_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."equipment_library_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."equipment_library_id_seq" OWNED BY "public"."equipment_library"."id";



CREATE TABLE IF NOT EXISTS "public"."user_profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "email" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."user_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vendor_payment_details" (
    "id" integer NOT NULL,
    "ticket_id" integer,
    "vendor" "text",
    "vendor_cost" numeric(12,2),
    "vendor_2" "text",
    "vendor_cost_2" numeric(12,2),
    "vendor_3" "text",
    "vendor_cost_3" numeric(12,2),
    "vendor_4" "text",
    "vendor_cost_4" numeric(12,2),
    "vendor_5" "text",
    "vendor_cost_5" numeric(12,2),
    "vendor_6" "text",
    "vendor_cost_6" numeric(12,2),
    "vendor_7" "text",
    "vendor_cost_7" numeric(12,2),
    "total_cost" numeric(12,2),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."vendor_payment_details" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."vendor_payment_details_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."vendor_payment_details_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."vendor_payment_details_id_seq" OWNED BY "public"."vendor_payment_details"."id";



CREATE OR REPLACE VIEW "public"."workorder_ticket_list" WITH ("security_invoker"='on') AS
 SELECT "t"."id",
    "t"."Department",
    "t"."Issue_Date",
    "t"."Location_Type",
    "t"."Field",
    "t"."Route",
    "t"."Facility",
    "t"."Equipment_Type",
    "t"."Equipment",
    "t"."Issue_Description",
    "t"."Troubleshooting_Conducted",
    "t"."Contacted_Vendor",
    "t"."Priority_of_Issue",
    "t"."Issue_Photos",
    "t"."Well",
    "t"."Created_by_Email",
    "t"."Created_by_Name",
    "t"."Ticket_Status",
    "t"."Asset",
    "t"."Area",
    "t"."Work_Order_Type",
    "t"."Self_Dispatch_Assignee",
    "t"."Estimate_Cost",
    "t"."assigned_foreman",
    "ld"."latest_dispatch_created_at",
    "lrc"."latest_closeout_ts",
    GREATEST(COALESCE("ld"."latest_dispatch_created_at", '1970-01-01 00:00:00+00'::timestamp with time zone), COALESCE("lrc"."latest_closeout_ts", '1970-01-01 00:00:00+00'::timestamp with time zone), COALESCE("t"."Issue_Date", '1970-01-01 00:00:00+00'::timestamp with time zone)) AS "last_activity_ts"
   FROM (("public"."Maintenance_Form_Submission" "t"
     LEFT JOIN LATERAL ( SELECT "d"."created_at" AS "latest_dispatch_created_at"
           FROM "public"."Dispatch" "d"
          WHERE ("d"."ticket_id" = "t"."id")
          ORDER BY "d"."created_at" DESC, "d"."id" DESC
         LIMIT 1) "ld" ON (true))
     LEFT JOIN LATERAL ( SELECT "max"(GREATEST(COALESCE("rc2"."updated_at", '1970-01-01 00:00:00+00'::timestamp with time zone), COALESCE("rc2"."created_at", '1970-01-01 00:00:00+00'::timestamp with time zone))) AS "latest_closeout_ts"
           FROM "public"."Repairs_Closeout" "rc2"
          WHERE ("rc2"."ticket_id" = "t"."id")) "lrc" ON (true));


ALTER VIEW "public"."workorder_ticket_list" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."workorder_ticket_summary" WITH ("security_invoker"='on') AS
 WITH "latest_dispatch" AS (
         SELECT "d_1"."id",
            "d_1"."ticket_id",
            "d_1"."maintenance_foreman",
            "d_1"."date_assigned",
            "d_1"."due_date",
            "d_1"."created_at",
            "d_1"."production_foreman",
            "d_1"."work_order_decision",
            "d_1"."ticket_status",
            "d_1"."self_dispatch_assignee",
            "d_1"."Estimate_Cost",
            "row_number"() OVER (PARTITION BY "d_1"."ticket_id" ORDER BY ("d_1"."Estimate_Cost" IS NOT NULL) DESC, "d_1"."date_assigned" DESC NULLS LAST, "d_1"."created_at" DESC, "d_1"."id" DESC) AS "rn"
           FROM "public"."Dispatch" "d_1"
        ), "latest_closeout" AS (
         SELECT "rc_1"."id",
            "rc_1"."ticket_id",
            "rc_1"."start_date",
            "rc_1"."repair_details",
            "rc_1"."repair_images",
            "rc_1"."vendor",
            "rc_1"."total_repair_cost",
            "rc_1"."date_completed",
            "rc_1"."final_status",
            "rc_1"."date_closed",
            "rc_1"."closed_by",
            "rc_1"."created_at",
            "rc_1"."created_by",
            "rc_1"."updated_at",
            "rc_1"."Work_Order_Type",
            "rc_1"."Priority_of_Issue",
            "rc_1"."AFE_Number",
            "rc_1"."Job_Category",
            "rc_1"."Job_Type_Primary",
            "row_number"() OVER (PARTITION BY "rc_1"."ticket_id" ORDER BY COALESCE("rc_1"."date_closed", "rc_1"."date_completed", "rc_1"."start_date", "rc_1"."created_at") DESC, "rc_1"."id" DESC) AS "rn"
           FROM "public"."Repairs_Closeout" "rc_1"
        )
 SELECT "m"."id" AS "ticket_id",
    "m"."Department" AS "department",
    "m"."Issue_Date" AS "issue_date",
    COALESCE("rc"."Work_Order_Type", "m"."Work_Order_Type") AS "work_order_type",
    COALESCE("d"."Estimate_Cost", "m"."Estimate_Cost") AS "Estimate_Cost",
    COALESCE("rc"."Priority_of_Issue", "m"."Priority_of_Issue") AS "priority_of_issue",
    "m"."Issue_Description" AS "issue_description",
    "m"."Location_Type" AS "location_type",
    "m"."Equipment_Type" AS "equipment_type",
    "m"."Equipment" AS "equipment_name",
    "m"."Asset" AS "asset",
    "m"."Area" AS "area",
    "m"."Field" AS "field",
    "m"."Route" AS "route",
    "m"."Well" AS "well",
    "m"."Facility" AS "facility",
    "m"."Ticket_Status" AS "ticket_status",
    "d"."work_order_decision",
    "d"."self_dispatch_assignee",
    "d"."production_foreman",
    "d"."maintenance_foreman",
    "d"."date_assigned",
    "d"."due_date",
    "rc"."final_status",
    "rc"."start_date" AS "repair_start_date",
    "rc"."repair_details",
    "rc"."vendor" AS "repair_vendor",
    "rc"."total_repair_cost",
    "rc"."date_completed" AS "repair_date_completed",
    "rc"."date_closed" AS "repair_date_closed",
    "rc"."closed_by",
    "vpd"."total_cost" AS "repair_cost",
    "m"."Created_by_Name" AS "created_by",
    "m"."Well_UNITID" AS "well_unitid",
    "rc"."AFE_Number" AS "afe_number",
    "rc"."Job_Category" AS "job_category",
    "rc"."Job_Type_Primary" AS "job_type_primary",
    "m"."Troubleshooting_Conducted" AS "troubleshooting_conducted",
    "m"."Self_Dispatch_Assignee" AS "ticket_self_dispatch_assignee",
    "m"."assigned_foreman",
    "m"."Created_by_Email" AS "created_by_email"
   FROM ((("public"."Maintenance_Form_Submission" "m"
     LEFT JOIN "latest_dispatch" "d" ON ((("d"."ticket_id" = "m"."id") AND ("d"."rn" = 1))))
     LEFT JOIN "latest_closeout" "rc" ON ((("rc"."ticket_id" = "m"."id") AND ("rc"."rn" = 1))))
     LEFT JOIN "public"."vendor_payment_details" "vpd" ON (("vpd"."ticket_id" = "m"."id")))
  ORDER BY "m"."id";


ALTER VIEW "public"."workorder_ticket_summary" OWNER TO "postgres";


ALTER TABLE ONLY "public"."Dispatch" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."Dispatch_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."Maintenance_Form_Submission" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."Maintenance_Form_Submission_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."Repairs_Closeout" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."Repairs_Closeout_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."comments" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."comments_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."employees" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."employees_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."equipment_library" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."equipment_library_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."vendor_payment_details" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."vendor_payment_details_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."Dispatch"
    ADD CONSTRAINT "Dispatch_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Maintenance_Form_Submission"
    ADD CONSTRAINT "Maintenance_Form_Submission_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."Repairs_Closeout"
    ADD CONSTRAINT "Repairs_Closeout_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."deleted_tickets"
    ADD CONSTRAINT "deleted_tickets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."equipment_Type"
    ADD CONSTRAINT "equipment_Type_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."equipment_library"
    ADD CONSTRAINT "equipment_library_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_payment_details"
    ADD CONSTRAINT "vendor_payment_details_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."vendor_payment_details"
    ADD CONSTRAINT "vendor_payment_details_ticket_id_key" UNIQUE ("ticket_id");



CREATE INDEX "idx_deleted_tickets_deleted_at" ON "public"."deleted_tickets" USING "btree" ("deleted_at" DESC);



CREATE INDEX "idx_deleted_tickets_deleted_by_email" ON "public"."deleted_tickets" USING "btree" ("deleted_by_email");



CREATE UNIQUE INDEX "idx_dispatch_client_request_id" ON "public"."Dispatch" USING "btree" ("client_request_id") WHERE ("client_request_id" IS NOT NULL);



CREATE INDEX "idx_dispatch_ticket_id" ON "public"."Dispatch" USING "btree" ("ticket_id");



CREATE INDEX "idx_equipment_library_match_type_type" ON "public"."equipment_library" USING "btree" ("match_type", "type");



CREATE INDEX "idx_mfs_asset" ON "public"."Maintenance_Form_Submission" USING "btree" ("Asset");



CREATE UNIQUE INDEX "idx_mfs_client_request_id" ON "public"."Maintenance_Form_Submission" USING "btree" ("client_request_id") WHERE ("client_request_id" IS NOT NULL);



CREATE INDEX "idx_mfs_created_by_email" ON "public"."Maintenance_Form_Submission" USING "btree" ("Created_by_Email");



CREATE INDEX "idx_mfs_issue_date" ON "public"."Maintenance_Form_Submission" USING "btree" ("Issue_Date" DESC);



CREATE INDEX "idx_mfs_ticket_status" ON "public"."Maintenance_Form_Submission" USING "btree" ("Ticket_Status");



CREATE INDEX "idx_mfs_ticket_status_issue_date" ON "public"."Maintenance_Form_Submission" USING "btree" ("Ticket_Status", "Issue_Date");



CREATE INDEX "idx_rc_ticket_id" ON "public"."Repairs_Closeout" USING "btree" ("ticket_id");



CREATE UNIQUE INDEX "idx_repairs_closeout_client_request_id" ON "public"."Repairs_Closeout" USING "btree" ("client_request_id") WHERE ("client_request_id" IS NOT NULL);



CREATE INDEX "idx_vpd_ticket_id" ON "public"."vendor_payment_details" USING "btree" ("ticket_id");



CREATE OR REPLACE TRIGGER "trg_bump_maintenance_form_submission_updated_at" BEFORE UPDATE ON "public"."Maintenance_Form_Submission" FOR EACH ROW EXECUTE FUNCTION "public"."bump_maintenance_form_submission_updated_at"();



ALTER TABLE ONLY "public"."Dispatch"
    ADD CONSTRAINT "Dispatch_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."Maintenance_Form_Submission"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."Repairs_Closeout"
    ADD CONSTRAINT "Repairs_Closeout_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."Maintenance_Form_Submission"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."comments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."comments"
    ADD CONSTRAINT "comments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."Maintenance_Form_Submission"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_profiles"
    ADD CONSTRAINT "user_profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vendor_payment_details"
    ADD CONSTRAINT "vendor_payment_details_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "public"."Maintenance_Form_Submission"("id") ON DELETE CASCADE;



ALTER TABLE "public"."Dispatch" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."Maintenance_Form_Submission" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."Repairs_Closeout" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "auth_insert" ON "public"."Dispatch" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "auth_insert" ON "public"."Maintenance_Form_Submission" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "auth_insert" ON "public"."Repairs_Closeout" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "auth_insert" ON "public"."comments" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "auth_insert" ON "public"."vendor_payment_details" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "auth_select" ON "public"."Dispatch" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select" ON "public"."Maintenance_Form_Submission" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select" ON "public"."Repairs_Closeout" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select" ON "public"."comments" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select" ON "public"."employees" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select" ON "public"."equipment_Type" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select" ON "public"."equipment_library" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_select" ON "public"."vendor_payment_details" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "auth_update" ON "public"."Dispatch" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "auth_update" ON "public"."Maintenance_Form_Submission" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "auth_update" ON "public"."Repairs_Closeout" FOR UPDATE TO "authenticated" USING (true);



CREATE POLICY "auth_update" ON "public"."vendor_payment_details" FOR UPDATE TO "authenticated" USING (true);



ALTER TABLE "public"."comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deleted_tickets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."employees" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."equipment_Type" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."equipment_library" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "own_profile" ON "public"."user_profiles" TO "authenticated" USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."user_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."vendor_payment_details" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."Maintenance_Form_Submission";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."Repairs_Closeout";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."bump_maintenance_form_submission_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."bump_maintenance_form_submission_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bump_maintenance_form_submission_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_kpi_summary"("user_assets" "text"[], "range_start" "date", "range_end" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."get_kpi_summary"("user_assets" "text"[], "range_start" "date", "range_end" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_kpi_summary"("user_assets" "text"[], "range_start" "date", "range_end" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";


















GRANT ALL ON TABLE "public"."Dispatch" TO "anon";
GRANT ALL ON TABLE "public"."Dispatch" TO "authenticated";
GRANT ALL ON TABLE "public"."Dispatch" TO "service_role";



GRANT ALL ON SEQUENCE "public"."Dispatch_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."Dispatch_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."Dispatch_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."Maintenance_Form_Submission" TO "anon";
GRANT ALL ON TABLE "public"."Maintenance_Form_Submission" TO "authenticated";
GRANT ALL ON TABLE "public"."Maintenance_Form_Submission" TO "service_role";



GRANT ALL ON SEQUENCE "public"."Maintenance_Form_Submission_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."Maintenance_Form_Submission_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."Maintenance_Form_Submission_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."Repairs_Closeout" TO "anon";
GRANT ALL ON TABLE "public"."Repairs_Closeout" TO "authenticated";
GRANT ALL ON TABLE "public"."Repairs_Closeout" TO "service_role";



GRANT ALL ON SEQUENCE "public"."Repairs_Closeout_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."Repairs_Closeout_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."Repairs_Closeout_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."comments" TO "anon";
GRANT ALL ON TABLE "public"."comments" TO "authenticated";
GRANT ALL ON TABLE "public"."comments" TO "service_role";



GRANT ALL ON SEQUENCE "public"."comments_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."comments_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."comments_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."deleted_tickets" TO "anon";
GRANT ALL ON TABLE "public"."deleted_tickets" TO "authenticated";
GRANT ALL ON TABLE "public"."deleted_tickets" TO "service_role";



GRANT ALL ON TABLE "public"."employees" TO "anon";
GRANT ALL ON TABLE "public"."employees" TO "authenticated";
GRANT ALL ON TABLE "public"."employees" TO "service_role";



GRANT ALL ON SEQUENCE "public"."employees_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."employees_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."employees_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."equipment_Type" TO "anon";
GRANT ALL ON TABLE "public"."equipment_Type" TO "authenticated";
GRANT ALL ON TABLE "public"."equipment_Type" TO "service_role";



GRANT ALL ON TABLE "public"."equipment_library" TO "anon";
GRANT ALL ON TABLE "public"."equipment_library" TO "authenticated";
GRANT ALL ON TABLE "public"."equipment_library" TO "service_role";



GRANT ALL ON SEQUENCE "public"."equipment_library_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."equipment_library_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."equipment_library_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."user_profiles" TO "anon";
GRANT ALL ON TABLE "public"."user_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."vendor_payment_details" TO "anon";
GRANT ALL ON TABLE "public"."vendor_payment_details" TO "authenticated";
GRANT ALL ON TABLE "public"."vendor_payment_details" TO "service_role";



GRANT ALL ON SEQUENCE "public"."vendor_payment_details_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."vendor_payment_details_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."vendor_payment_details_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."workorder_ticket_list" TO "anon";
GRANT ALL ON TABLE "public"."workorder_ticket_list" TO "authenticated";
GRANT ALL ON TABLE "public"."workorder_ticket_list" TO "service_role";



GRANT ALL ON TABLE "public"."workorder_ticket_summary" TO "anon";
GRANT ALL ON TABLE "public"."workorder_ticket_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."workorder_ticket_summary" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































