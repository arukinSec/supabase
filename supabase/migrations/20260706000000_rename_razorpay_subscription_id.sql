-- Rename razorpay_subscription_id to razorpay_order_id in managers table
ALTER TABLE "public"."managers" RENAME COLUMN "razorpay_subscription_id" TO "razorpay_order_id";
