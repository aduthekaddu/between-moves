-- Better Auth 1.7.15 never writes accounts.issuer, and its runtime schema check refuses
-- every auth call while a column it never writes stays required.
alter table accounts alter column issuer drop not null;
