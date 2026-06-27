import { badRequest, ok, serverError } from "@/lib/http";
import { getDemoLoginEnabled } from "@/lib/server-config";
import { ensureDemoDoctor, loginDoctor, publicDoctor, signUpDoctor } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      mode?: "signup" | "login";
      name?: string;
      email?: string;
      password?: string;
    };

    if (body.mode === "login" && body.email === "demo@doctorai.local" && !body.password) {
      if (!getDemoLoginEnabled()) return badRequest("Demo login is disabled.");
      const doctor = await ensureDemoDoctor();
      return ok({ doctor: publicDoctor(doctor) });
    }

    if (!body.email || !body.password || !body.mode) {
      return badRequest("Email, password, and auth mode are required.");
    }

    if (body.mode === "signup") {
      if (!body.name) return badRequest("Doctor name is required for signup.");
      const doctor = await signUpDoctor(body.name, body.email, body.password);
      return ok({ doctor: publicDoctor(doctor) }, 201);
    }

    const doctor = await loginDoctor(body.email, body.password);
    if (!doctor) return badRequest("Invalid email or password.");
    return ok({ doctor: publicDoctor(doctor) });
  } catch (error) {
    return serverError(error);
  }
}
