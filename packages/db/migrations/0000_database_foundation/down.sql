-- [BM-004] Development/test reversal; production uses forward fixes.
drop function if exists is_uuid_v7(uuid);
drop extension if exists pgcrypto;
