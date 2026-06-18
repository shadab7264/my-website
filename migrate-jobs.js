"use strict";

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://ctprrqxqiwmzcjsacsmn.supabase.co";
let rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || "";
rawKey = String(rawKey).trim().replace(/^["']|["']$/g, "");

const supabase = createClient(SUPABASE_URL, rawKey, {
  auth: { persistSession: false }
});

async function migrate() {
  console.log("🚀 Starting Jobs Portal database migration...\n");

  // 1. Create job_categories table
  console.log("📋 Creating job_categories table...");
  const { error: catErr } = await supabase.rpc("exec_sql", {
    sql: `
      CREATE TABLE IF NOT EXISTS job_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `
  });

  if (catErr) {
    // If rpc exec_sql doesn't exist, try direct table creation via insert test
    console.warn("  ⚠️ RPC exec_sql not available. Attempting direct table operations...");
    console.warn("  ℹ️  You may need to create tables manually via Supabase Dashboard SQL Editor.");
    console.warn("  📝 SQL statements will be printed below for manual execution.\n");
    printManualSQL();
    return;
  }
  console.log("  ✅ job_categories created");

  // 2. Create jobs table
  console.log("📋 Creating jobs table...");
  const { error: jobErr } = await supabase.rpc("exec_sql", {
    sql: `
      CREATE TABLE IF NOT EXISTS jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        slug TEXT UNIQUE NOT NULL,
        company_name TEXT NOT NULL,
        company_logo_url TEXT,
        location TEXT NOT NULL DEFAULT 'India',
        salary_min INTEGER DEFAULT 0,
        salary_max INTEGER DEFAULT 0,
        salary_period TEXT NOT NULL DEFAULT 'Yearly',
        experience_min INTEGER DEFAULT 0,
        experience_max INTEGER DEFAULT 0,
        employment_type TEXT NOT NULL DEFAULT 'Full-Time',
        work_mode TEXT NOT NULL DEFAULT 'Work From Office',
        category_id UUID REFERENCES job_categories(id) ON DELETE SET NULL,
        description TEXT NOT NULL DEFAULT '',
        skills_required TEXT[] DEFAULT '{}',
        openings INTEGER DEFAULT 1,
        last_date DATE,
        is_featured BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        experience_level TEXT NOT NULL DEFAULT 'Both',
        created_at TIMESTAMPTZ DEFAULT now(),
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_slug ON jobs(slug);
      CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs(is_active);
      CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_featured ON jobs(is_featured);
      CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);
    `
  });
  if (jobErr) console.error("  ❌ jobs table error:", jobErr.message);
  else console.log("  ✅ jobs created with indexes");

  // 3. Create job_applications table
  console.log("📋 Creating job_applications table...");
  const { error: appErr } = await supabase.rpc("exec_sql", {
    sql: `
      CREATE TABLE IF NOT EXISTS job_applications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        application_id TEXT UNIQUE NOT NULL,
        job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        full_name TEXT NOT NULL,
        mobile TEXT NOT NULL,
        whatsapp TEXT,
        email TEXT NOT NULL,
        gender TEXT,
        dob DATE,
        current_location TEXT,
        highest_qualification TEXT,
        course_name TEXT,
        college TEXT,
        passing_year INTEGER,
        percentage DECIMAL(5,2),
        employment_status TEXT NOT NULL DEFAULT 'Fresher',
        current_company TEXT,
        previous_company TEXT,
        total_experience TEXT,
        current_salary TEXT,
        expected_salary TEXT,
        notice_period TEXT,
        current_designation TEXT,
        resume_url TEXT,
        resume_name TEXT,
        skills TEXT,
        certifications TEXT,
        linkedin_url TEXT,
        portfolio_url TEXT,
        cover_letter TEXT,
        terms_accepted BOOLEAN NOT NULL DEFAULT false,
        terms_accepted_at TIMESTAMPTZ,
        applicant_ip TEXT,
        status TEXT NOT NULL DEFAULT 'New',
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_applications_job ON job_applications(job_id);
      CREATE INDEX IF NOT EXISTS idx_applications_appid ON job_applications(application_id);
      CREATE INDEX IF NOT EXISTS idx_applications_status ON job_applications(status);
      CREATE INDEX IF NOT EXISTS idx_applications_created ON job_applications(created_at DESC);
    `
  });
  if (appErr) console.error("  ❌ job_applications table error:", appErr.message);
  else console.log("  ✅ job_applications created with indexes");

  // 4. Create placement_settings table
  console.log("📋 Creating placement_settings table...");
  const { error: settErr } = await supabase.rpc("exec_sql", {
    sql: `
      CREATE TABLE IF NOT EXISTS placement_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        terms_content TEXT NOT NULL DEFAULT '',
        policy_content TEXT NOT NULL DEFAULT '',
        updated_at TIMESTAMPTZ DEFAULT now()
      );

      INSERT INTO placement_settings (terms_content, policy_content)
      SELECT 
        'Skyward Career & Placement Hub connects job seekers with employers. By submitting an application through our platform, you agree to the following terms:\n\n1. Skyward Career & Placement Hub acts as an intermediary between candidates and hiring companies.\n2. A placement/service fee may be charged ONLY after successful selection and joining confirmation.\n3. No fee is charged merely for applying to jobs through the platform.\n4. All personal information provided will be shared only with the relevant hiring company.\n5. Skyward reserves the right to verify any information provided in the application.\n6. Misrepresentation of qualifications or experience may lead to disqualification.\n7. Skyward does not guarantee employment or placement.\n8. These terms may be updated from time to time.',
        'Skyward Career & Placement Hub Placement Policy:\n\n1. PLACEMENT FEE: A service fee is applicable only upon successful placement (selection + joining). The fee structure will be communicated before the interview process.\n2. NO UPFRONT CHARGES: We do not charge any registration fee, application fee, or processing fee for job applications.\n3. CANDIDATE OBLIGATIONS: Candidates must attend scheduled interviews, provide accurate information, and maintain professional conduct.\n4. CONFIDENTIALITY: All candidate data is handled with strict confidentiality and shared only with prospective employers.\n5. REFUND POLICY: If a candidate is terminated within the probation period due to company-side reasons, a partial refund of the placement fee may be considered on a case-by-case basis.\n6. DISPUTE RESOLUTION: Any disputes will be resolved through mutual discussion and, if necessary, through arbitration in Darbhanga, Bihar jurisdiction.'
      WHERE NOT EXISTS (SELECT 1 FROM placement_settings LIMIT 1);
    `
  });
  if (settErr) console.error("  ❌ placement_settings table error:", settErr.message);
  else console.log("  ✅ placement_settings created with defaults");

  // 5. Seed default job categories
  console.log("\n🌱 Seeding default job categories...");
  const defaultCategories = [
    { name: "Information Technology", slug: "it" },
    { name: "Marketing & Sales", slug: "marketing-sales" },
    { name: "Finance & Accounting", slug: "finance-accounting" },
    { name: "Human Resources", slug: "human-resources" },
    { name: "Engineering", slug: "engineering" },
    { name: "Healthcare", slug: "healthcare" },
    { name: "Education & Teaching", slug: "education-teaching" },
    { name: "Customer Support", slug: "customer-support" },
    { name: "Design & Creative", slug: "design-creative" },
    { name: "Administration", slug: "administration" },
    { name: "Data Entry & Back Office", slug: "data-entry-back-office" },
    { name: "Other", slug: "other" }
  ];

  for (const cat of defaultCategories) {
    const { error } = await supabase
      .from("job_categories")
      .upsert(cat, { onConflict: "slug" });
    if (error) {
      console.warn(`  ⚠️ Category "${cat.name}": ${error.message}`);
    } else {
      console.log(`  ✅ ${cat.name}`);
    }
  }

  console.log("\n🎉 Migration complete!");
}

function printManualSQL() {
  console.log(`
===== COPY THE SQL BELOW INTO SUPABASE SQL EDITOR =====

-- 1. Job Categories
CREATE TABLE IF NOT EXISTS job_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Jobs
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  company_name TEXT NOT NULL,
  company_logo_url TEXT,
  location TEXT NOT NULL DEFAULT 'India',
  salary_min INTEGER DEFAULT 0,
  salary_max INTEGER DEFAULT 0,
  salary_period TEXT NOT NULL DEFAULT 'Yearly',
  experience_min INTEGER DEFAULT 0,
  experience_max INTEGER DEFAULT 0,
  employment_type TEXT NOT NULL DEFAULT 'Full-Time',
  work_mode TEXT NOT NULL DEFAULT 'Work From Office',
  category_id UUID REFERENCES job_categories(id) ON DELETE SET NULL,
  description TEXT NOT NULL DEFAULT '',
  skills_required TEXT[] DEFAULT '{}',
  openings INTEGER DEFAULT 1,
  last_date DATE,
  is_featured BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  experience_level TEXT NOT NULL DEFAULT 'Both',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_jobs_slug ON jobs(slug);
CREATE INDEX IF NOT EXISTS idx_jobs_active ON jobs(is_active);
CREATE INDEX IF NOT EXISTS idx_jobs_category ON jobs(category_id);
CREATE INDEX IF NOT EXISTS idx_jobs_featured ON jobs(is_featured);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at DESC);

-- 3. Job Applications
CREATE TABLE IF NOT EXISTS job_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id TEXT UNIQUE NOT NULL,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  whatsapp TEXT,
  email TEXT NOT NULL,
  gender TEXT,
  dob DATE,
  current_location TEXT,
  highest_qualification TEXT,
  course_name TEXT,
  college TEXT,
  passing_year INTEGER,
  percentage DECIMAL(5,2),
  employment_status TEXT NOT NULL DEFAULT 'Fresher',
  current_company TEXT,
  previous_company TEXT,
  total_experience TEXT,
  current_salary TEXT,
  expected_salary TEXT,
  notice_period TEXT,
  current_designation TEXT,
  resume_url TEXT,
  resume_name TEXT,
  skills TEXT,
  certifications TEXT,
  linkedin_url TEXT,
  portfolio_url TEXT,
  cover_letter TEXT,
  terms_accepted BOOLEAN NOT NULL DEFAULT false,
  terms_accepted_at TIMESTAMPTZ,
  applicant_ip TEXT,
  status TEXT NOT NULL DEFAULT 'New',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_applications_job ON job_applications(job_id);
CREATE INDEX IF NOT EXISTS idx_applications_appid ON job_applications(application_id);
CREATE INDEX IF NOT EXISTS idx_applications_status ON job_applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_created ON job_applications(created_at DESC);

-- 4. Placement Settings
CREATE TABLE IF NOT EXISTS placement_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terms_content TEXT NOT NULL DEFAULT '',
  policy_content TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO placement_settings (terms_content, policy_content)
VALUES (
  'Skyward Career & Placement Hub connects job seekers with employers. By submitting an application through our platform, you agree to the following terms:

1. Skyward Career & Placement Hub acts as an intermediary between candidates and hiring companies.
2. A placement/service fee may be charged ONLY after successful selection and joining confirmation.
3. No fee is charged merely for applying to jobs through the platform.
4. All personal information provided will be shared only with the relevant hiring company.
5. Skyward reserves the right to verify any information provided in the application.
6. Misrepresentation of qualifications or experience may lead to disqualification.
7. Skyward does not guarantee employment or placement.
8. These terms may be updated from time to time.',
  'Skyward Career & Placement Hub Placement Policy:

1. PLACEMENT FEE: A service fee is applicable only upon successful placement (selection + joining). The fee structure will be communicated before the interview process.
2. NO UPFRONT CHARGES: We do not charge any registration fee, application fee, or processing fee for job applications.
3. CANDIDATE OBLIGATIONS: Candidates must attend scheduled interviews, provide accurate information, and maintain professional conduct.
4. CONFIDENTIALITY: All candidate data is handled with strict confidentiality and shared only with prospective employers.
5. REFUND POLICY: If a candidate is terminated within the probation period due to company-side reasons, a partial refund of the placement fee may be considered on a case-by-case basis.
6. DISPUTE RESOLUTION: Any disputes will be resolved through mutual discussion and, if necessary, through arbitration in Darbhanga, Bihar jurisdiction.'
);

-- 5. Seed default categories
INSERT INTO job_categories (name, slug) VALUES
  ('Information Technology', 'it'),
  ('Marketing & Sales', 'marketing-sales'),
  ('Finance & Accounting', 'finance-accounting'),
  ('Human Resources', 'human-resources'),
  ('Engineering', 'engineering'),
  ('Healthcare', 'healthcare'),
  ('Education & Teaching', 'education-teaching'),
  ('Customer Support', 'customer-support'),
  ('Design & Creative', 'design-creative'),
  ('Administration', 'administration'),
  ('Data Entry & Back Office', 'data-entry-back-office'),
  ('Other', 'other')
ON CONFLICT (slug) DO NOTHING;

===== END OF SQL =====
  `);
}

migrate().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
