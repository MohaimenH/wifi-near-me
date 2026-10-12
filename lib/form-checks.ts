/** True when the steps text contains the password. Passwords under 4 characters are ignored to avoid false alarms. */
export function stepsContainPassword(steps: string, password: string): boolean {
  const p = password.trim().toLowerCase();
  if (p.length < 4) return false;
  return steps.toLowerCase().includes(p);
}
