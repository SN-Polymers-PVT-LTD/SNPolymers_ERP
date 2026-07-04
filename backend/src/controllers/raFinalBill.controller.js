'use strict';

const { supabase } = require('../db/supabase');

// Batch display name resolver — single query for all mobile numbers
async function resolveDisplayNames(mobiles) {
  const uniqueMobiles = Array.from(new Set(mobiles.filter(Boolean)));
  const userMap = {};
  if (uniqueMobiles.length > 0) {
    const { data: users, error } = await supabase
      .from('authorised_users')
      .select('mobile_number, display_name')
      .in('mobile_number', uniqueMobiles);
    if (!error && users) {
      users.forEach(u => { userMap[u.mobile_number] = u.display_name; });
    }
  }
  return userMap;
}

/**
 * Creates a new RA / Final Bill Entry.
 * Business Rules:
 *   - Only HO / ZO / Admin allowed (checked by middleware).
 *   - Geographic metadata is snapshotted from projects_master.
 *   - Closed work orders are rejected (403).
 *   - Duplicate bill types are blocked (409).
 *   - Sequential RA bills are enforced (422) e.g., RA Bill N-1 must exist before N.
 */
async function createBill(req, res) {
  try {
    const {
      work_order_no,
      payment_type,
      bill_date,
      bill_no,
      gross_bill,
      security_deposit_amount,
      agency_payment,
      special_security_amount,
      other_retention,
      it_tds,
      sgst,
      cgst,
      sd,
      bill_copy_url,
      original_bill_filename,
      remarks
    } = req.body;

    const creatorMobile = req.user.mobile_number;

    // 1. Fetch work order & freeze geo-snapshot
    const { data: project, error: projError } = await supabase
      .from('projects_master')
      .select('work_order_value, status, state, district, zone, department, site_details, earnest_money_deposit')
      .eq('work_order_no', work_order_no)
      .maybeSingle();

    if (projError || !project) {
      return res.status(404).json({ success: false, message: 'Work order not found.' });
    }

    // Guard: closed work order
    if (project.status === 'Closed') {
      return res.status(403).json({ success: false, message: 'Bills cannot be entered for Closed work orders.' });
    }

    // 2. Pre-check duplicate payment type
    const { data: dupCheck, error: dupCheckError } = await supabase
      .from('ra_final_bills')
      .select('bill_id')
      .eq('work_order_no', work_order_no)
      .eq('payment_type', payment_type)
      .maybeSingle();

    if (dupCheck) {
      return res.status(409).json({
        success: false,
        message: `A '${payment_type}' entry already exists for this work order.`
      });
    }

    // 3. Sequential RA Bill enforcement
    if (payment_type.startsWith('RA Bill ')) {
      const match = payment_type.match(/^RA Bill ([1-9][0-9]*)$/);
      if (match) {
        const currentN = parseInt(match[1], 10);
        if (currentN > 1) {
          const prevBillType = `RA Bill ${currentN - 1}`;
          const { data: prevBill, error: prevBillErr } = await supabase
            .from('ra_final_bills')
            .select('bill_id')
            .eq('work_order_no', work_order_no)
            .eq('payment_type', prevBillType)
            .maybeSingle();

          if (prevBillErr || !prevBill) {
            return res.status(422).json({
              success: false,
              message: `${prevBillType} must be entered before ${payment_type} can be accepted.`
            });
          }
        }
      }
    }

    // 4. Construct insert payload
    const insertPayload = {
      created_by: creatorMobile,
      work_order_no: work_order_no.trim(),
      state: project.state,
      district: project.district,
      area_code: project.zone, // maps projects_master.zone -> area_code
      department: project.department,
      site_details: project.site_details,
      payment_type: payment_type.trim(),
      bill_date,
      bill_no: bill_no.trim(),
      gross_bill: Number(gross_bill || 0),
      earnest_money_deposit: Number(project.earnest_money_deposit || 0), // Source from projects_master
      security_deposit_amount: Number(security_deposit_amount || 0),
      agency_payment: Number(agency_payment || 0),
      special_security_amount: Number(special_security_amount || 0),
      other_retention: Number(other_retention || 0),
      it_tds: Number(it_tds || 0),
      sgst: Number(sgst || 0),
      cgst: Number(cgst || 0),
      sd: Number(sd || 0),
      bill_copy_url: bill_copy_url.trim(),
      original_bill_filename: original_bill_filename || null,
      remarks: remarks?.trim() || null
    };

    const { data: createdBill, error: insertError } = await supabase
      .from('ra_final_bills')
      .insert([insertPayload])
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return res.status(409).json({
          success: false,
          message: `A '${payment_type}' entry already exists for this work order.`
        });
      }
      throw insertError;
    }

    return res.status(201).json({
      success: true,
      bill: createdBill,
      message: 'Bill entry created successfully.'
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('createBill failed:', error);
    }
    return res.status(500).json({ success: false, message: 'Failed to save bill entry.' });
  }
}

/**
 * Lists all bill entries with optional filters and pagination.
 */
async function getBills(req, res) {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const offset = (page - 1) * limit;

    const { work_order_no, date_from, date_to, payment_type } = req.query;

    let query = supabase
      .from('ra_final_bills')
      .select('*', { count: 'exact' });

    if (work_order_no) {
      query = query.eq('work_order_no', work_order_no.trim());
    }

    if (payment_type) {
      query = query.eq('payment_type', payment_type.trim());
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (date_from && dateRegex.test(date_from)) {
      query = query.gte('bill_date', date_from);
    }

    if (date_to && dateRegex.test(date_to)) {
      query = query.lte('bill_date', date_to);
    }

    query = query
      .order('bill_date', { ascending: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data: bills, count, error } = await query;

    if (error) throw error;

    // Resolve creator display names
    let enrichedBills = [];
    if (bills && bills.length > 0) {
      const creators = bills.map(b => b.created_by);
      const userMap = await resolveDisplayNames(creators);
      enrichedBills = bills.map(b => ({
        ...b,
        created_by_name: userMap[b.created_by] || b.created_by
      }));
    }

    const totalPages = Math.ceil((count || 0) / limit);

    return res.status(200).json({
      success: true,
      bills: enrichedBills,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages
      }
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('getBills failed:', error);
    }
    return res.status(500).json({ success: false, message: 'Failed to retrieve bills.' });
  }
}

/**
 * Gets a single bill entry by ID. Generates a signed URL for the bill copy.
 */
async function getBillById(req, res) {
  try {
    const { id } = req.params;

    const { data: bill, error } = await supabase
      .from('ra_final_bills')
      .select('*')
      .eq('bill_id', id)
      .maybeSingle();

    if (error || !bill) {
      return res.status(404).json({ success: false, message: 'Bill entry not found.' });
    }

    // Resolve creator display name
    const userMap = await resolveDisplayNames([bill.created_by]);
    const created_by_name = userMap[bill.created_by] || bill.created_by;

    // Generate signed URL
    let bill_copy_signed_url = null;
    if (bill.bill_copy_url) {
      const { data: signData, error: signError } = await supabase.storage
        .from('ra-bill-copies')
        .createSignedUrl(bill.bill_copy_url, 3600);
      
      if (!signError && signData) {
        bill_copy_signed_url = signData.signedUrl;
      }
    }

    return res.status(200).json({
      success: true,
      bill: {
        ...bill,
        created_by_name,
        bill_copy_signed_url
      }
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('getBillById failed:', error);
    }
    return res.status(500).json({ success: false, message: 'Failed to retrieve bill details.' });
  }
}

/**
 * Gets the billing summary for a specific work order, computing totals and generating
 * dynamic payment options for the frontend dropdown.
 */
async function getBillSummaryByWorkOrder(req, res) {
  try {
    const { work_order_no } = req.params;

    if (!work_order_no) {
      return res.status(400).json({ success: false, message: 'work_order_no is required.' });
    }

    // Fetch project
    const { data: project, error: projError } = await supabase
      .from('projects_master')
      .select('work_order_value, status, earnest_money_deposit')
      .eq('work_order_no', work_order_no)
      .maybeSingle();

    if (projError || !project) {
      return res.status(404).json({ success: false, message: 'Work order not found.' });
    }

    // Fetch existing bills
    const { data: bills, error: billsError } = await supabase
      .from('ra_final_bills')
      .select('payment_type, gross_bill')
      .eq('work_order_no', work_order_no)
      .order('created_at', { ascending: true });

    if (billsError) throw billsError;

    const existingPaymentTypes = bills.map(b => b.payment_type);
    const previousBillAmount = bills.reduce((sum, b) => sum + Number(b.gross_bill || 0), 0);
    const finalBillExists = existingPaymentTypes.includes('Final Bill');

    // Determine the highest RA bill number entered
    const raBillNumbers = existingPaymentTypes
      .filter(t => t.startsWith('RA Bill '))
      .map(t => {
        const parts = t.split(' ');
        return parseInt(parts[2], 10);
      })
      .filter(n => !isNaN(n));

    const maxRaBillNumber = raBillNumbers.length > 0 ? Math.max(...raBillNumbers) : 0;
    const nextRaBillNumber = maxRaBillNumber + 1;

    // Build dropdown options
    const dropdownOptions = [];
    if (!finalBillExists) {
      dropdownOptions.push({
        value: `RA Bill ${nextRaBillNumber}`,
        label: `RA Bill ${nextRaBillNumber}`,
        available: true
      });
      dropdownOptions.push({
        value: 'Final Bill',
        label: 'Final Bill',
        available: true
      });
    } else {
      dropdownOptions.push({
        value: `RA Bill ${nextRaBillNumber}`,
        label: `RA Bill ${nextRaBillNumber}`,
        available: true
      });
      dropdownOptions.push({
        value: 'Final Bill',
        label: 'Final Bill (Already Entered)',
        available: false
      });
    }

    return res.status(200).json({
      success: true,
      work_order_value: project.work_order_value || 0,
      work_order_status: project.status,
      earnest_money_deposit: project.earnest_money_deposit || 0,
      previous_bill_amount: previousBillAmount,
      existing_payment_types: existingPaymentTypes,
      next_ra_bill_number: nextRaBillNumber,
      final_bill_exists: finalBillExists,
      dropdown_options: dropdownOptions
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('getBillSummaryByWorkOrder failed:', error);
    }
    return res.status(500).json({ success: false, message: 'Failed to retrieve bill summary.' });
  }
}

module.exports = {
  createBill,
  getBills,
  getBillById,
  getBillSummaryByWorkOrder
};
