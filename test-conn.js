console.log('Testing connectivity to Supabase using global fetch...');
fetch('https://ctprrqxqiwmzcjsacsmn.supabase.co')
  .then(res => {
    console.log('Successfully connected!', res.status);
  })
  .catch(err => {
    console.error('Connection failed:', err);
  });
