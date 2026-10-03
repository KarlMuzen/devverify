function escapeRegExp(value: string): string {
  const special = new Set(['\\', '^', '$', '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|']);
  return [...value].map((char) => (special.has(char) ? '\\' + char : char)).join('');
}

export function redactSecrets(text: string, secrets: string[]): string {
  let redacted = text;

  for (const secret of [...secrets]
    .filter((value) => value.length > 0)
    .sort((a, b) => b.length - a.length)) {
    redacted = redacted.replace(new RegExp(escapeRegExp(secret), 'g'), '[REDACTED]');
  }

  return redacted;
}
