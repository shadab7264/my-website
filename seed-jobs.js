const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ctprrqxqiwmzcjsacsmn.supabase.co";
let rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "sb_publishable_1DEtfIZ7bwt1xNT3gcbBDw_g5HYVNni";
rawKey = String(rawKey).trim().replace(/^["']|["']$/g, "");
const SUPABASE_KEY = rawKey;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing Supabase credentials in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function seedJobs() {
  console.log("Seeding jobs into the database...");

  // Get a category ID
  const { data: categories, error: catError } = await supabase.from('job_categories').select('id, name').limit(2);
  
  if (catError || !categories || categories.length === 0) {
    console.error("Could not fetch categories. Did you run the migration?", catError);
    return;
  }

  const itCategory = categories.find(c => c.name === 'Information Technology') || categories[0];
  const marketingCategory = categories.find(c => c.name === 'Marketing & Sales') || categories[1] || categories[0];

  const jobsToInsert = [
    {
      title: "Senior Full Stack Developer",
      slug: "senior-full-stack-developer-1",
      company_name: "TechNova Solutions",
      location: "Bangalore, India (Hybrid)",
      salary_min: 1500000,
      salary_max: 2500000,
      experience_min: 4,
      experience_max: 8,
      employment_type: "Full-Time",
      work_mode: "Hybrid",
      category_id: itCategory.id,
      description: "We are looking for an experienced Full Stack Developer with expertise in React, Node.js, and PostgreSQL to lead our core product team. You will be responsible for architecting scalable solutions and mentoring junior developers.\n\nKey Responsibilities:\n- Design and implement new features\n- Optimize application performance\n- Code reviews and mentoring",
      skills_required: ["React", "Node.js", "PostgreSQL", "AWS"],
      openings: 2,
      is_featured: true,
      is_active: true,
      experience_level: "Experienced"
    },
    {
      title: "Digital Marketing Executive",
      slug: "digital-marketing-executive-1",
      company_name: "Skyward Hub",
      location: "Darbhanga, India",
      salary_min: 300000,
      salary_max: 600000,
      experience_min: 0,
      experience_max: 2,
      employment_type: "Full-Time",
      work_mode: "Work From Office",
      category_id: marketingCategory.id,
      description: "Skyward is expanding its internal marketing team! We are looking for a creative Digital Marketing Executive to handle social media campaigns, SEO, and content creation.\n\nRequirements:\n- Good understanding of SEO and SEM\n- Excellent written communication\n- Familiarity with analytics tools",
      skills_required: ["SEO", "Social Media", "Content Writing"],
      openings: 1,
      is_featured: true,
      is_active: true,
      experience_level: "Both"
    },
    {
      title: "Frontend Developer Intern",
      slug: "frontend-developer-intern-1",
      company_name: "CreativeWeb Agency",
      location: "Remote",
      salary_min: 120000,
      salary_max: 240000,
      experience_min: 0,
      experience_max: 0,
      employment_type: "Internship",
      work_mode: "Remote",
      category_id: itCategory.id,
      description: "Kickstart your career with our 6-month paid internship program! You will work alongside senior designers and developers to build responsive, beautiful web interfaces.\n\nWhat you'll learn:\n- Modern HTML/CSS/JS\n- React basics\n- Agile workflows",
      skills_required: ["HTML", "CSS", "JavaScript"],
      openings: 3,
      is_featured: false,
      is_active: true,
      experience_level: "Fresher"
    }
  ];

  const { data, error } = await supabase.from('jobs').insert(jobsToInsert).select();

  if (error) {
    console.error("Error inserting jobs:", error);
  } else {
    console.log(`Successfully inserted ${data.length} jobs!`);
  }
}

seedJobs();
