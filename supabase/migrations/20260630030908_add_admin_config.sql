CREATE TABLE public.app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" 
ON public.app_config FOR SELECT 
USING (true);

INSERT INTO public.app_config (key, value) VALUES ('admin_pass', '9101292003');
