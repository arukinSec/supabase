DROP POLICY IF EXISTS "Enable all operations for anon" ON public.members;

CREATE POLICY "Enable all operations for all roles" 
ON public.members FOR ALL 
USING (true) 
WITH CHECK (true);
