export function WindowCloseLink({
  href = "/",
  label = "Закрыть окно и вернуться на главную",
}: {
  href?: string;
  label?: string;
}) {
  return (
    <i>
      <a
        href={href}
        aria-label={label}
        title={label}
        style={{ width: "100%", height: "100%", display: "grid", placeItems: "center" }}
      >
        ×
      </a>
    </i>
  );
}
