// Live hints that mirror the server's password policy (the server still enforces it).
export function passwordChecks(password, { email = '' } = {}) {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  const local = email.split('@')[0]?.toLowerCase();
  return [
    { ok: password.length >= 10, label: 'At least 10 characters' },
    { ok: classes >= 3, label: 'Three of: lowercase, uppercase, digit, symbol' },
    { ok: !(local && local.length >= 3 && password.toLowerCase().includes(local)), label: "Doesn't contain your email" },
  ];
}

export default function PasswordChecklist({ password, email }) {
  if (!password) return null;
  return (
    <ul className="checklist" aria-live="polite">
      {passwordChecks(password, { email }).map((c) => (
        <li key={c.label} className={c.ok ? 'ok' : ''}>
          {c.label}
        </li>
      ))}
    </ul>
  );
}
