-- Active FMs maintain both factory calendars under the existing migration-131 scope rules.
DO $migration$ DECLARE name regprocedure; def text; BEGIN
 FOREACH name IN ARRAY ARRAY['public.guard_factory_calendar_revision()'::regprocedure,'public.save_factory_calendar(text,integer,text,date,text,uuid)'::regprocedure] LOOP
  SELECT pg_get_functiondef(name) INTO def;
  IF position('ARRAY[''admin'',''ho'']' IN def)=0 THEN RAISE EXCEPTION 'Calendar authorization patch target missing: %',name; END IF;
  EXECUTE replace(def,'ARRAY[''admin'',''ho'']','ARRAY[''admin'',''ho'',''factory_manager'']');
 END LOOP;
END $migration$;
