const { getRequisitionById } = require('../src/controllers/requisitions.controller');
const { supabase } = require('../src/db/supabase');

function mockRes() {
  return {
    statusCode: 200,
    jsonData: null,
    status: function (code) { this.statusCode = code; return this; },
    json: function (data) { this.jsonData = data; return this; }
  };
}

async function debug() {
  const { data: req } = await supabase.from('requisitions').select('requisition_id').limit(1).single();
  const reqObj = {
    user: { role: 'je', mobile_number: '+918276071523' },
    params: { id: req.requisition_id }
  };
  const res = mockRes();
  await getRequisitionById(reqObj, res);
  console.log('Status:', res.statusCode);
  console.log('Data:', JSON.stringify(res.jsonData, null, 2));
}

debug();
