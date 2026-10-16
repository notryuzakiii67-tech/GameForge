import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { isNoContactEmail } from "@/lib/auth-validation";
import { maskEmail } from "@/lib/recovery";
import { ApiError, errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    const rows = await query<{ username: string; email: string; email_verified_at: string | null; phone: string | null; phone_verified_at: string | null }>(
      `SELECT username, email, email_verified_at, phone, phone_verified_at FROM users WHERE id = ? LIMIT 1`, [user.id]);
    const account = rows[0];
    if (!account) throw new ApiError(404, "ACCOUNT_NOT_FOUND", "Your account could not be found.");
    const hasEmail = !isNoContactEmail(account.email);
    return Response.json({
      username: account.username,
      email: hasEmail ? account.email : null,
      emailVerified: Boolean(account.email_verified_at && hasEmail),
      maskedEmail: hasEmail ? maskEmail(account.email) : null,
      phone: account.phone,
      phoneVerified: Boolean(account.phone_verified_at && account.phone),
      phoneRecoveryEnabled: false,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
