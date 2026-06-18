-- RBAC Schema for Skyward Career and Placement Hub

-- 1. Create admin_users table
CREATE TABLE IF NOT EXISTS public.admin_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
    department TEXT,
    designation TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_by UUID REFERENCES public.admin_users(id),
    last_login TIMESTAMPTZ,
    failed_login_attempts INT DEFAULT 0,
    locked_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Create audit_logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.admin_users(id),
    action TEXT NOT NULL,
    details JSONB,
    performed_by UUID REFERENCES public.admin_users(id),
    ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Setup Row Level Security (optional but recommended)
-- We use the service_role key in the backend which bypasses RLS,
-- but this secures it against anonymous API access.
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 4. Create trigger to update updated_at timestamp on admin_users
CREATE OR REPLACE FUNCTION update_admin_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = now();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_users_updated_at ON public.admin_users;
CREATE TRIGGER trg_admin_users_updated_at
BEFORE UPDATE ON public.admin_users
FOR EACH ROW
EXECUTE FUNCTION update_admin_users_updated_at();
