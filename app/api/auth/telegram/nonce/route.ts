import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

export async function GET() {
  const nonce = randomBytes(24).toString("base64url");
  const response = NextResponse.json({ nonce });
  response.cookies.set("telegram_login_nonce", nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 300,
    path: "/",
  });
  return response;
}
