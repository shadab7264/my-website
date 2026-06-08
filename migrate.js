const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ctprrqxqiwmzcjsacsmn.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_KEY) {
  console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY is not set in .env!");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

async function runMigration() {
  console.log("Starting migration to Supabase...");
  
  // Read posts.json
  const postsPath = path.join(DATA_DIR, "posts.json");
  if (!fs.existsSync(postsPath)) {
    console.log("No posts.json found to migrate.");
    return;
  }
  
  const posts = JSON.parse(fs.readFileSync(postsPath, "utf8"));
  console.log(`Found ${posts.length} posts to migrate.`);

  for (const post of posts) {
    console.log(`\nMigrating post: "${post.title}" (${post.id})`);
    
    let mediaUrl = post.mediaUrl || null;
    let mediaType = post.mediaType || null;
    let mediaName = post.mediaName || null;
    
    // Check if the mediaUrl is local
    if (mediaUrl && mediaUrl.startsWith("/media/")) {
      const fileName = path.basename(mediaUrl);
      const filePath = path.join(UPLOADS_DIR, fileName);
      
      if (fs.existsSync(filePath)) {
        console.log(`  Uploading local file: ${fileName} to Supabase Storage...`);
        const fileBuffer = fs.readFileSync(filePath);
        
        // Determine content-type (basic guess)
        let contentType = "image/png";
        if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) contentType = "image/jpeg";
        else if (fileName.endsWith(".webp")) contentType = "image/webp";
        else if (fileName.endsWith(".gif")) contentType = "image/gif";
        else if (fileName.endsWith(".mp4")) contentType = "video/mp4";
        
        const { data, error } = await supabase.storage
          .from("media")
          .upload(fileName, fileBuffer, {
            contentType,
            duplex: "half"
          });
          
        if (error) {
          // If it already exists in the bucket, just use it
          if (error.message && error.message.includes("already exists")) {
            const { data: publicUrlData } = supabase.storage
              .from("media")
              .getPublicUrl(fileName);
            mediaUrl = publicUrlData.publicUrl;
            console.log(`  File already exists in storage. Reused URL: ${mediaUrl}`);
          } else {
            console.error(`  Failed to upload ${fileName} to storage:`, error.message);
          }
        } else {
          const { data: publicUrlData } = supabase.storage
            .from("media")
            .getPublicUrl(fileName);
          mediaUrl = publicUrlData.publicUrl;
          console.log(`  File uploaded successfully! Public URL: ${mediaUrl}`);
        }
      } else {
        console.log(`  Local file ${fileName} not found in uploads folder.`);
      }
    }
    
    // Insert/Upsert post into Supabase Database
    console.log(`  Saving post record to 'posts' table...`);
    const { error: dbError } = await supabase
      .from("posts")
      .upsert([{
        id: post.id,
        title: post.title,
        category: post.category,
        description: post.description,
        show_apply: post.showApply || false,
        media_url: mediaUrl,
        media_type: mediaType,
        media_name: mediaName,
        created_at: post.createdAt
      }]);
      
    if (dbError) {
      console.error(`  Database insert failed:`, dbError.message);
    } else {
      console.log(`  Post "${post.title}" successfully saved in Supabase database.`);
    }
  }
  
  console.log("\nMigration complete!");
}

runMigration().catch(console.error);
