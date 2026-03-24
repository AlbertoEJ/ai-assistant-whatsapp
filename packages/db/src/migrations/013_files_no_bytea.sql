-- Remove binary content from user_files (files now stored on disk)
ALTER TABLE user_files DROP COLUMN IF EXISTS content;
