-- Allow users to register and sign in without Telegram.
ALTER TABLE "public"."User"
  ALTER COLUMN "telegramUserId" DROP NOT NULL,
  ADD COLUMN "webPasswordHash" TEXT;
