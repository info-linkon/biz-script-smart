-- Create a function to get user emails for admins
CREATE OR REPLACE FUNCTION public.get_users_with_email()
RETURNS TABLE (
  user_id uuid,
  email text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, email::text
  FROM auth.users
  WHERE EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE user_roles.user_id = auth.uid() 
    AND user_roles.role = 'admin'
  )
$$;