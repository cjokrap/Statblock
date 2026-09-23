// Liftosaur API keys look like lftsk_ followed by letters, digits, _ or -
// (the same rule set_liftosaur_key enforces). Pure, so it's unit-tested.
export function liftosaurKeyProblem(raw: string): string | null {
  const key = raw.trim();
  if (!key) return "Paste your Liftosaur API key.";
  if (!key.startsWith("lftsk_")) return "That isn't a Liftosaur API key. They start with lftsk_.";
  if (!/^lftsk_[A-Za-z0-9_-]+$/.test(key)) return "That key has characters a Liftosaur key can't have. Copy it again.";
  return null;
}

