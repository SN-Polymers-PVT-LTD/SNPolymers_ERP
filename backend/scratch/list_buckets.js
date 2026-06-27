const { supabase } = require('../src/db/supabase');

async function listBuckets() {
  const { data, error } = await supabase.storage.listBuckets();
  if (error) {
    console.error('Error listing buckets:', error);
  } else {
    console.log('Available buckets:', data);
  }
}

listBuckets();
