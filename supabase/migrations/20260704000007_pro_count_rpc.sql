-- Function to securely count the total number of PRO auditors for the launch promo
CREATE OR REPLACE FUNCTION get_pro_auditor_count()
RETURNS INT
SECURITY DEFINER
AS $$
DECLARE
  pro_count INT;
BEGIN
  SELECT COUNT(*) INTO pro_count FROM auditors WHERE tier = 'PRO';
  RETURN pro_count;
END;
$$ LANGUAGE plpgsql;
