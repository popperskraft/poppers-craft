"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { MfaPasswordDisable } from "./MfaPasswordDisable";

type Factor = { id: string; friendly_name?: string; status: string };
type Enrollment = { id: string; qr: string; secret: string };

export function MfaSetup() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.totp ?? []) as Factor[]);
  };

  useEffect(() => {
    let active = true;
    supabase.auth.mfa.listFactors().then(({ data }) => {
      if (active) setFactors((data?.totp ?? []) as Factor[]);
    });
    return () => { active = false; };
  }, [supabase]);

  const enroll = async () => {
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "PoppersCraft Authenticator",
    });
    if (error) setMessage(error.message);
    else setEnrollment({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setBusy(false);
  };

  const verify = async () => {
    if (!enrollment || !/^\d{6}$/.test(code)) {
      setMessage("Введите шестизначный код из приложения.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.id, code });
    if (error) setMessage("Код не подошёл. Проверьте время на устройстве и попробуйте снова.");
    else {
      setMessage("Двухфакторная защита подключена.");
      setEnrollment(null);
      setCode("");
      await refresh();
    }
    setBusy(false);
  };

  return (
    <div className="mfa-setup">
      <p>Подойдёт Google Authenticator, Apple Passwords или другое приложение с кодами TOTP.</p>
      {factors.filter((factor) => factor.status === "verified").map((factor) => (
        <div className="mfa-factor" key={factor.id}>
          <span>ЗАЩИТА ВКЛЮЧЕНА ✓</span>
          <small>{factor.friendly_name ?? "Authenticator"}</small>
        </div>
      ))}
      {factors.some((factor) => factor.status === "verified") ? <MfaPasswordDisable /> : null}
      {!enrollment && !factors.some((factor) => factor.status === "verified") ? (
        <button type="button" disabled={busy} onClick={enroll}>ПОДКЛЮЧИТЬ АУТЕНТИФИКАТОР</button>
      ) : null}
      {enrollment ? (
        <div className="mfa-enrollment">
          {/* Supabase returns the QR as an inline data image. */}
          <Image src={enrollment.qr} width={260} height={260} unoptimized alt="QR-код для подключения двухфакторной аутентификации" />
          <p>Отсканируйте QR-код или введите ключ вручную:</p>
          <code>{enrollment.secret}</code>
          <label>КОД ИЗ ПРИЛОЖЕНИЯ<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" /></label>
          <button type="button" disabled={busy} onClick={verify}>ПОДТВЕРДИТЬ 2FA</button>
        </div>
      ) : null}
      {message ? <p className="form-message">{message}</p> : null}
    </div>
  );
}
