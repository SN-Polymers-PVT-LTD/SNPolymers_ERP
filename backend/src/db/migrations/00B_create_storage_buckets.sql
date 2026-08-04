-- Migration 00B: Seed Supabase Storage Buckets
-- Creates storage buckets in public storage schema with size limits and MIME restrictions

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  (
    'ra-bill-copies', 
    'ra-bill-copies', 
    false, 
    5242880, -- 5MB in bytes
    ARRAY['application/pdf', 'image/jpeg', 'image/png']
  ),
  (
    'daily-progress-photos', 
    'daily-progress-photos', 
    false, 
    10485760, -- 10MB in bytes
    ARRAY['image/jpeg', 'image/png']
  ),
  (
    'gst-bills', 
    'gst-bills', 
    false, 
    10485760, -- 10MB in bytes
    ARRAY['application/pdf']
  ),
  (
    'requisition-pdfs', 
    'requisition-pdfs', 
    false, 
    10485760, -- 10MB in bytes
    ARRAY['application/pdf']
  )
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;
