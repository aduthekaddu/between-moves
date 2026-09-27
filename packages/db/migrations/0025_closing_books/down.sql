-- [BM-048] Development/test reversal; production uses forward fixes.
drop table if exists closing_books;
drop function if exists guard_closing_books();
