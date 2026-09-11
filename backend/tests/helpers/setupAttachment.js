const crypto = require('crypto');
const { supabase } = require('../../src/db/supabase');

/**
 * Inserts a `pending` requisition_attachments row directly, bypassing the real upload
 * endpoint (no actual file/storage object needed for most controller-level tests). Returns
 * { attachmentId, storagePath } — pass attachmentId as requisition_pdf_attachment_id /
 * gst_bill_pdf_attachment_id in a createRequisition payload.
 *
 * kind: 'requisition_pdf' | 'gst_bill'
 */
async function setupAttachment({ kind, uploadedBy, storagePath }) {
  const bucket = kind === 'gst_bill' ? 'gst-bills' : 'requisition-pdfs';
  const path = storagePath || `${crypto.randomUUID()}.pdf`;

  const { data, error } = await supabase
    .from('requisition_attachments')
    .insert({
      bucket,
      storage_path: path,
      kind,
      uploaded_by: uploadedBy,
      status: 'pending'
    })
    .select('attachment_id')
    .single();

  if (error) throw error;
  return { attachmentId: data.attachment_id, storagePath: path };
}

module.exports = setupAttachment;
