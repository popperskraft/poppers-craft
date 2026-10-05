import type { Metadata } from "next";
import { PaymentReturn } from "./PaymentReturn";
import "../plans.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Оплата — PoppersCraft", robots: { index: false } };

export default async function PaymentReturnPage({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  const { payment } = await searchParams;
  return <PaymentReturn paymentId={typeof payment === "string" ? payment : ""} />;
}
