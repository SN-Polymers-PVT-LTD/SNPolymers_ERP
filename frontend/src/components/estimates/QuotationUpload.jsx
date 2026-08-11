import { useState, useEffect } from 'react';
import { getQuotations, uploadQuotation, deleteQuotation } from '../../api/estimatesApi';
import { canUploadQuotation, canDeleteQuotation } from '../../utils/estimateQuotationPermissions';
import { useAuth } from '../AuthContext';

export default function QuotationUpload({ estimateId, estimate, isFormLocked }) {
  const { user } = useAuth();
  const [quotations, setQuotations] = useState([]);
  const [vendorLabel, setVendorLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const loadQuotations = async () => {
    setError('');
    try {
      const res = await getQuotations(estimateId);
      if (res.data?.success) {
        setQuotations(res.data.quotations || []);
      }
    } catch (err) {
      console.error('Failed to load quotations', err);
      setError('Failed to load quotations from server.');
    }
  };

  useEffect(() => {
    if (estimateId) loadQuotations();
  }, [estimateId]);

  const handleFileChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    setError('');
    setUploading(true);

    const failures = [];
    let successCount = 0;

    try {
      for (const file of files) {
        if (file.type !== 'application/pdf') {
          failures.push(`File "${file.name}" rejected: Only PDF files are accepted.`);
          continue;
        }
        if (file.size > 15 * 1024 * 1024) {
          failures.push(`File "${file.name}" rejected: Exceeds 15MB size limit.`);
          continue;
        }

        // Upload sequentially
        try {
          await uploadQuotation(estimateId, file, vendorLabel);
          successCount += 1;
        } catch (err) {
          failures.push(
            `File "${file.name}": ${err.response?.data?.message || 'Failed to upload.'}`
          );
        }
      }
      setVendorLabel('');
      await loadQuotations();

      if (failures.length > 0) {
        if (successCount === 0) {
          setError(failures.join(' '));
        } else {
          setError(
            `Uploaded ${successCount} of ${files.length} files. ${failures.join(' ')}`
          );
        }
      }
    } finally {
      setUploading(false);
      e.target.value = ''; // Reset input slot
    }
  };

  const handleDelete = async (quotationId) => {
    if (!window.confirm('Are you sure you want to delete this quotation?')) return;
    setError('');
    try {
      await deleteQuotation(estimateId, quotationId);
      await loadQuotations();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete quotation.');
    }
  };

  const allowedToUpload = canUploadQuotation(estimate, user) && !isFormLocked;

  return (
    <div className="glass-panel p-6 rounded-3xl border border-white/5 space-y-6 mt-8">
      <div className="flex justify-between items-center">
        <h3 className="text-xs uppercase font-extrabold tracking-widest text-slate-200">
          Dealer Quotations
        </h3>
        {uploading && <span className="text-[10px] text-amber-500 font-mono animate-pulse">Uploading...</span>}
      </div>

      {error && <p className="text-xs text-rose-500 font-semibold">{error}</p>}

      {/* Upload Slot */}
      {allowedToUpload && (
        <div className="flex flex-col sm:flex-row gap-4 items-end bg-white/[0.01] p-4 border border-white/5 rounded-2xl">
          <div className="flex-1 w-full">
            <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">
              Dealer/Vendor Name (Optional)
            </span>
            <input
              type="text"
              placeholder="e.g. ACC Cement Dealer"
              value={vendorLabel}
              onChange={(e) => setVendorLabel(e.target.value.slice(0, 100))}
              className="w-full glass-input p-2.5 rounded-xl text-xs"
              disabled={uploading}
            />
          </div>
          <div className="w-full sm:w-auto">
            <input
              type="file"
              id="quotation-file-input"
              accept="application/pdf"
              multiple
              onChange={handleFileChange}
              className="hidden"
              disabled={uploading}
            />
            <label
              htmlFor="quotation-file-input"
              className="block text-center bg-gradient-to-tr from-amber-500 to-amber-400 hover:from-amber-600 hover:to-amber-500 text-slate-950 font-bold py-2.5 px-6 rounded-xl text-xs cursor-pointer transition duration-200"
            >
              Choose PDF
            </label>
          </div>
        </div>
      )}

      {/* List Uploaded Files */}
      {quotations.length > 0 ? (
        <div className="space-y-3">
          {quotations.map((q) => {
            const allowedToDelete = canDeleteQuotation(q, estimate, user) && !isFormLocked;
            return (
              <div
                key={q.quotation_id}
                className={`flex justify-between items-center p-3.5 bg-white/[0.01] border rounded-2xl text-xs transition duration-200 ${
                  q.flagged_for_replacement
                    ? 'border-rose-500/40 bg-rose-950/[0.01]'
                    : 'border-white/5'
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <a
                      href={q.quotation_signed_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-bold text-slate-200 hover:text-amber-500 underline truncate max-w-[250px]"
                    >
                      {q.original_filename}
                    </a>
                    <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-amber-500/20 text-amber-400">
                      Uploaded
                    </span>
                    {q.is_locked && (
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-slate-500/20 text-slate-400">
                        Locked
                      </span>
                    )}
                    {q.flagged_for_replacement && (
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-rose-500/20 text-rose-400">
                        Needs Replacement
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-slate-500 font-medium">
                    {q.vendor_label && <span className="mr-3">Vendor: {q.vendor_label}</span>}
                    <span>Size: {(q.file_size / 1024).toFixed(1)} KB</span>
                  </div>
                </div>

                {allowedToDelete && (
                  <button
                    onClick={() => handleDelete(q.quotation_id)}
                    className="text-rose-400 hover:text-rose-300 p-2 rounded-lg hover:bg-white/5 transition"
                  >
                    Remove
                  </button>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-slate-500 italic">No quotations uploaded yet.</p>
      )}
    </div>
  );
}
