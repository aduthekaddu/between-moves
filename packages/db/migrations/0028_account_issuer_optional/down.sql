-- Non-production reversal: fails while any account row has no issuer.
alter table accounts alter column issuer set not null;
