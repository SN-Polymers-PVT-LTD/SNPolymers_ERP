const { supabase } = require('./supabase');
const materials = require('./materials.json');


async function seed() {
  console.log('Clearing existing materials from material_master...');
  const { error: clearError } = await supabase
    .from('material_master')
    .delete()
    .neq('Material_Main_Head', 'NOT_A_REAL_HEAD_VALUE'); // Deletes all rows safely
  if (clearError) {
    console.error('Error clearing material_master:', clearError);
    process.exit(1);
  }
  console.log('Cleared existing materials.');

  console.log(`Starting seeding of ${materials.length} materials...`);
  
  const mappedMaterials = materials.map(m => ({
    Material_Main_Head: m.main_head,
    Material_Sub_Head: m.sub_head,
    Material_Details: m.material_description,
    M_Unit: m.unit,
    is_active: m.is_active !== undefined ? m.is_active : true,
    created_by: m.created_by || '+918276071523',
    edited_by: m.edited_by || '+918276071523'
  }));

  // Chunk inserts to prevent payload size limits (e.g. 100 rows per insert)
  const chunkSize = 100;
  for (let i = 0; i < mappedMaterials.length; i += chunkSize) {
    const chunk = mappedMaterials.slice(i, i + chunkSize);
    const { error } = await supabase.from('material_master').insert(chunk);
    if (error) {
      console.error(`Error inserting chunk ${i} to ${i + chunk.length}:`, error);
      process.exit(1);
    }
    console.log(`Inserted chunk ${i} to ${i + chunk.length}`);
  }
  
  console.log('Seeding completed successfully!');
  
  // Verify count
  const { count, error } = await supabase.from('material_master').select('*', { count: 'exact', head: true });
  if (error) {
    console.error('Error verifying count:', error);
  } else {
    console.log(`Verified row count in database: ${count}`);
  }
}

seed();


