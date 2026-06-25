const { supabase } = require('../src/db/supabase');

async function main() {
  const { data, error } = await supabase
    .from('material_master')
    .select('Material_Main_Head');
  
  if (data) {
    const distinctHeads = [...new Set(data.map(item => item.Material_Main_Head))];
    console.log('Distinct material heads:', distinctHeads);
  } else {
    console.log('Error:', error);
  }
}

main();
