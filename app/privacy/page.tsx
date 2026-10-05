import { redirect } from "next/navigation";

/* Короткий адрес политики конфиденциальности.

   Сам текст живёт на странице правил, вторым разделом переключателя. Этот адрес
   нужен, чтобы в App Store и на экране подписки стояла простая ссылка. */

export default function PrivacyPage() {
  redirect("/rules?doc=privacy");
}
