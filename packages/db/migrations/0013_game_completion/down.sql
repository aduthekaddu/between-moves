drop table game_lifecycle_commands;
alter table games drop constraint games_draw_offer_shape_check;
alter table games drop constraint games_draw_offer_membership_house_fk;
alter table games drop column draw_offer_ply;
alter table games drop column draw_offer_membership_id;
