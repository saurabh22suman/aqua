import { handleWhatsAppAuth } from "@/lib/auth/whatsapp-route";

export async function POST(request: Request) {
  return handleWhatsAppAuth(request, "pin_reset");
}
