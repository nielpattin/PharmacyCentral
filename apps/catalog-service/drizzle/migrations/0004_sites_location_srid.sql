ALTER TABLE "sites" ALTER COLUMN "location" TYPE geometry(Point, 4326) USING ST_SetSRID("location", 4326);
