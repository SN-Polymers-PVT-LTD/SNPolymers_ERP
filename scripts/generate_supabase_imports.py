#!/usr/bin/env python3
"""
Generate Supabase import-ready CSV and SQL files from:
1. Material_Master_FINAL_FILE.xlsx -> public.material_master
2. Sub_Contractor_Master_Final.xlsx -> public.subcontract_work_master

Author: SN Polymers ERP
"""

import os
import csv
import openpyxl

ADMIN_PHONE = "+919883321834"
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUTPUT_DIR = os.path.join(BASE_DIR, "supabase", "imports")
os.makedirs(OUTPUT_DIR, exist_ok=True)

MAT_FILE = os.path.join(BASE_DIR, "backend", "test_data", "Material_Master_FINAL_FILE.xlsx")
SUB_FILE = os.path.join(BASE_DIR, "backend", "test_data", "Sub_Contractor_Master_Final.xlsx")

def escape_sql_str(val):
    return str(val).replace("'", "''")

def process_material_master():
    print(f"Reading {MAT_FILE}...")
    wb = openpyxl.load_workbook(MAT_FILE, data_only=True)
    sheet = wb.active
    
    all_rows = []
    unique_rows = []
    seen = set()
    
    for r in range(2, sheet.max_row + 1):
        main = str(sheet.cell(r, 2).value or "").strip()
        sub = str(sheet.cell(r, 3).value or "").strip()
        details = str(sheet.cell(r, 4).value or "").strip()
        unit = str(sheet.cell(r, 5).value or "").strip()
        if not (main and sub and details and unit):
            continue
            
        row_dict = {
            "Material_Main_Head": main,
            "Material_Sub_Head": sub,
            "Material_Details": details,
            "M_Unit": unit,
            "is_active": "true",
            "created_by": ADMIN_PHONE
        }
        all_rows.append(row_dict)
        
        key = (main.lower(), sub.lower(), details.lower(), unit.lower())
        if key not in seen:
            seen.add(key)
            unique_rows.append(row_dict)
            
    print(f"Material Master: Total={len(all_rows)}, Unique={len(unique_rows)}, Duplicates={len(all_rows) - len(unique_rows)}")
    
    # 1. Write unique CSV (recommended for clean Supabase Table Editor import)
    csv_path_unique = os.path.join(OUTPUT_DIR, "material_master_import_ready.csv")
    fieldnames = ["Material_Main_Head", "Material_Sub_Head", "Material_Details", "M_Unit", "is_active", "created_by"]
    with open(csv_path_unique, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(unique_rows)
    print(f"Wrote {csv_path_unique}")

    # 2. Write all rows CSV (verbatim un-deduplicated)
    csv_path_all = os.path.join(OUTPUT_DIR, "material_master_all_2081_rows.csv")
    with open(csv_path_all, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(all_rows)
    print(f"Wrote {csv_path_all}")

    # 3. Write SQL seed script
    sql_path = os.path.join(OUTPUT_DIR, "seed_material_master.sql")
    with open(sql_path, "w", encoding="utf-8") as f:
        f.write(f"""-- ============================================================================
-- Seed Material Master Data ({len(unique_rows)} unique items)
-- Source: Material_Master_FINAL_FILE.xlsx
-- Admin Attribution: {ADMIN_PHONE}
-- Safe and idempotent: can be run repeatedly without inserting duplicate records.
-- ============================================================================

BEGIN;

-- Ensure admin user exists in authorised_users to satisfy audit and foreign keys
INSERT INTO public.authorised_users (mobile_number, role, is_active, display_name)
VALUES ('{ADMIN_PHONE}', 'admin', true, 'System Admin')
ON CONFLICT (mobile_number) DO UPDATE SET role = 'admin', is_active = true;

-- Temporary staging table for batch insert
CREATE TEMP TABLE tmp_materials (
    "Material_Main_Head" varchar NOT NULL,
    "Material_Sub_Head" varchar NOT NULL,
    "Material_Details" text NOT NULL,
    "M_Unit" varchar NOT NULL,
    "is_active" boolean NOT NULL DEFAULT true,
    "created_by" varchar NOT NULL
) ON COMMIT DROP;

INSERT INTO tmp_materials ("Material_Main_Head", "Material_Sub_Head", "Material_Details", "M_Unit", "is_active", "created_by") VALUES
""")
        lines = []
        for row in unique_rows:
            m = escape_sql_str(row["Material_Main_Head"])
            s = escape_sql_str(row["Material_Sub_Head"])
            d = escape_sql_str(row["Material_Details"])
            u = escape_sql_str(row["M_Unit"])
            lines.append(f"  ('{m}', '{s}', '{d}', '{u}', true, '{ADMIN_PHONE}')")
        f.write(",\n".join(lines))
        f.write(";\n\n")
        
        f.write("""-- Insert into public.material_master only records that do not already exist
INSERT INTO public.material_master (
    "Material_Main_Head",
    "Material_Sub_Head",
    "Material_Details",
    "M_Unit",
    is_active,
    created_by
)
SELECT
    tm."Material_Main_Head",
    tm."Material_Sub_Head",
    tm."Material_Details",
    tm."M_Unit",
    tm."is_active",
    tm."created_by"
FROM tmp_materials tm
WHERE NOT EXISTS (
    SELECT 1 FROM public.material_master mm
    WHERE lower(btrim(mm."Material_Main_Head")) = lower(btrim(tm."Material_Main_Head"))
      AND lower(btrim(mm."Material_Sub_Head")) = lower(btrim(tm."Material_Sub_Head"))
      AND lower(btrim(mm."Material_Details")) = lower(btrim(tm."Material_Details"))
      AND lower(btrim(mm."M_Unit")) = lower(btrim(tm."M_Unit"))
);

COMMIT;
""")
    print(f"Wrote {sql_path}")


def process_subcontract_work_master():
    print(f"Reading {SUB_FILE}...")
    wb = openpyxl.load_workbook(SUB_FILE, data_only=True)
    sheet = wb.active
    
    rows = []
    seen = set()
    
    for r in range(2, sheet.max_row + 1):
        sub = str(sheet.cell(r, 3).value or "").strip()
        details = str(sheet.cell(r, 4).value or "").strip()
        unit = str(sheet.cell(r, 5).value or "").strip()
        if not (sub and details and unit):
            continue
            
        row_dict = {
            "sub_head": sub,
            "material_details": details,
            "unit": unit,
            "is_active": "true",
            "created_by": ADMIN_PHONE
        }
        key = (sub.lower(), details.lower(), unit.lower())
        if key not in seen:
            seen.add(key)
            rows.append(row_dict)
            
    print(f"Subcontract Work Master: Total Unique={len(rows)}")

    # 1. Write CSV for Supabase Table Editor
    csv_path = os.path.join(OUTPUT_DIR, "subcontract_work_master_import_ready.csv")
    fieldnames = ["sub_head", "material_details", "unit", "is_active", "created_by"]
    with open(csv_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {csv_path}")

    # 2. Write SQL seed script
    sql_path = os.path.join(OUTPUT_DIR, "seed_subcontract_work_master.sql")
    with open(sql_path, "w", encoding="utf-8") as f:
        f.write(f"""-- ============================================================================
-- Seed Subcontract Work Master Data ({len(rows)} items)
-- Source: Sub_Contractor_Master_Final.xlsx
-- Target: public.subcontract_work_master (Migration 076)
-- Admin Attribution: {ADMIN_PHONE}
-- Safe and idempotent: can be run repeatedly using uq_subcontract_work_master_identity conflict target.
-- ============================================================================

BEGIN;

-- Ensure admin user exists in authorised_users to satisfy foreign key constraints
INSERT INTO public.authorised_users (mobile_number, role, is_active, display_name)
VALUES ('{ADMIN_PHONE}', 'admin', true, 'System Admin')
ON CONFLICT (mobile_number) DO UPDATE SET role = 'admin', is_active = true;

-- Insert subcontract works with ON CONFLICT resolution
INSERT INTO public.subcontract_work_master (
    sub_head,
    material_details,
    unit,
    is_active,
    created_by
) VALUES
""")
        lines = []
        for row in rows:
            s = escape_sql_str(row["sub_head"])
            d = escape_sql_str(row["material_details"])
            u = escape_sql_str(row["unit"])
            lines.append(f"  ('{s}', '{d}', '{u}', true, '{ADMIN_PHONE}')")
        f.write(",\n".join(lines))
        f.write("""
ON CONFLICT (lower(btrim(sub_head)), lower(btrim(material_details)), lower(btrim(unit)))
DO UPDATE SET
  is_active = EXCLUDED.is_active,
  updated_by = EXCLUDED.created_by,
  updated_at = now();

COMMIT;
""")
    print(f"Wrote {sql_path}")


def write_readme():
    readme_path = os.path.join(OUTPUT_DIR, "README.md")
    with open(readme_path, "w", encoding="utf-8") as f:
        f.write(f"""# Supabase Import-Ready Files

This directory contains database-import ready files prepared from the official Excel masters:
1. `Material_Master_FINAL_FILE.xlsx` (2,063 unique items)
2. `Sub_Contractor_Master_Final.xlsx` (106 unique subcontract work heads)

All files use the designated admin account: `{ADMIN_PHONE}`.

---

## File Manifest

| File | Target Table | Description |
|---|---|---|
| `material_master_import_ready.csv` | `public.material_master` | 2,063 unique materials, trimmed, formatted with exact DB column headers. |
| `material_master_all_2081_rows.csv` | `public.material_master` | All 2,081 materials (including 18 exact duplicate rows from the source Excel). |
| `subcontract_work_master_import_ready.csv` | `public.subcontract_work_master` | 106 subcontract work items with exact DB column headers. |
| `seed_material_master.sql` | `public.material_master` | Idempotent transaction script for Supabase SQL Editor. Safe to run multiple times. |
| `seed_subcontract_work_master.sql` | `public.subcontract_work_master` | Idempotent upsert script for Supabase SQL Editor. Safe to run multiple times. |

---

## How to Import

### Method 1: Supabase SQL Editor (Recommended)
This is the fastest, safest, and 100% idempotent method:
1. Open your Supabase Project Dashboard (Dev or Prod).
2. Click **SQL Editor** in the left sidebar.
3. Open `seed_material_master.sql`, paste the contents into the query editor, and click **Run**.
4. Open `seed_subcontract_work_master.sql`, paste the contents into the query editor, and click **Run**.

### Method 2: Supabase Table Editor (CSV Upload)
1. Open your Supabase Project Dashboard.
2. Click **Table Editor** in the left sidebar.
3. For Material Master:
   - Select `material_master`.
   - Click **Insert** -> **Import data from CSV**.
   - Select `material_master_import_ready.csv`.
   - Ensure column mappings align (they match 1:1 with DB schema: `Material_Main_Head`, `Material_Sub_Head`, `Material_Details`, `M_Unit`, `is_active`, `created_by`).
   - Click **Import data**.
4. For Subcontract Work Master:
   - Select `subcontract_work_master`.
   - Click **Insert** -> **Import data from CSV**.
   - Select `subcontract_work_master_import_ready.csv`.
   - Ensure column mappings align (`sub_head`, `material_details`, `unit`, `is_active`, `created_by`).
   - Click **Import data**.
""")
    print(f"Wrote {readme_path}")

if __name__ == "__main__":
    process_material_master()
    process_subcontract_work_master()
    write_readme()
    print("Done!")
