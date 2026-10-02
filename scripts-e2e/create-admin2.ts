/**
 * E2E fixture: provision a second admin actor for cross-user observation tests.
 * Uses the same RegistrationService.createAdminUser path as the seeders.
 *
 * LOCAL-ONLY FIXTURE: refuses to run against a non-local DATABASE_URL target
 * (the fixed fixture credential is acceptable only on throwaway local
 * databases — never against a shared or production cluster). The password
 * can be overridden via ADMIN2_PASSWORD; the default is a weak, well-known
 * local fixture value, never a production credential.
 */
import { Gender } from "@/backend/enum/users/gender.enum";
import { RegistrationService } from "@/backend/services";

const DATABASE_URL = process.env.DATABASE_URL ?? "";
if (DATABASE_URL && !/^postgres(ql)?:\/\/[^/]*@(localhost|127\.0\.0\.1)[:/]/.test(DATABASE_URL)) {
  console.error("REFUSING to run: DATABASE_URL is not a local-only target — create-admin2 is a local e2e fixture only");
  process.exit(1);
}

async function main() {
  try {
    const admin = await RegistrationService.createAdminUser(
      {
        fullName: "Super Admin Two",
        email: "admin2@app.local",
        phone: "+201000000006",
        country: "Egypt",
        password: process.env.ADMIN2_PASSWORD ?? "adminpassword123",
        gender: Gender.Male,
        role: "admin",
      },
      "en"
    );
    console.log("CREATED admin2:", admin.email, "id:", (admin as { id?: number }).id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already exists") || msg.includes("23505")) {
      console.log("admin2 already exists — continuing");
    } else {
      throw err;
    }
  }
  process.exit(0);
}

void main();
