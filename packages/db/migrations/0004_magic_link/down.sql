-- [BM-008] Development/test reversal; production uses forward fixes.
drop table if exists verification;
drop table if exists accounts;
drop trigger if exists users_email_verified_at_trigger on users;
drop function if exists set_user_email_verified_at();
