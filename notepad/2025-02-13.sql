select 
    id,
    "noteDate",
    "createdAt",
    LEFT(REPLACE(content, E'\n', ' '), 40) as truncated_text
from "Note" order by id desc limit 5;

select count(*) from "Note";

select count(*) from "BotResponse";

delete from "Note" where id = 16;
